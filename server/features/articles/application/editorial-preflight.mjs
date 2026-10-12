import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { candidateArticleDir } from '../../../platform/core/workspace-paths.mjs';
import { buildMaterialBrief } from '../../../shared/domain/material-brief.mjs';
import { readDiscussionResearchContext } from '../../research/index.mjs';
import { evaluateEditorialReadiness } from '../domain/editorial-readiness.mjs';
import { evaluateArticleFactEligibility } from '../domain/article-fact-eligibility.mjs';
import { readArticleSourceInput } from './article-pipeline-contract.mjs';

const PREFLIGHT_FILE = 'editorial-preflight.json';
const PREFLIGHT_EDITORIAL_FIELDS = Object.freeze([
  'writing_stance',
  'confirmed_facts',
  'research_basis',
  'author_opinions',
  'confirmed_experiences',
  'rejected_angles',
  'forbidden_claims',
  'adopted_research_points',
  'affected_group',
  'reader_consequence',
  'conflict',
  'evidence_boundary',
  'reader_action',
]);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
  return fs.statSync(filePath);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function text(value) { return String(value || '').trim(); }

function parseSnapshot(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function classificationFor(candidate) {
  return {
    content_class: candidate.content_class || 'news_event',
    status: candidate.classification_status || 'needs_review',
    confidence: candidate.classification_confidence,
    reason: candidate.classification_reason || '',
    evidence: parseSnapshot(candidate.classification_evidence_json, []),
    features: parseSnapshot(candidate.classification_features_json, {}),
  };
}

function semanticEditorialInput(editorial = {}) {
  return Object.fromEntries(PREFLIGHT_EDITORIAL_FIELDS.map((field) => [
    field,
    field === 'adopted_research_points'
      ? (Array.isArray(editorial[field]) ? editorial[field] : [])
      : text(editorial[field]),
  ]));
}

function preflightInput({ candidate, editorial, materialBrief, sourceText, sourceUrl, classification }) {
  return {
    candidate: {
      id: candidate.id,
      candidate_id: candidate.candidate_id,
      hotspot_title: candidate.hotspot_title,
      url: candidate.url,
      content_class: candidate.content_class,
      content_route: candidate.content_route,
      article_eligible: candidate.article_eligible,
      article_eligibility_reason: candidate.article_eligibility_reason,
      classification_status: candidate.classification_status,
      classification_confidence: candidate.classification_confidence,
      classification_reason: candidate.classification_reason,
      classification_evidence_json: candidate.classification_evidence_json,
      classification_features_json: candidate.classification_features_json,
      composite: Boolean(candidate.composite),
      category: candidate.category,
      angle: candidate.angle,
      thesis: candidate.thesis,
      reader_stake: candidate.reader_stake,
    },
    // material_brief / brief_status / next_action are persisted workflow state,
    // not new editorial evidence. They are written during lock and must not
    // invalidate the preflight produced by the editorial room.
    editorial: semanticEditorialInput(editorial),
    materialBrief,
    sourceUrl,
    sourceText,
    classification,
  };
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function gate(id, passed, issues = [], extra = {}) {
  return { id, passed: Boolean(passed), issues: issues.filter(Boolean), ...extra };
}

function persistArtifact(store, { batchId, candidateId, kind, name, filePath, stat }) {
  store.upsertArtifact({
    batchId,
    candidateId,
    track: 'article',
    kind,
    name,
    path: filePath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  });
}

function cachedPreflight({ store, candidate, workdir, currentFingerprint, materialBrief, readiness, routeResult }) {
  const saved = readJson(path.join(workdir, PREFLIGHT_FILE), null);
  if (!saved || saved.fingerprint !== currentFingerprint) return null;
  return {
    ...saved,
    candidate: store.getCandidate(candidate.id) || candidate,
    materialBrief,
    readiness,
    route: saved.route || routeResult,
    cached: true,
  };
}

function buildPreflightContext({
  store,
  candidate: suppliedCandidate = null,
  candidateId,
  batchId,
  workspaceRoot,
  events = null,
  researchContext = null,
} = {}) {
  const candidate = suppliedCandidate || store.getCandidate(candidateId);
  if (!candidate) throw new Error('候选不存在');
  const effectiveBatchId = batchId || candidate.batch_id;
  if (candidate.batch_id !== effectiveBatchId) throw new Error('候选不属于当前批次');
  const currentEditorial = candidate.editorial || store.getEditorial?.(candidate.id) || {};
  const effectiveEvents = events || [];
  const effectiveResearch = researchContext || readDiscussionResearchContext({
    workspaceRoot,
    batchId: effectiveBatchId,
    candidate,
    events: effectiveEvents,
  });
  const readiness = evaluateEditorialReadiness({
    candidate: { ...candidate, research_context: effectiveResearch },
    editorial: currentEditorial,
  });
  const classification = classificationFor(candidate);
  const routeSnapshot = text(candidate.content_route);
  const routeResult = (candidate.article_eligible === false
    || Number(candidate.article_eligible) === 0
    || (routeSnapshot && routeSnapshot !== 'article'))
    ? { eligible: false, reason: text(candidate.article_eligibility_reason) || '候选尚未取得文章路线资格' }
    : evaluateArticleFactEligibility({ classification });
  const materialBrief = buildMaterialBrief({
    candidate,
    editorial: currentEditorial,
    researchContext: effectiveResearch,
    events: effectiveEvents,
  });
  const source = readArticleSourceInput({ candidate, workspaceRoot, store });
  const sourceUrls = source.sourceUrls.join('\n');
  const input = preflightInput({
    candidate,
    editorial: currentEditorial,
    materialBrief,
    sourceText: source.sourceText,
    sourceUrl: sourceUrls,
    classification,
  });
  const currentFingerprint = fingerprint(input);
  const workdir = candidateArticleDir(workspaceRoot, store.getBatch(effectiveBatchId), candidate);
  return {
    store,
    candidate,
    effectiveBatchId,
    currentEditorial,
    readiness,
    classification,
    routeResult,
    materialBrief,
    source,
    sourceUrls,
    currentFingerprint,
    workdir,
  };
}

/**
 * Read a current deterministic editor-room readiness snapshot, if one exists.
 */
export function readEditorialPreflightCache(options = {}) {
  const context = buildPreflightContext(options);
  const saved = cachedPreflight(context);
  return saved ? { ...saved, source: context.source } : null;
}

/**
 * Check whether an editorial brief, source text, and candidate route are ready
 * to start production. Fact-base generation and evidence gates run in the
 * article pipeline after the editor confirms the brief.
 */
export async function runEditorialPreflight({
  store,
  candidate: suppliedCandidate = null,
  candidateId,
  batchId,
  workspaceRoot,
  events = null,
  researchContext = null,
  force = false,
} = {}) {
  const context = buildPreflightContext({
    store,
    candidate: suppliedCandidate,
    candidateId,
    batchId,
    workspaceRoot,
    events,
    researchContext,
  });
  const {
    candidate,
    effectiveBatchId,
    readiness,
    routeResult,
    materialBrief,
    source,
    sourceUrls,
    currentFingerprint,
    workdir,
  } = context;
  const saved = !force ? cachedPreflight(context) : null;
  if (saved) return saved;

  const gates = [
    gate('editorial-readiness', readiness.ready, readiness.missing, { missing: readiness.missing }),
    gate('source-cache', !source.issue, source.issue ? [source.issue] : [], { sourceUrl: sourceUrls, warnings: source.warning ? [source.warning] : [] }),
    gate('candidate-route', routeResult.eligible, routeResult.eligible ? [] : [routeResult.reason], { result: routeResult }),
  ];

  fs.mkdirSync(workdir, { recursive: true });
  const preflightPath = path.join(workdir, PREFLIGHT_FILE);
  const result = {
    ready: gates.every((item) => item.passed),
    fingerprint: currentFingerprint,
    generatedAt: new Date().toISOString(),
    gates,
    readiness,
    route: routeResult,
    materialBrief,
    factBaseDeferred: true,
    cached: false,
  };
  const preflightStat = writeJson(preflightPath, {
    ready: result.ready,
    fingerprint: result.fingerprint,
    generatedAt: result.generatedAt,
    gates: result.gates,
    readiness: result.readiness,
    route: result.route,
  });
  persistArtifact(store, { batchId: effectiveBatchId, candidateId: candidate.id, kind: '编辑室成稿预检', name: PREFLIGHT_FILE, filePath: preflightPath, stat: preflightStat });
  return { ...result, candidate: store.getCandidate(candidate.id) || candidate };
}
