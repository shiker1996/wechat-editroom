import { classifyGitHubRepository, extractScenarioIds, normalizeGitHubRepository } from '../../shared/domain/github-repository.mjs';

export const PROJECT_DISCOVERY_FEEDBACK_VERSION = 'v1';
export const PROJECT_DISCOVERY_FEEDBACK_MINIMUM_SAMPLES = 5;
export const PROJECT_DISCOVERY_FEEDBACK_DELTA_LIMITS = Object.freeze({ scenarioHigh: 5, scenarioLow: -3, typeHigh: 2, typeLow: -2, total: 8 });

const SCENARIO_LABELS = Object.freeze({
  'file-content': '文件与内容处理', 'terminal-remote': '终端与远程开发', 'browser-automation': '浏览器自动化',
  'data-observability': '数据、同步与可观测', 'developer-productivity': '开发效率', 'privacy-local': '隐私与本地化',
  'reusable-components': '可复用组件', 'skills-workflows': 'Skill 与工作流',
});
const TYPE_LABELS = Object.freeze({ tool: '工具', component: '组件', 'plugin-extension': '插件与扩展', 'skill-workflow': 'Skill 与工作流', 'data-content': '数据与内容工具', infrastructure: '基础设施', 'ai-utility': 'AI 实用工具', agent: 'Agent' });

function json(value, fallback = {}) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function median(values) { const sorted = values.map((value) => finite(value)).sort((a, b) => a - b); if (!sorted.length) return 0; const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function confidence(count) { return count >= 8 ? 'high' : count >= 5 ? 'medium' : 'low'; }
function ratio(value, base) { return base > 0 ? Number((value / base).toFixed(2)) : 0; }
function labelForScenario(id) { return SCENARIO_LABELS[id] || id; }
function labelForType(id) { return TYPE_LABELS[id] || id; }

function metadataForRow(row = {}) {
  const raw = json(row.hotspot_raw_json, {});
  const declared = raw.repositoryMeta || raw.repository_meta || raw;
  const queryContext = {
    lane: raw.lane || raw.discoveryLane || raw.discovery_lane || '', query: raw.searchQuery || raw.search_query || '',
    label: raw.discoveryLabel || raw.discovery_label || '', projectType: raw.projectType || raw.project_type || '',
    projectTypes: raw.projectTypes || raw.project_types || [], directUseCase: raw.directUseCase || raw.direct_use_case || '',
    scenarioIds: raw.scenarioIds || raw.scenario_ids || [],
  };
  const classified = classifyGitHubRepository(declared, queryContext);
  const repository = normalizeGitHubRepository(declared.repository || row.hotspot_url || row.url || '');
  const scenarios = extractScenarioIds({ scenarioIds: declared.scenarioIds || declared.scenario_ids || queryContext.scenarioIds })
    .concat(classified.scenarioIds || []).filter(Boolean);
  return {
    repository, projectType: String(declared.projectType || declared.project_type || classified.projectType || '').trim(),
    scenarioIds: [...new Set(scenarios)].slice(0, 4), directUseCase: String(declared.directUseCase || declared.direct_use_case || classified.directUseCase || '').trim(),
    source: raw.source || row.hotspot_source || '',
  };
}

function normalizeRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && ['confirmed', 'auto_confirmed'].includes(row.match_status || row.status)
    && (row.content_type === 'social' || row.artifact_type === '图文发布文案' || row.content_class === 'github_project'))
    .map((row) => {
      const metadata = metadataForRow(row);
      return {
        metricId: Number(row.metric_id) || null, batchId: row.import_batch_id || null, publishedDate: String(row.published_date || '').slice(0, 10),
        title: String(row.metric_title || row.artifact_title || row.hotspot_title || '').trim(), reads: Math.max(0, finite(row.reads)), shares: Math.max(0, finite(row.shares)),
        follows: Math.max(0, finite(row.follows_after_read)), ...metadata,
      };
    }).filter((row) => row.repository || row.scenarioIds.length || row.projectType);
}

function performance(items, baseline) {
  const reads = items.reduce((sum, item) => sum + item.reads, 0);
  const shares = items.reduce((sum, item) => sum + item.shares, 0);
  const follows = items.reduce((sum, item) => sum + item.follows, 0);
  const med = median(items.map((item) => item.reads));
  return {
    sample_count: items.length, median_reads: Math.round(med), avg_reads: items.length ? Math.round(reads / items.length) : 0,
    median_read_ratio: ratio(med, baseline), total_reads: reads, total_shares: shares, total_follows: follows,
    shares_per_thousand_reads: reads ? Number((shares / reads * 1000).toFixed(2)) : 0,
    follows_per_thousand_reads: reads ? Number((follows / reads * 1000).toFixed(2)) : 0,
    confidence: confidence(items.length), metric_ids: items.map((item) => item.metricId).filter(Boolean),
  };
}

function groupSignals(items, keyOf, labelOf, baseline) {
  const groups = new Map();
  for (const item of items) for (const key of keyOf(item)) {
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].map(([key, group]) => ({ id: key, label: labelOf(key), ...performance(group, baseline) }))
    .sort((left, right) => right.median_reads - left.median_reads || right.shares_per_thousand_reads - left.shares_per_thousand_reads);
}

function adjustmentFor(signal, kind, baselineShares) {
  if (signal.sample_count < PROJECT_DISCOVERY_FEEDBACK_MINIMUM_SAMPLES) return null;
  if (signal.median_read_ratio >= 1.2) return { id: signal.id, label: signal.label, delta: kind === 'scenario' ? PROJECT_DISCOVERY_FEEDBACK_DELTA_LIMITS.scenarioHigh : PROJECT_DISCOVERY_FEEDBACK_DELTA_LIMITS.typeHigh, reason: `${signal.label}样本的阅读中位数约为账号项目样本基线的 ${signal.median_read_ratio} 倍`, sample_count: signal.sample_count, confidence: signal.confidence };
  if (signal.median_read_ratio <= 0.8) return { id: signal.id, label: signal.label, delta: kind === 'scenario' ? PROJECT_DISCOVERY_FEEDBACK_DELTA_LIMITS.scenarioLow : PROJECT_DISCOVERY_FEEDBACK_DELTA_LIMITS.typeLow, reason: `${signal.label}样本的阅读中位数约为账号项目样本基线的 ${signal.median_read_ratio} 倍`, sample_count: signal.sample_count, confidence: signal.confidence };
  if (kind === 'type' && baselineShares > 0 && signal.shares_per_thousand_reads >= baselineShares * 1.25) return { id: signal.id, label: signal.label, delta: PROJECT_DISCOVERY_FEEDBACK_DELTA_LIMITS.typeHigh, reason: `${signal.label}的分享率高于项目样本基线，建议增加清单/工具型包装机会`, sample_count: signal.sample_count, confidence: signal.confidence };
  return null;
}

export function buildProjectDiscoveryFeedbackSnapshot(rows = [], { generatedAt = new Date().toISOString(), minimumSamples = PROJECT_DISCOVERY_FEEDBACK_MINIMUM_SAMPLES } = {}) {
  const items = normalizeRows(rows);
  const dates = items.map((item) => item.publishedDate).filter(Boolean).sort();
  const baselineReads = median(items.map((item) => item.reads));
  const baselineShares = performance(items, baselineReads).shares_per_thousand_reads;
  const scenarios = groupSignals(items, (item) => item.scenarioIds, labelForScenario, baselineReads);
  const projectTypes = groupSignals(items, (item) => [item.projectType], labelForType, baselineReads);
  const repositories = groupSignals(items, (item) => [item.repository], (value) => value, baselineReads);
  const scenarioAdjustments = scenarios.map((signal) => adjustmentFor(signal, 'scenario', baselineShares)).filter(Boolean);
  const projectTypeAdjustments = projectTypes.map((signal) => adjustmentFor(signal, 'type', baselineShares)).filter(Boolean);
  const unresolved = [];
  if (!items.length) unresolved.push('暂无已确认并能关联 GitHub 仓库的图文指标。');
  if (items.length < minimumSamples) unresolved.push(`当前只有 ${items.length} 个项目样本，少于 ${minimumSamples} 个校准所需样本；本次只展示结果，不建议应用权重。`);
  const missingMetadata = (Array.isArray(rows) ? rows : []).filter((row) => ['confirmed', 'auto_confirmed'].includes(row?.match_status || row?.status)).length - items.length;
  if (missingMetadata > 0) unresolved.push(`${missingMetadata} 条已确认指标缺少可识别的仓库或场景元数据。`);
  unresolved.push('阅读、分享和关注只能说明历史相关性，不能证明某个项目或场景直接造成结果。');
  const adjustments = { scenarios: scenarioAdjustments, project_types: projectTypeAdjustments };
  const recommendationCount = scenarioAdjustments.length + projectTypeAdjustments.length;
  return {
    version: PROJECT_DISCOVERY_FEEDBACK_VERSION, generated_at: generatedAt, metric_window_start: dates[0] || '', metric_window_end: dates.at(-1) || '',
    source_metric_ids: items.map((item) => item.metricId).filter(Boolean), source_batch_ids: [...new Set(items.map((item) => item.batchId).filter(Boolean))],
    matched_project_count: new Set(items.map((item) => item.repository).filter(Boolean)).size, sample_count: items.length,
    confidence: confidence(items.length), baseline: { median_reads: Math.round(baselineReads), shares_per_thousand_reads: baselineShares },
    scenario_signals: scenarios.slice(0, 20), project_type_signals: projectTypes.slice(0, 20), repository_signals: repositories.slice(0, 20),
    adjustments, recommendations: recommendationCount ? [{ type: 'github_discovery', target: '项目发现权重', text: `建议对 ${recommendationCount} 个场景或项目类型调整下一批项目发现排序；需要人工确认后生效。`, basis: `${items.length} 个已匹配项目样本`, confidence: confidence(items.length) }] : [],
    unresolved_questions: unresolved, samples: items.slice().sort((a, b) => b.reads - a.reads).slice(0, 20).map((item) => ({ repository: item.repository, project_type: item.projectType, scenario_ids: item.scenarioIds, title: item.title, reads: item.reads, shares: item.shares, follows_after_read: item.follows, metric_id: item.metricId })),
    can_apply: items.length >= minimumSamples && recommendationCount > 0,
  };
}

function adjustmentForItem(item, feedback) {
  const scenarioMap = new Map((feedback?.adjustments?.scenarios || []).map((entry) => [String(entry.id), finite(entry.delta)]));
  const typeMap = new Map((feedback?.adjustments?.project_types || []).map((entry) => [String(entry.id), finite(entry.delta)]));
  const scenarioDelta = (item?.scenarioIds || []).reduce((sum, id) => sum + (scenarioMap.get(String(id)) || 0), 0);
  const typeDelta = typeMap.get(String(item?.projectType || '')) || 0;
  return Math.max(-PROJECT_DISCOVERY_FEEDBACK_DELTA_LIMITS.total, Math.min(PROJECT_DISCOVERY_FEEDBACK_DELTA_LIMITS.total, scenarioDelta + typeDelta));
}

function isProject(item) { return item?.contentClass === 'github_project' || item?.content_class === 'github_project' || Boolean(item?.repositoryMeta); }

export function projectDiscoveryFeedbackAdjustment(item, feedback) {
  if (!isProject(item)) return 0;
  const repository = item.repositoryMeta || item;
  return adjustmentForItem({ projectType: repository.projectType || repository.project_type, scenarioIds: repository.scenarioIds || repository.scenario_ids }, feedback);
}

function withFeedback(item, feedback) {
  if (!isProject(item)) return item;
  const repositoryMeta = item.repositoryMeta || {};
  const adjustment = projectDiscoveryFeedbackAdjustment(item, feedback);
  return { ...item, repositoryMeta: { ...repositoryMeta, projectFeedbackAdjustment: adjustment }, projectFeedbackAdjustment: adjustment };
}

function rerank(items) { return items.map((item, index) => ({ ...item, rank: index + 1 })); }

export function applyProjectDiscoveryFeedbackToHeatRanking(eventHeatRanking, feedback) {
  if (!feedback || !eventHeatRanking) return eventHeatRanking;
  const adjust = (item) => {
    if (!isProject(item)) return item;
    const next = withFeedback(item, feedback); const delta = finite(next.projectFeedbackAdjustment);
    const scoreValue = Math.max(0, Math.min(100, finite(item.scoreValue ?? item.heatScore) + delta));
    return { ...next, baselineScoreValue: finite(item.scoreValue ?? item.heatScore), scoreValue, heatScore: scoreValue, eventValue: scoreValue, t: scoreValue, scoreModel: `${item.scoreModel || 'projectDiscoveryScore'}+feedback-v1` };
  };
  const items = rerank((eventHeatRanking.items || []).map(adjust).sort((a, b) => finite(b.scoreValue) - finite(a.scoreValue) || String(a.eventId || '').localeCompare(String(b.eventId || ''))));
  const projectBoard = items.filter((item) => item.contentClass === 'github_project').map((item, index) => ({ ...item, rank: index + 1, boardRank: index + 1, rankScope: 'github_project' }));
  return { ...eventHeatRanking, generatedAt: new Date().toISOString(), items, rankings: { ...(eventHeatRanking.rankings || {}), github_project: { ...(eventHeatRanking.rankings?.github_project || {}), scoreModel: 'projectDiscoveryScore+feedback-v1', items: projectBoard, totalEvents: projectBoard.length } } };
}

export function applyProjectDiscoveryFeedbackToRanking(ranking = [], feedback = null) {
  return ranking.map((item) => {
    const next = withFeedback(item, feedback); if (!isProject(item)) return item;
    const delta = finite(next.projectFeedbackAdjustment);
    return { ...next, finalPreScore: finite(item.finalPreScore) + delta, eventValue: Math.max(0, Math.min(100, finite(item.eventValue) + delta)), t: Math.max(0, Math.min(100, finite(item.t) + delta)), feedbackAdjustmentReason: delta ? '已应用人工确认的项目发现反馈' : '' };
  }).sort((a, b) => finite(b.finalPreScore) - finite(a.finalPreScore) || String(a.title || '').localeCompare(String(b.title || '')));
}
