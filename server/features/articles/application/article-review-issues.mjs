import fs from 'node:fs';

const ISSUE_LABELS = {
  title: '标题',
  citation: '引用',
  fact: '事实',
  logic: '论证',
  expression: '表达',
  style: '表达',
  publication_compliance: '发布合规',
  reputation: '名誉风险',
  financial: '财经风险',
  privacy: '隐私风险',
  copyright: '版权风险',
  research: '研判贴合度',
  review: '审稿',
  output: '输出契约',
};

const JSON_ARTIFACTS = new Map([
  ['03-title-risk.json', { stage: 'title', label: '标题检查' }],
  ['04-quality-gate.json', { stage: 'draft-quality', label: '初稿质量检查' }],
  ['06-quality-gate.json', { stage: 'daily-quality', label: '早报质量检查' }],
  ['06-review-quality-gate.json', { stage: 'review', label: '审稿检查' }],
  ['08-quality-gate.json', { stage: 'final-quality', label: '终稿质量检查' }],
  ['10-publication-compliance.json', { stage: 'publication', label: '发布合规检查' }],
  ['research-coverage-review.json', { stage: 'research', label: '研判贴合度检查' }],
]);

function text(value) { return String(value ?? '').trim(); }

function issueType(value, fallback = 'publication_compliance') {
  const normalized = text(value).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  return normalized || fallback;
}

function issueMessage(value) {
  if (typeof value === 'string') return text(value);
  return text(value?.message || value?.reason || value?.explanation || value?.statement || value?.coverage);
}

function issueLabel(type, fallback) { return ISSUE_LABELS[type] || fallback || type || '待处理项'; }

function normalizeIssue(value, { artifact, stage, label, index = 0, type: fallbackType } = {}) {
  const type = issueType(typeof value === 'string' ? fallbackType : value?.type, fallbackType);
  const message = issueMessage(value);
  if (!message) return null;
  return {
    id: `${stage || 'review'}-${index + 1}`,
    type,
    label: issueLabel(type, label),
    message,
    repair: text(typeof value === 'string' ? '' : value?.repair || value?.suggestion || value?.repair_suggestion),
    severity: text(typeof value === 'string' ? '' : value?.severity) || '待编辑处理',
    stage: stage || '',
    sourceArtifactId: artifact?.id ?? null,
    sourceArtifactName: artifact?.name || '',
  };
}

function addIssue(issues, value, context) {
  const issue = normalizeIssue(value, { ...context, index: issues.length });
  if (!issue) return;
  const duplicate = issues.some((item) => item.type === issue.type && item.message === issue.message);
  if (!duplicate) issues.push(issue);
}

function readJsonArtifact(artifact, readFile) {
  if (!artifact?.file_path || !fs.existsSync(artifact.file_path)) return null;
  try { return JSON.parse(readFile(artifact.file_path, 'utf8')); } catch { return null; }
}

function collectGateIssues(issues, gate, context) {
  for (const item of Array.isArray(gate?.issues) ? gate.issues : []) addIssue(issues, item, context);
}

function collectResearchIssues(issues, report, context) {
  const needsRevision = report?.status === 'needs_revision'
    || (report?.items || []).some((item) => ['omitted', 'contradicted', 'partial_core'].includes(item?.status))
    || (report?.rejected_point_leakage || []).length > 0;
  if (!needsRevision) return;
  for (const item of Array.isArray(report?.items) ? report.items : []) {
    if (!['omitted', 'contradicted', 'partial_core'].includes(item?.status)) continue;
    addIssue(issues, {
      type: 'research',
      message: `${text(item.point_id) ? `${text(item.point_id)}：` : ''}${issueMessage(item) || `状态为 ${text(item.status)}`}`,
      repair: '',
    }, context);
  }
  for (const value of [...(report?.rejected_point_leakage || []), ...(report?.repair_suggestions || [])]) {
    addIssue(issues, { type: 'research', message: value }, context);
  }
  if (!issues.some((item) => item.stage === context.stage)) addIssue(issues, { type: 'research', message: text(report?.summary) || '终稿未充分兑现已采用的研判拓展点' }, context);
}

export function buildArticleReviewIssueReport({ document = {}, artifacts = [], readFile = fs.readFileSync } = {}) {
  const issues = [];
  const sourceArtifacts = [];
  const byName = new Map(artifacts.map((artifact) => [String(artifact.name || '').toLowerCase(), artifact]));

  for (const [fileName, meta] of JSON_ARTIFACTS) {
    const artifact = byName.get(fileName.toLowerCase());
    if (!artifact) continue;
    const parsed = readJsonArtifact(artifact, readFile);
    if (!parsed) continue;
    sourceArtifacts.push({ id: artifact.id ?? null, name: artifact.name || fileName, stage: meta.stage });
    const context = { artifact, stage: meta.stage, label: meta.label, type: meta.stage === 'title' ? 'title' : meta.stage === 'research' ? 'research' : meta.stage === 'review' ? 'review' : 'publication_compliance' };
    if (meta.stage === 'title') {
      for (const value of Array.isArray(parsed.titleBlockers) ? parsed.titleBlockers : []) addIssue(issues, { type: 'title', message: value }, context);
    } else if (meta.stage === 'research') {
      collectResearchIssues(issues, parsed, context);
    } else if (meta.stage === 'publication') {
      collectGateIssues(issues, parsed.gate, context);
      for (const value of Array.isArray(parsed.scan?.titleBlockers) ? parsed.scan.titleBlockers : []) addIssue(issues, { type: 'title', message: value }, context);
    } else {
      collectGateIssues(issues, parsed, context);
    }
  }

  const reviewState = ['unverified', 'running', 'passed', 'needs_review', 'confirmed'].includes(document.review_state)
    ? document.review_state
    : document.status === 'needs_review' ? 'needs_review' : document.status === 'finalized' ? 'passed' : 'unverified';
  const needsReview = reviewState === 'needs_review';
  const manualConfirmed = reviewState === 'confirmed';
  // 问题是审核建议，不应因正文保存或重新检查中的短暂状态被清空；只有明确通过的版本隐藏旧问题。
  const visibleIssues = reviewState === 'passed' ? [] : issues;
  const groups = [...new Set(visibleIssues.map((item) => item.type))].map((type) => ({
    type,
    label: issueLabel(type),
    count: visibleIssues.filter((item) => item.type === type).length,
  }));
  return {
    documentId: document.id ?? null,
    status: document.status || 'unknown',
    reviewState,
    reviewPending: !['passed', 'confirmed'].includes(reviewState),
    manualConfirmed,
    needsReview,
    issueCount: visibleIssues.length,
    issues: visibleIssues,
    groups,
    sourceArtifacts,
  };
}

export function reviewArtifactFileNames() { return [...JSON_ARTIFACTS.keys()]; }
