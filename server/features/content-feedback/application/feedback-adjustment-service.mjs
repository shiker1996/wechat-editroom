import fs from 'node:fs';
import { resolvePrompt } from '../../../platform/llm/prompt-registry.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { delimitUntrusted } from '../../../platform/llm/context-safety.mjs';
import { atomicWriteJson, atomicWriteUtf8 } from '../../../platform/core/atomic-file.mjs';
import { getAccountContext, loadAccountContext } from '../../../platform/application/account-context-service.mjs';
import { readSkillPackageCatalog } from '../../../platform/skills/package-manager.mjs';
import { SkillRegistry } from '../../../platform/skills/registry.mjs';
import { applySkillEdits } from '../domain/skill-editing.mjs';

// 保持 application 旧公开能力可用；实现位于纯领域规则模块。
export { applySkillEdits } from '../domain/skill-editing.mjs';

export const FEEDBACK_ADJUSTMENT_VERSION = 'v14';
export const WRITER_SKILL_IDS = Object.freeze([
  'wechat-mp-tech-hotspot', 'wechat-mp-tutorial', 'wechat-mp-personal-writing', 'wechat-mp-daily',
]);
export const WRITER_SKILL_LABELS = Object.freeze({
  'wechat-mp-tech-hotspot': '技术热点快评',
  'wechat-mp-tutorial': '工具教程',
  'wechat-mp-personal-writing': '主动写作',
  'wechat-mp-daily': '大厂早报',
});

const MIN_WRITER_SKILL_SAMPLES = 3;
const ARTICLE_PROMPT_FILES = Object.freeze({
  'articles.draft': 'articles/draft.md',
  'articles.type-tech-deep': 'articles/type-tech-deep.md',
  'articles.type-deep-dive': 'articles/type-deep-dive.md',
  'articles.type-gossip-chill': 'articles/type-gossip-chill.md',
  'articles.type-composite': 'articles/type-composite.md',
});
const ARTICLE_TYPE_PROMPTS = Object.freeze({
  'wechat-mp-tech-deep': 'articles.type-tech-deep',
  'wechat-mp-deep-dive': 'articles.type-deep-dive',
  'wechat-mp-gossip-chill': 'articles.type-gossip-chill',
  'wechat-mp-composite': 'articles.type-composite',
});
export const ALLOWED_SKILL_RULE_FILES = Object.freeze([
  'SKILL.md', 'TITLE_GUIDE.md', 'COPY_GUIDE.md', 'references/storyboard.md',
  'references/copy-tool.md',
  'references/copy-event.md', 'references/copy-custom.md',
]);

function cleanText(value, max = 4000) { return String(value || '').trim().slice(0, max); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function sha256(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function jsonText(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function safePatch(value, depth = 0) {
  if (depth > 5 || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safePatch(item, depth + 1));
  if (typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [cleanText(key, 80), safePatch(item, depth + 1)]).filter(([, item]) => item !== undefined));
}

function mergePatch(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(base);
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) result[key] = mergePatch(result[key], value);
    else result[key] = clone(value);
  }
  return result;
}

function compatibleValue(value, base) {
  if (Array.isArray(base)) return Array.isArray(value) ? safePatch(value) : undefined;
  if (base && typeof base === 'object') return value && typeof value === 'object' && !Array.isArray(value) ? safePatch(value) : undefined;
  return typeof value === typeof base ? safePatch(value) : undefined;
}

function existingObjectPatch(value, base, { allowArrays = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !base || typeof base !== 'object' || Array.isArray(base)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => Object.prototype.hasOwnProperty.call(base, key))
    .map(([key, item]) => [key, allowArrays || !Array.isArray(item) ? compatibleValue(item, base[key]) : undefined])
    .filter(([, item]) => item !== undefined));
}

function sameStringMembers(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((item) => typeof item === 'string')
    && right.every((item) => typeof item === 'string')
    && [...left].sort().every((item, index) => item === [...right].sort()[index]);
}

function sameJsonValue(left, right) {
  const normalize = (value) => Array.isArray(value) ? value.map(normalize)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))
      : value;
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function sanitizeAccountPatch(value, base, strategy = {}) {
  if (strategy?.ready !== true || !value || typeof value !== 'object' || Array.isArray(value)) return {};
  const patch = {};
  const current = base && typeof base === 'object' ? base : {};
  const fieldCandidates = strategy.account_field_candidates || {};
  if (fieldCandidates.contentPillars?.changed && sameStringMembers(value.contentPillars, current.contentPillars)
    && sameJsonValue(value.contentPillars, fieldCandidates.contentPillars.proposed)) patch.contentPillars = [...value.contentPillars];
  if (fieldCandidates.contentRatio?.changed && value.contentRatio && current.contentRatio
    && sameJsonValue(value.contentRatio, fieldCandidates.contentRatio.proposed)) patch.contentRatio = existingObjectPatch(value.contentRatio, current.contentRatio);
  return patch;
}

function resolveMappedAccountPatch(accountContext = {}, strategy = {}) {
  if (strategy?.ready !== true) return {};
  const candidates = strategy.account_field_candidates || {};
  const patch = {};
  if (candidates.contentPillars?.changed
    && sameStringMembers(candidates.contentPillars.proposed, accountContext.contentPillars)
    && !sameJsonValue(candidates.contentPillars.proposed, accountContext.contentPillars)) {
    patch.contentPillars = [...candidates.contentPillars.proposed];
  }
  if (candidates.contentRatio?.changed && accountContext.contentRatio
    && sameJsonValue(candidates.contentRatio.current, accountContext.contentRatio)
    && !sameJsonValue(candidates.contentRatio.proposed, accountContext.contentRatio)) {
    patch.contentRatio = existingObjectPatch(candidates.contentRatio.proposed, accountContext.contentRatio);
  }
  return patch;
}

function eligibleWriterSkillIds(writerSkillEvidence, allowedIds = WRITER_SKILL_IDS) {
  const allowed = new Set(allowedIds);
  return new Set((Array.isArray(writerSkillEvidence) ? writerSkillEvidence : [])
    .filter((item) => allowed.has(String(item?.skill_id || '')) && Number(item?.sample_count || 0) >= MIN_WRITER_SKILL_SAMPLES)
    .map((item) => String(item.skill_id)));
}

function canInferWriterSkill(feedback = {}) {
  return Number(feedback?.linked_article_count || 0) >= MIN_WRITER_SKILL_SAMPLES
    && Array.isArray(feedback?.body_signals)
    && feedback.body_signals.length > 0;
}

function readSkillManifestForArtifact(filePath) {
  if (!filePath) return null;
  const directory = path.dirname(filePath);
  const manifestPaths = [
    path.join(directory, '00-skill-manifest.json'),
    path.join(directory, '..', '00-skill-manifest.json'),
  ];
  for (const manifestPath of manifestPaths) {
    try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* Try the parent article directory. */ }
  }
  return null;
}

function titleSkillFromArtifact(filePath) {
  const manifest = readSkillManifestForArtifact(filePath);
  return String(manifest?.stageSkillSelections?.title?.selectedSkill
    || manifest?.stageSkills?.['title-generator']?.skill || '').trim();
}

export function resolveTitleSkillTarget({ workspaceRoot, analyses = [], feedback = {}, entryPoint = 'hotspot-article' } = {}) {
  const metricIds = new Set((feedback?.source_metric_ids || []).map((value) => Number(value)).filter(Boolean));
  const rows = (Array.isArray(analyses) ? analyses : []).filter((item) => !metricIds.size || metricIds.has(Number(item.metric_id)));
  const counts = new Map();
  for (const row of rows) {
    const skillId = titleSkillFromArtifact(row.file_path);
    if (skillId) counts.set(skillId, (counts.get(skillId) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  let configured = '';
  try { configured = String(readSkillPackageCatalog(workspaceRoot).stageDefaults?.[entryPoint]?.title || '').trim(); } catch { /* Use the built-in fallback below. */ }
  // 反哺面向“当前有效的标题技能”，不能因为历史文章曾使用过第三方技能，
  // 就把新草案写到已经不再生效的技能包。历史 manifest 仍作为 evidence 传给模型。
  const selectedSkill = configured || 'title-generator';
  return {
    skillId: selectedSkill,
    source: configured ? 'workspace-default' : 'builtin-default',
    sampleCount: counts.get(selectedSkill) || 0,
    evidence: ranked.map(([id, count]) => ({ skill_id: id, sample_count: count })),
  };
}

export function currentSkillFile(workspaceRoot, skillId) {
  return currentSkillPackageFile(workspaceRoot, skillId, 'SKILL.md');
}

export function currentSkillPackageFile(workspaceRoot, skillId, relativePath = 'SKILL.md') {
  if (!workspaceRoot || !skillId) return '';
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  if (!ALLOWED_SKILL_RULE_FILES.includes(normalized)) return '';
  const override = path.join(workspaceRoot, 'writing-skills', skillId, ...normalized.split('/'));
  if (fs.existsSync(override)) return override;
  const candidates = [
    path.join(workspaceRoot, 'skills', skillId, ...normalized.split('/')),
    path.join(workspaceRoot, 'data', 'installed-skills', skillId, ...normalized.split('/')),
  ];
  return candidates.find((filePath) => fs.existsSync(filePath)) || '';
}

export function currentSkillPackageFiles(workspaceRoot, skillId, relativePaths = ALLOWED_SKILL_RULE_FILES) {
  return Object.fromEntries((Array.isArray(relativePaths) ? relativePaths : ALLOWED_SKILL_RULE_FILES)
    .map((relativePath) => [relativePath, currentSkillPackageFile(workspaceRoot, skillId, relativePath)])
    .filter(([, filePath]) => filePath));
}

function dynamicWriterSkillLabels(workspaceRoot) {
  const labels = new Map();
  try {
    for (const skill of new SkillRegistry({ workspaceRoot }).list()) {
      if (skill.kind === 'writer' && skill.enabled) labels.set(skill.id, skill.name || skill.id);
    }
  } catch { /* Fixed built-in catalog remains available in reduced test workspaces. */ }
  return labels;
}

export function listWriterSkillCatalog({ workspaceRoot } = {}) {
  const labels = dynamicWriterSkillLabels(workspaceRoot);
  const ids = [...new Set([...WRITER_SKILL_IDS, ...labels.keys()])];
  return ids.map((id) => {
    const sourcePath = currentSkillFile(workspaceRoot, id);
    const content = sourcePath ? fs.readFileSync(sourcePath, 'utf8') : '';
    return { id, label: labels.get(id) || WRITER_SKILL_LABELS[id] || id, sourcePath, content };
  });
}

export function listArticlePromptTargets({ workspaceRoot, articleTypeEvidence = [], all = false } = {}) {
  const ids = new Set(['articles.draft']);
  if (all) for (const id of Object.values(ARTICLE_TYPE_PROMPTS)) ids.add(id);
  for (const item of Array.isArray(articleTypeEvidence) ? articleTypeEvidence : []) {
    const promptId = ARTICLE_TYPE_PROMPTS[String(item?.skill_id || '')];
    if (promptId && Number(item?.sample_count || 0) >= MIN_WRITER_SKILL_SAMPLES) ids.add(promptId);
  }
  return [...ids].map((id) => {
    const relativePath = ARTICLE_PROMPT_FILES[id];
    const sourcePath = relativePath ? path.join(workspaceRoot, 'prompts', relativePath) : '';
    return { id, label: id === 'articles.draft' ? '通用正文生成 Prompt' : `文章类型 Prompt：${id.replace('articles.type-', '')}`, sourcePath, content: sourcePath && fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '' };
  }).filter((item) => item.sourcePath && item.content);
}

function promptVersion(workspaceRoot, id) {
  const manifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'prompts', 'manifest.json'), 'utf8'));
  const entry = manifest.prompts.find((item) => item.id === id);
  if (!entry) throw new Error(`正文 Prompt 未登记：${id}`);
  return Number(entry.version);
}

export function resolveWriterSkillTarget({ workspaceRoot, entryPoint = 'hotspot-article' } = {}) {
  let configured = '';
  try { configured = String(readSkillPackageCatalog(workspaceRoot).entryDefaults?.[entryPoint] || '').trim(); } catch { /* Use evidence-based selection below. */ }
  const available = new Set(listWriterSkillCatalog({ workspaceRoot }).filter((item) => item.sourcePath).map((item) => item.id));
  return configured && available.has(configured)
    ? { skillId: configured, source: 'workspace-default' }
    : { skillId: '', source: 'evidence-selection' };
}

export function adjustmentTargets({ workspaceRoot, titleSkillId = 'title-generator', writerSkillId = 'wechat-mp-tech-hotspot' } = {}) {
  const writer = WRITER_SKILL_IDS.includes(writerSkillId) ? writerSkillId : 'wechat-mp-tech-hotspot';
  return [
    { id: 'account-context', kind: 'json', label: '账号策略与选题评分', path: 'account-context.json' },
    { id: titleSkillId, kind: 'skill', label: '标题生成技能', path: `writing-skills/${titleSkillId}/SKILL.md` },
    { id: writer, kind: 'skill', label: `${writer} 写作技能`, path: `writing-skills/${writer}/SKILL.md` },
  ].map((item) => ({ ...item, sourcePath: item.kind === 'json' ? path.join(workspaceRoot, 'account-context.json') : currentSkillFile(workspaceRoot, item.id) }));
}

function compactArticleFeedback(feedback = {}) {
  return Object.fromEntries(['id', 'linked_article_count', 'metric_window_start', 'metric_window_end', 'confidence', 'feature_count', 'topic_signals', 'title_signals', 'body_signals', 'channel_signals', 'recommendations', 'unresolved_questions']
    .filter((key) => feedback[key] !== undefined)
    .map((key) => [key, feedback[key]]));
}

function compactStrategy(strategy = {}) {
  return Object.fromEntries(['ready', 'required_cycles', 'cycle_count', 'cycles', 'account_field_candidates', 'suggestions', 'caveats']
    .filter((key) => strategy[key] !== undefined)
    .map((key) => [key, strategy[key]]));
}

function compactArticleTypeEvidence(evidence = []) {
  return (Array.isArray(evidence) ? evidence : []).map((item) => ({
    skill_id: String(item?.skill_id || ''),
    sample_count: Number(item?.sample_count || 0),
    confidence: String(item?.confidence || ''),
  })).filter((item) => item.skill_id && item.sample_count > 0);
}

function buildFallbackArticlePromptEdit({ promptId, promptContent, feedback = {} } = {}) {
  const sourceSkillId = Object.entries(ARTICLE_TYPE_PROMPTS).find(([, id]) => id === promptId)?.[0];
  const mappedEvidence = sourceSkillId
    ? (feedback?.writer_skill_evidence || []).find((item) => item.skill_id === sourceSkillId && Number(item.sample_count || 0) >= MIN_WRITER_SKILL_SAMPLES)
    : null;
  const signals = mappedEvidence?.body_signals || feedback?.body_signals || [];
  const guidanceById = {
    opening_problem: '开篇先交代读者要解决的具体问题',
    result: '明确写出结论或实际结果',
    evidence: '用可核对的事实或材料支撑结论',
    failure_limits: '说明失败情况、适用条件和限制',
    structured: '多条内容用清晰的小标题或列表组织',
    title_fulfillment: '检查标题中的核心承诺是否在正文中得到回应',
  };
  const selectedGuidance = [...new Set((Array.isArray(signals) ? signals : [])
    .filter((item) => Number(item?.sample_count || 0) >= MIN_WRITER_SKILL_SAMPLES)
    .map((item) => guidanceById[item?.id])
    .filter(Boolean))].slice(0, 4);
  const oldText = String(promptContent || '').trim();
  if (!oldText || oldText.length > 1800 || !selectedGuidance.length) return null;
  return {
    section: '现有正文结构规则',
    old_text: oldText,
    new_text: `${oldText} 同时，${selectedGuidance.join('；')}。`,
    reason: '根据已映射文章类型的正文结构信号补全可执行写作提醒；该候选是待验证的结构建议，不表示历史相关性已证明因果。',
  };
}

export function buildFeedbackAdjustmentPlanningMessages({ feedback, strategy = {}, accountContext = {}, titleSkillId = 'title-generator', titleSkillEvidence = [], articlePromptTargets = [] } = {}) {
  const user = [
    delimitUntrusted('system-derived-strategy-state', compactStrategy(strategy), 4000),
    delimitUntrusted('system-derived-account-context', accountContext, 7000),
    delimitUntrusted('article-type-evidence', compactArticleTypeEvidence(feedback?.writer_skill_evidence), 3000),
    delimitUntrusted('article-prompt-candidates', articlePromptTargets.map(({ id, label, content }) => ({ id, label, rules_preview: String(content || '').slice(0, 1200) })), 8000),
    delimitUntrusted('active-title-skill', { skill_id: titleSkillId, evidence: titleSkillEvidence }, 3000),
    delimitUntrusted('wechat-feedback-evidence', compactArticleFeedback(feedback), 9000),
  ].join('\n\n');
  const system = resolvePrompt('feedback.article-planning', { titleSkillId }).text;
  return { system, user };
}

export function buildFeedbackAdjustmentPatchMessages({ feedback, strategy = {}, accountContext = {}, plan = {}, titleSkillId = 'title-generator', titleSkill = '', articlePromptTargets = [] } = {}) {
  const selectedPromptId = String(plan?.selected_article_prompt_id || '');
  const selectedPrompt = articlePromptTargets.find(({ id }) => id === selectedPromptId);
  const promptSources = selectedPrompt ? [delimitUntrusted(`current-article-prompt-${selectedPrompt.id}`, selectedPrompt.content, 14000)] : [];
  const user = [
    delimitUntrusted('normalized-adjustment-plan', plan, 6000),
    delimitUntrusted('system-derived-strategy-state', compactStrategy(strategy), 3000),
    delimitUntrusted('system-derived-account-context', accountContext, 6000),
    delimitUntrusted('wechat-feedback-evidence', compactArticleFeedback(feedback), 7000),
    delimitUntrusted('current-title-skill-full', titleSkill, 14000),
    delimitUntrusted('allowed-article-prompt-target', { id: selectedPrompt?.id || null }, 500),
    ...promptSources,
  ].join('\n\n');
  const system = resolvePrompt('feedback.article-patching', { titleSkillId }).text;
  return { system, user };
}

// Backward-compatible export for callers that only need to inspect the planning prompt.
export function buildFeedbackAdjustmentMessages(args = {}) { return buildFeedbackAdjustmentPlanningMessages(args); }

function normalizePlanningResult(raw, { feedback = {}, strategy = {}, accountContext = {}, titleSkillId = 'title-generator', articlePromptTargets = [] }) {
  const candidates = new Set(articlePromptTargets.map((item) => item.id));
  const evidence = Array.isArray(feedback?.writer_skill_evidence) ? feedback.writer_skill_evidence : [];
  const mapped = evidence.map((item) => ({ id: ARTICLE_TYPE_PROMPTS[String(item?.skill_id || '')], sample_count: Number(item?.sample_count || 0), source_id: String(item?.skill_id || '') }))
    .filter((item) => item.id && candidates.has(item.id) && item.sample_count >= MIN_WRITER_SKILL_SAMPLES)
    .sort((left, right) => right.sample_count - left.sample_count);
  const rawPromptId = String(raw?.selected_article_prompt_id || raw?.article_prompt_selection?.prompt_id || '');
  const requestedPromptId = ARTICLE_TYPE_PROMPTS[rawPromptId] || rawPromptId;
  const selectedArticlePromptId = candidates.has(requestedPromptId) ? requestedPromptId : mapped[0]?.id || (canInferWriterSkill(feedback) && candidates.has('articles.draft') ? 'articles.draft' : null);
  const articlePromptSelectionSource = selectedArticlePromptId ? mapped.some((item) => item.id === selectedArticlePromptId) ? 'mapped_evidence' : 'ai_inference' : 'none';
  const articlePromptReason = selectedArticlePromptId
    ? articlePromptSelectionSource === 'mapped_evidence'
      ? `根据 ${mapped.find((item) => item.id === selectedArticlePromptId)?.source_id || '已映射文章类型'} 的 ${mapped.find((item) => item.id === selectedArticlePromptId)?.sample_count || 0} 篇样本，选择对应文章类型 Prompt。`
      : '根据正文结构信号选择通用正文生成 Prompt，属于低置信度推断。'
    : rawPromptId
      ? `历史标识 ${rawPromptId} 不对应可编辑的正文 Prompt；本次不修改正文 Prompt。`
      : '当前正文反馈没有足够的文章类型映射或结构信号，暂不修改正文 Prompt。';
  const allowedTargets = new Set([titleSkillId, ...(selectedArticlePromptId ? [selectedArticlePromptId] : [])]);
  const targetIntents = Array.isArray(raw?.target_intents) ? raw.target_intents.map((item) => {
    const rawId = String(item?.target_id || item?.skill_id || '');
    const targetId = rawId === 'title-generator' ? titleSkillId : ARTICLE_TYPE_PROMPTS[rawId] || rawId;
    return { ...item, target_id: targetId, intent: cleanText(item?.intent, 1000), evidence_summary: cleanText(item?.evidence_summary || item?.reason, 800) };
  }).filter((item) => allowedTargets.has(item.target_id) && item.intent).slice(0, 2) : [];
  const articleTypeEvidence = Array.isArray(feedback?.writer_skill_evidence) ? feedback.writer_skill_evidence : [];
  const candidatesProvided = candidates.size > 0;
  if (selectedArticlePromptId && !targetIntents.some((item) => item.target_id === selectedArticlePromptId) && (feedback?.body_signals || []).length) {
    const bodySignals = feedback.body_signals.slice(0, 4);
    const signalLabels = bodySignals.map((item) => item.label || item.id).filter(Boolean);
    if (signalLabels.length) targetIntents.push({ target_id: selectedArticlePromptId, intent: `把“${signalLabels.join('、')}”转化为正文中可执行、可复用的写作提醒。`, evidence_summary: `来自 ${bodySignals.reduce((sum, item) => sum + Number(item.sample_count || 0), 0)} 篇已关联正文结构信号；作为待验证方向，不代表因果结论。` });
  }
  const warnings = Array.isArray(raw?.warnings) ? raw.warnings.map((item) => cleanText(item, 500)).filter(Boolean)
    .filter((item) => !(candidatesProvided && /article_prompt_candidates.{0,30}(缺少|未提供|没有)|(?:缺少|未提供|没有).{0,30}article_prompt_candidates/i.test(item)))
    .filter((item) => !(articleTypeEvidence.length && /article_type_evidence.{0,40}(缺少|未提供|没有|截断)|(?:缺少|未提供|没有|截断).{0,40}article_type_evidence/i.test(item)))
    .filter((item) => !(strategy?.ready !== undefined && /strategy.{0,40}(运行时字段|缺少|未提供)|(?:缺少|未提供).{0,30}strategy/i.test(item)))
    .slice(0, 12) : [];
  if (rawPromptId && !candidates.has(requestedPromptId) && !mapped.length) warnings.push(`忽略了不在正文 Prompt 候选清单中的标识 ${rawPromptId}。`);
  const mappedAccountFields = [];
  if (strategy?.account_field_candidates?.contentPillars?.changed) mappedAccountFields.push('contentPillars');
  if (strategy?.account_field_candidates?.contentRatio?.changed) mappedAccountFields.push('contentRatio');
  const rawAccountIntent = raw?.account_intent && typeof raw.account_intent === 'object'
    ? { action: raw.account_intent.action === 'update' ? 'update' : 'no_change', intent: cleanText(raw.account_intent.intent, 1000), evidence_summary: cleanText(raw.account_intent.evidence_summary || raw.account_intent.reason, 800) }
    : { action: 'no_change', intent: '', evidence_summary: '' };
  const accountIntent = strategy?.ready === true && mappedAccountFields.length
    ? { action: 'update', intent: `将跨周期题材信号映射到现有账号定位字段：${mappedAccountFields.join('、')}`, evidence_summary: `${mappedAccountFields.join('、')} 的候选值由服务端按现有字段和可映射题材生成，仅作下一轮策略讨论；历史相关性不代表因果。` }
    : rawAccountIntent;
  const rawSummary = cleanText(raw?.summary, 500);
  const falseAbsenceClaim = (candidatesProvided && /(?:缺少|未提供|没有).{0,40}(?:article_prompt_candidates|正文 Prompt 候选)/i.test(rawSummary))
    || (articleTypeEvidence.length && /(?:缺少|未提供|没有).{0,40}article_type_evidence/i.test(rawSummary))
    || (strategy?.ready !== undefined && /(?:缺少|未提供|没有).{0,40}(?:strategy|运行时字段|运行时上下文)/i.test(rawSummary))
    || (accountContext && Object.keys(accountContext).length && /(?:缺少|未提供|没有).{0,40}(?:account_context|账号上下文|运行时上下文)/i.test(rawSummary));
  const summary = mappedAccountFields.length
    ? `基于跨周期且可映射到现有配置的题材信号，提出 ${mappedAccountFields.join('、')} 的账号调整候选；读者画像和关注承诺保持不变。`
    : falseAbsenceClaim
      ? `基于已提供的反馈与系统运行时状态生成草案${targetIntents.length ? `：${targetIntents.map((item) => item.intent).join('；')}` : ''}`
      : rawSummary || '根据复盘信号生成最小调整草案';
  return { version: FEEDBACK_ADJUSTMENT_VERSION, titleSkillId, summary, selectedArticlePromptId, articlePromptSelectionSource, articlePromptReason, targetIntents, accountIntent, warnings };
}

export function normalizeFeedbackAdjustmentPlanning({ raw, feedback, strategy = {}, accountContext = {}, titleSkillId = 'title-generator', articlePromptTargets = [] } = {}) {
  return normalizePlanningResult(raw || {}, { feedback, strategy, accountContext, titleSkillId, articlePromptTargets });
}

export function buildAdjustmentDraft({ workspaceRoot, feedback, strategy, accountContext, modelResult = {}, titleSkillId = 'title-generator', titleSkillEvidence = [], titleSkillSelectionSource = '', currentWriterSkillId = '', writerSkillId = '', writerSkillEvidence = feedback?.writer_skill_evidence || [], articlePromptTargets = [], provider = '', model = '' } = {}) {
  const resolvedArticlePromptTargets = articlePromptTargets.length ? articlePromptTargets : listArticlePromptTargets({ workspaceRoot, articleTypeEvidence: writerSkillEvidence });
  const planning = normalizePlanningResult(modelResult.planning || modelResult.plan || modelResult, { feedback, strategy, accountContext, titleSkillId, articlePromptTargets: resolvedArticlePromptTargets });
  const patch = modelResult.patch || {};
  const selectedArticlePromptId = planning.selectedArticlePromptId;
  const accountPath = path.join(workspaceRoot, 'account-context.json');
  const accountOld = fs.existsSync(accountPath) ? fs.readFileSync(accountPath, 'utf8') : jsonText(accountContext || getAccountContext({ workspaceRoot }));
  let accountBefore; try { accountBefore = JSON.parse(accountOld); } catch { accountBefore = accountContext || getAccountContext({ workspaceRoot }); }
  const modelAccountPatch = sanitizeAccountPatch(patch.account_patch, accountContext, strategy);
  const mappedAccountPatch = resolveMappedAccountPatch(accountContext, strategy);
  const accountPatch = mergePatch(mappedAccountPatch, modelAccountPatch);
  const accountAfter = mergePatch(accountBefore, accountPatch);
  const accountWarnings = [];
  if (strategy?.ready === false) {
    const cycleCount = Number(strategy.cycle_count ?? strategy.cycles?.length ?? 0);
    const requiredCycles = Number(strategy.required_cycles || 2);
    accountWarnings.push(`账号配置未调整：系统策略尚未就绪，当前 ${cycleCount}/${requiredCycles} 个有效内容周期；每个周期至少需要关联 3 篇正文。`);
  } else if (strategy?.ready !== true && planning.accountIntent.action === 'update') {
    accountWarnings.push('账号配置未调整：系统未提供 strategy.ready 状态，无法确认账号策略是否达到调整门槛。');
  }
  if (planning.accountIntent.action === 'update' && strategy?.ready === true && !Object.keys(accountPatch).length) {
    accountWarnings.push('账号配置未调整：提案没有匹配到服务端生成且发生变化的 contentPillars 或 contentRatio 候选；简介、读者画像和关注承诺不由阅读相关性自动改写。');
  }
  if (strategy?.ready === true && planning.accountIntent.action !== 'update' && !Object.keys(accountPatch).length) {
    accountWarnings.push('账号定位未调整：跨周期题材信号没有映射到可变更的现有内容支柱或内容配比；读者画像、简介和关注承诺缺少可支持改写的受众证据。');
  }
  const accountContextProvided = Boolean(accountContext && typeof accountContext === 'object' && !Array.isArray(accountContext) && Object.keys(accountContext).length);
  const isFalseMissingContextWarning = (item) => accountContextProvided && /(?:账号配置|account_context).*(?:缺少|未提供|缺失|不存在).*(?:运行时上下文|account_context|账号上下文)|(?:缺少|未提供|缺失|不存在).*(?:运行时上下文|account_context|账号上下文)/i.test(item);
  const strategyStateProvided = strategy && typeof strategy === 'object' && strategy.ready !== undefined && strategy.cycle_count !== undefined;
  const isFalseMissingStrategyWarning = (item) => strategyStateProvided && /(?:strategy|策略).{0,50}(?:运行时字段|缺少|未提供|缺失)|(?:缺少|未提供|缺失).{0,35}(?:strategy|策略).{0,30}(?:ready|cycle_count|周期)/i.test(item);
  const articlePromptCandidatesProvided = resolvedArticlePromptTargets.length > 0;
  const changes = [];
  if (Object.keys(accountPatch).length) changes.push({ id: 'account-context', kind: 'json', label: '账号策略与选题评分', path: 'account-context.json', old_content: accountOld, new_content: jsonText(accountAfter), old_hash: sha256(accountOld), new_hash: sha256(jsonText(accountAfter)), reason: planning.accountIntent.evidence_summary || planning.accountIntent.intent || '根据复盘中的题材、标题和分发信号校准账号策略或选题评分。' });
  const resolvedTitleSkillId = planning.titleSkillId || titleSkillId || 'title-generator';
  const titlePath = currentSkillFile(workspaceRoot, resolvedTitleSkillId);
  const selectedPromptPath = selectedArticlePromptId ? path.join(workspaceRoot, 'prompts', ARTICLE_PROMPT_FILES[selectedArticlePromptId]) : '';
  const skillEdits = Array.isArray(patch.skill_edits) ? patch.skill_edits : [];
  const promptEdits = Array.isArray(patch.prompt_edits) ? patch.prompt_edits : [];
  const allowedSkills = new Set([resolvedTitleSkillId]);
  const modelWarnings = [...planning.warnings, ...(Array.isArray(patch.warnings) ? patch.warnings.map((item) => cleanText(item, 500)).filter(Boolean) : [])];
  const falseMissingContextClaim = modelWarnings.some(isFalseMissingContextWarning);
  if (falseMissingContextClaim && strategy?.ready === true && planning.accountIntent.action !== 'update') {
    accountWarnings.push('账号配置未调整：account_context 已由系统提供，但本次提案没有提出可验证的账号配置修改。');
  }
  const hasAccountPatch = Object.keys(accountPatch).length > 0;
  const warnings = [...modelWarnings.filter((item) => !isFalseMissingContextWarning(item) && !isFalseMissingStrategyWarning(item)
    && !(hasAccountPatch && /(?:账号配置|账号定位).*(?:不调整|不变|未调整)|account_patch.{0,20}(?:空|不修改)/i.test(item))
    && !(articlePromptCandidatesProvided && /article_prompt_candidates.{0,30}(缺少|未提供|没有)|(?:缺少|未提供|没有).{0,30}article_prompt_candidates|无法从候选清单选择正文 Prompt/i.test(item))
    && !(articlePromptCandidatesProvided && selectedArticlePromptId && /(?:缺少|未提供|没有|截断).{0,35}article_type_evidence|article_type_evidence.{0,40}(缺少|未提供|没有|截断)|selected_article_prompt_id.{0,25}(null|为空|未提供)/i.test(item))), ...accountWarnings];
  for (const rawUpdate of skillEdits.slice(0, 2)) {
    const rawSkillId = String(rawUpdate?.skill_id || '');
    const update = rawSkillId === 'title-generator' ? { ...rawUpdate, skill_id: resolvedTitleSkillId } : rawUpdate;
    if (!allowedSkills.has(update.skill_id)) continue;
    const sourcePath = update.skill_id === resolvedTitleSkillId ? titlePath : '';
    if (!sourcePath) continue;
    const oldContent = fs.readFileSync(sourcePath, 'utf8');
    const applied = applySkillEdits(oldContent, update.edits);
    warnings.push(...applied.warnings);
    if (!applied.applied.length || applied.content === oldContent) continue;
    changes.push({ id: update.skill_id, kind: 'skill', label: '标题生成技能', path: `writing-skills/${update.skill_id}/SKILL.md`, source_path: path.relative(workspaceRoot, sourcePath).replaceAll('\\', '/'), old_content: oldContent, new_content: applied.content, old_hash: sha256(oldContent), new_hash: sha256(applied.content), edits: applied.applied, reason: applied.applied.map((item) => item.reason).filter(Boolean).join('；') || '根据反馈证据生成针对原有规则的精确修改。' });
  }
  if (selectedPromptPath && fs.existsSync(selectedPromptPath)) {
    const oldContent = fs.readFileSync(selectedPromptPath, 'utf8');
    const selectedEdits = promptEdits.filter((item) => String(item?.target_id || item?.prompt_id || '') === selectedArticlePromptId || !item?.target_id && !item?.prompt_id);
    let applied = applySkillEdits(oldContent, selectedEdits);
    let usedFallback = false;
    if (!applied.applied.length) {
      const fallbackEdit = buildFallbackArticlePromptEdit({ promptId: selectedArticlePromptId, promptContent: oldContent, feedback });
      if (fallbackEdit) {
        applied = applySkillEdits(oldContent, [fallbackEdit]);
        usedFallback = applied.applied.length > 0;
      }
    }
    warnings.push(...applied.warnings.map((item) => item.replaceAll('技能修改', 'Prompt 修改')));
    if (usedFallback) {
      for (let index = warnings.length - 1; index >= 0; index -= 1) {
        if (/Prompt 修改缺少 old_text 或 new_text，已跳过/.test(warnings[index])) warnings.splice(index, 1);
      }
      warnings.push('第二阶段未返回可应用的正文 Prompt 编辑；已根据已映射正文信号生成一条最小候选，需人工复核。');
    }
    if (applied.applied.length && applied.content !== oldContent) {
      const relativeFile = ARTICLE_PROMPT_FILES[selectedArticlePromptId];
      changes.push({ id: selectedArticlePromptId, kind: 'prompt', label: resolvedArticlePromptTargets.find((item) => item.id === selectedArticlePromptId)?.label || selectedArticlePromptId, path: `prompts/${relativeFile}`, source_path: relativeFile, prompt_version: promptVersion(workspaceRoot, selectedArticlePromptId), old_content: oldContent, new_content: applied.content, old_hash: sha256(oldContent), new_hash: sha256(applied.content), edits: applied.applied, reason: applied.applied.map((item) => item.reason).filter(Boolean).join('；') || '根据反馈证据生成针对正文 Prompt 的精确修改。' });
    }
  }
  return { version: FEEDBACK_ADJUSTMENT_VERSION, feedback_snapshot_id: feedback?.id || null, generated_at: new Date().toISOString(), provider, model, summary: planning.summary, warnings: [...new Set(warnings)], changes, source: { adjustment_version: FEEDBACK_ADJUSTMENT_VERSION, confidence: feedback?.confidence || 'low', linked_article_count: Number(feedback?.linked_article_count || 0), metric_window: [feedback?.metric_window_start || '', feedback?.metric_window_end || ''], strategy_ready: Boolean(strategy?.ready), title_skill_id: resolvedTitleSkillId, title_skill_selection_source: titleSkillSelectionSource || (titleSkillEvidence.length ? 'artifact-manifest' : 'workspace-default'), title_skill_evidence: titleSkillEvidence, article_prompt_id: selectedArticlePromptId, article_prompt_selection_source: planning.articlePromptSelectionSource, article_prompt_reason: planning.articlePromptReason, stages: ['planning', 'patch'] } };
}

export function confirmAdjustmentDraft({ workspaceRoot, draft } = {}) {
  if (!draft || draft.status && draft.status !== 'pending') throw new Error('调整草案不是待确认状态');
  if (draft.source?.adjustment_version !== FEEDBACK_ADJUSTMENT_VERSION) { const error = new Error('调整草案来自旧版本，请重新生成'); error.code = 'ADJUSTMENT_DRAFT_STALE'; throw error; }
  const targets = [];
  for (const change of draft.changes || []) {
    if (change.kind === 'prompt') {
      const relativeFile = ARTICLE_PROMPT_FILES[change.id];
      if (!relativeFile || change.path !== `prompts/${relativeFile}`) throw new Error(`调整草案 Prompt 不在允许范围：${change.path}`);
      const target = path.resolve(workspaceRoot, change.path);
      if (!target.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`)) throw new Error('调整草案路径越界');
      const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (sha256(current) !== change.old_hash) { const error = new Error(`文件已被修改，请重新生成草案：${change.path}`); error.code = 'ADJUSTMENT_SOURCE_CONFLICT'; throw error; }
      if (promptVersion(workspaceRoot, change.id) !== Number(change.prompt_version)) { const error = new Error(`Prompt 登记版本已变化，请重新生成草案：${change.id}`); error.code = 'ADJUSTMENT_SOURCE_CONFLICT'; throw error; }
      targets.push({ change, target });
      continue;
    }
    const relativePath = change.kind === 'json' ? '' : String(change.file || 'SKILL.md').replaceAll('\\', '/');
    if (change.kind !== 'json' && !ALLOWED_SKILL_RULE_FILES.includes(relativePath)) throw new Error(`调整草案技能文件不在允许范围：${relativePath}`);
    const expected = change.kind === 'json' ? 'account-context.json' : `writing-skills/${change.id}/${relativePath}`;
    if (change.path !== expected) throw new Error(`调整草案路径不在允许范围：${change.path}`);
    const target = path.resolve(workspaceRoot, change.path);
    if (!target.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`)) throw new Error('调整草案路径越界');
    const sourcePath = change.kind === 'json' ? '' : currentSkillPackageFile(workspaceRoot, change.id, relativePath);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : change.kind === 'json' ? String(change.old_content || '') : sourcePath ? fs.readFileSync(sourcePath, 'utf8') : (() => { throw new Error(`调整草案源文件不存在：${change.id}`); })();
    if (sha256(current) !== change.old_hash) { const error = new Error(`文件已被修改，请重新生成草案：${change.path}`); error.code = 'ADJUSTMENT_SOURCE_CONFLICT'; throw error; }
    targets.push({ change, target });
  }
  const written = [];
  for (const { change, target } of targets) {
    if (change.kind === 'json') { atomicWriteJson(target, JSON.parse(change.new_content)); loadAccountContext(target); }
    else atomicWriteUtf8(target, change.new_content);
    written.push(change.path);
  }
  const promptChanges = targets.map(({ change }) => change).filter((change) => change.kind === 'prompt');
  if (promptChanges.length) {
    const manifestPath = path.join(workspaceRoot, 'prompts', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const change of promptChanges) {
      const entry = manifest.prompts.find((item) => item.id === change.id);
      if (!entry || Number(entry.version) !== Number(change.prompt_version)) throw new Error(`Prompt 登记版本已变化，请重新生成草案：${change.id}`);
      entry.version = Number(entry.version) + 1;
    }
    atomicWriteJson(manifestPath, manifest);
  }
  return { written };
}
