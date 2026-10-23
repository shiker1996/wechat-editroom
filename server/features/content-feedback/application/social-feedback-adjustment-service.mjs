import fs from 'node:fs';
import { resolvePrompt } from '../../../platform/llm/prompt-registry.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { delimitUntrusted } from '../../../platform/llm/context-safety.mjs';
import { ALLOWED_SKILL_RULE_FILES, currentSkillPackageFile, FEEDBACK_ADJUSTMENT_VERSION } from './feedback-adjustment-service.mjs';
import { resolveSocialSkillTargetsFromEvidence } from '../domain/social-feedback-adjustment.mjs';
import { applySkillEdits } from '../domain/skill-editing.mjs';

export const SOCIAL_COPY_SKILL_ID = 'xiaohongshu-article-generator';
const STORYBOARD_SKILLS = new Set([
  'repository-card-storyboard', 'event-card-storyboard', 'custom-card-storyboard',
]);
const STORYBOARD_RULE_FILES = ['SKILL.md', 'references/storyboard.md'];
const COPY_RULE_FILES = ['SKILL.md', 'TITLE_GUIDE.md', 'COPY_GUIDE.md', 'references/copy-tool.md', 'references/copy-event.md', 'references/copy-custom.md'];

function clean(value, max = 1200) { return String(value || '').trim().slice(0, max); }
function hash(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function socialStageManifest(filePath) {
  if (!filePath) return null;
  const directory = path.dirname(filePath);
  const executions = readJson(path.join(directory, 'social-card-stage-executions.json'));
  const skillManifest = readJson(path.join(directory, 'social-card-skill-manifest.json'));
  return { executions, skillManifest };
}

function targetFromMatch(match) {
  const manifest = socialStageManifest(match?.file_path);
  const planning = manifest?.executions?.find((item) => item.stage === 'planning')?.skill || '';
  const generation = manifest?.executions?.find((item) => item.stage === 'generation')?.skill
    || manifest?.skillManifest?.generator?.skill || '';
  return {
    storyboard: STORYBOARD_SKILLS.has(planning) ? planning : '',
    copy: generation || '',
  };
}

export function resolveSocialSkillTargets({ matches = [] } = {}) {
  const rows = (Array.isArray(matches) ? matches : []).filter((item) => ['confirmed', 'auto_confirmed'].includes(item?.status)
    && (item?.content_type === 'social' || item?.artifact_type === '图文发布文案'));
  return resolveSocialSkillTargetsFromEvidence(rows.map((row) => {
    const target = targetFromMatch(row);
    return { storyboard_skill_id: target.storyboard, copy_skill_id: target.copy };
  }));
}

function targetText(targets) { return targets.map((item) => `${item.skill_id}（${item.role}，${item.sample_count} 个样本）`).join('、'); }
function ruleFilesForRole(role) { return role === 'storyboard' ? STORYBOARD_RULE_FILES : COPY_RULE_FILES; }
function skillBundleText(id, bundle) {
  if (typeof bundle === 'string') return `\n\n${delimitUntrusted(`current-social-skill-${id}-SKILL.md`, bundle, 16000)}`;
  return Object.entries(bundle || {}).map(([file, content]) => `\n\n${delimitUntrusted(`current-social-skill-${id}-${file}`, content, 12000)}`).join('');
}

export function buildSocialFeedbackAdjustmentPlanningMessages({ feedback = {}, targets = [] } = {}) {
  const source = { feedback, social_targets: targets, target_roles: { storyboard: '故事板：页面结构、信息分块和叙事节奏', copy: '文案生成：标题、逐页文案、发布文案和话题标签' } };
  const user = delimitUntrusted('social-feedback-evidence', source, 18000);
  const targetIds = targets.map((item) => item.skill_id).join('、');
  const system = resolvePrompt('feedback.social-planning', { targetIds, targetText: targetText(targets) }).text;
  return { system, user };
}

export function buildSocialFeedbackAdjustmentPatchMessages({ feedback = {}, plan = {}, skills = {} } = {}) {
  const source = { plan, feedback };
  const files = Object.entries(skills).map(([id, content]) => skillBundleText(id, content)).join('');
  const system = resolvePrompt('feedback.social-patching').text;
  return { system, user: `${delimitUntrusted('social-adjustment-plan', source, 12000)}${files}` };
}

export function buildSocialFeedbackAdjustmentDraft({ workspaceRoot, feedback = {}, targets = [], modelResult = {}, provider = '', model = '', targetEvidence = [] } = {}) {
  const plan = modelResult.planning || modelResult.plan || {};
  const allowed = new Set(targets.map((item) => item.skill_id));
  const intents = (Array.isArray(plan.target_intents) ? plan.target_intents : []).map((item) => ({
    skill_id: String(item?.skill_id || ''), intent: clean(item?.intent), evidence_summary: clean(item?.evidence_summary || item?.reason, 800),
  })).filter((item) => allowed.has(item.skill_id) && item.intent);
  const plannedIds = new Set(intents.map((item) => item.skill_id));
  const patch = modelResult.patch || {};
  const warnings = (Array.isArray(plan.warnings) ? plan.warnings : []).map((item) => clean(item, 500)).filter(Boolean);
  for (const item of (Array.isArray(patch.warnings) ? patch.warnings : [])) warnings.push(clean(item, 500));
  const changes = [];
  for (const update of (Array.isArray(patch.skill_edits) ? patch.skill_edits : []).slice(0, 4)) {
    if (!plannedIds.has(String(update?.skill_id || ''))) { warnings.push(`图文技能修改未得到第一阶段意图许可：${String(update?.skill_id || '未知技能')}`); continue; }
    const skillId = String(update.skill_id);
    const role = targets.find((item) => item.skill_id === skillId)?.role || 'social';
    const allowedFiles = ruleFilesForRole(role);
    const relativePath = String(update.file || update.relative_path || 'SKILL.md').replaceAll('\\', '/');
    if (!ALLOWED_SKILL_RULE_FILES.includes(relativePath) || (role !== 'social' && !allowedFiles.includes(relativePath))) { warnings.push(`图文技能文件不在该技能职责允许范围：${skillId}/${relativePath}`); continue; }
    const sourcePath = currentSkillPackageFile(workspaceRoot, skillId, relativePath);
    if (!sourcePath) { warnings.push(`图文技能源文件不存在：${skillId}/${relativePath}`); continue; }
    const oldContent = fs.readFileSync(sourcePath, 'utf8');
    const applied = applySkillEdits(oldContent, update.edits);
    warnings.push(...applied.warnings);
    if (!applied.applied.length || applied.content === oldContent) continue;
    changes.push({ id: skillId, kind: 'skill', file: relativePath, label: role === 'storyboard' ? '图文故事板技能' : '图文文案生成技能', path: `writing-skills/${skillId}/${relativePath}`, source_path: path.relative(workspaceRoot, sourcePath).replaceAll('\\', '/'), old_content: oldContent, new_content: applied.content, old_hash: hash(oldContent), new_hash: hash(applied.content), edits: applied.applied, reason: applied.applied.map((item) => item.reason).filter(Boolean).join('；') || '根据图文复盘证据生成针对原有规则的精确修改。' });
  }
  return { version: FEEDBACK_ADJUSTMENT_VERSION, feedback_snapshot_id: feedback?.id || null, generated_at: new Date().toISOString(), provider, model, summary: clean(plan.summary, 500) || '根据图文复盘信号生成技能调整草案', warnings, changes, source: { adjustment_version: FEEDBACK_ADJUSTMENT_VERSION, scope: 'social', linked_social_count: Number(feedback?.linked_social_count || 0), title_signals: feedback?.title_signals || [], target_evidence: targetEvidence, targets, stages: ['planning', 'patch'] } };
}
