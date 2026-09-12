import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { candidateArticleDir } from '../../../platform/core/workspace-paths.mjs';
import { buildMaterialBrief } from '../../../shared/domain/material-brief.mjs';
import { readDiscussionResearchContext } from '../../research/index.mjs';
import { evaluateEditorialReadiness } from '../domain/editorial-readiness.mjs';
import { evaluateArticleFactEligibility } from '../domain/article-fact-eligibility.mjs';
import {
  buildPublicationClaimRegister,
  publicationFactBaseIssues,
} from '../domain/publication-compliance.mjs';
import { buildArticleStageSystem } from './article-pipeline.mjs';
import {
  readArticleSourceInput,
  unverifiedFactBaseIssue,
} from './article-pipeline-contract.mjs';

const PREFLIGHT_FILE = 'editorial-preflight.json';
const FACT_BASE_FILE = '02-fact-base.json';
const CLAIM_REGISTER_FILE = '02-publication-claim-register.json';
const FACT_GATE_FILE = '02-fact-gate.json';

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
    },
    editorial,
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

function cachedPreflight({ store, candidate, workdir, currentFingerprint }) {
  const saved = readJson(path.join(workdir, PREFLIGHT_FILE), null);
  const factBase = readJson(path.join(workdir, FACT_BASE_FILE), null);
  if (!saved || saved.fingerprint !== currentFingerprint || !factBase) return null;
  return {
    ...saved,
    candidate: store.getCandidate(candidate.id) || candidate,
    factBase,
    publicationClaimRegister: readJson(path.join(workdir, CLAIM_REGISTER_FILE), { claims: [] })?.claims || [],
    factGate: readJson(path.join(workdir, FACT_GATE_FILE), null),
    cached: true,
  };
}

/**
 * The one authoritative pre-lock check for article candidates.
 * It is intentionally callable from both the editorial agent and the lock route.
 */
export async function runEditorialPreflight({
  gateway,
  store,
  candidate: suppliedCandidate = null,
  candidateId,
  batchId,
  provider,
  workspaceRoot,
  events = null,
  researchContext = null,
  force = false,
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
  const input = preflightInput({ candidate, editorial: currentEditorial, materialBrief, sourceText: source.sourceText, sourceUrl: sourceUrls, classification });
  const currentFingerprint = fingerprint(input);
  const workdir = candidateArticleDir(workspaceRoot, store.getBatch(effectiveBatchId), candidate);
  const saved = !force ? cachedPreflight({ store, candidate, workdir, currentFingerprint }) : null;
  if (saved) return saved;

  const gates = [
    gate('editorial-readiness', readiness.ready, readiness.missing, { missing: readiness.missing }),
    gate('source-cache', !source.issue, source.issue ? [source.issue] : [], { sourceUrl: sourceUrls, warnings: source.warning ? [source.warning] : [] }),
  ];
  const preconditionIssues = gates.flatMap((item) => item.issues);
  let factBase = null;
  let publicationClaimRegister = [];
  let factGate = null;

  if (!preconditionIssues.length) {
    try {
      const orchestratorSkill = loadSkillBundle({ workspaceRoot, skillName: 'wechat-mp-topic-to-article' });
      const factBaseResult = await gateway.complete({
        provider,
        purpose: 'article-fact-base',
        batchId: effectiveBatchId,
        candidateId: candidate.id,
        jsonMode: true,
        messages: [
          { role: 'system', protected: true, content: buildArticleStageSystem(orchestratorSkill, 'fact-base') },
          { role: 'user', protected: true, content: JSON.stringify({
            topic: candidate.hotspot_title,
            researchBasis: currentEditorial.research_basis,
            adoptedResearchPoints: currentEditorial.adopted_research_points || [],
            rejectedAngles: currentEditorial.rejected_angles || '',
            confirmedFacts: currentEditorial.confirmed_facts || '',
            authorOpinions: currentEditorial.author_opinions || '',
            forbiddenClaims: currentEditorial.forbidden_claims || '',
            materialBrief,
            sourceUrl: sourceUrls,
            sourceText: source.sourceText,
          }) },
        ],
      });
      factBase = parseModelJson(factBaseResult, { store, label: '编辑室事实预检' });
      publicationClaimRegister = buildPublicationClaimRegister(factBase);
      factGate = evaluateArticleFactEligibility({ classification, factBase });
      const publicationIssues = publicationFactBaseIssues(factBase);
      const unverifiedIssue = unverifiedFactBaseIssue(factBase);
      gates.push(gate('fact-base', Boolean(factBase && typeof factBase === 'object'), factBase ? [] : ['事实基座未生成']));
      gates.push(gate('unverified-fact-base', !unverifiedIssue, unverifiedIssue ? [unverifiedIssue] : []));
      gates.push(gate('publication-evidence', publicationIssues.length === 0, publicationIssues));
      gates.push(gate('fact-eligibility', factGate.eligible, factGate.eligible ? [] : [factGate.reason], { result: factGate }));
    } catch (error) {
      gates.push(gate('fact-base', false, [`事实基座生成失败：${error.message}`]));
      gates.push(gate('unverified-fact-base', false, ['事实基座未生成']));
      gates.push(gate('publication-evidence', false, ['事实基座未生成']));
      gates.push(gate('fact-eligibility', false, ['事实基座未生成']));
    }
  } else {
    gates.push(gate('fact-base', false, ['前置门禁未通过，未生成事实基座']));
    gates.push(gate('unverified-fact-base', false, ['前置门禁未通过，未检查']));
    gates.push(gate('publication-evidence', false, ['前置门禁未通过，未检查']));
    gates.push(gate('fact-eligibility', false, ['前置门禁未通过，未检查']));
  }

  fs.mkdirSync(workdir, { recursive: true });
  const factBasePath = path.join(workdir, FACT_BASE_FILE);
  const claimRegisterPath = path.join(workdir, CLAIM_REGISTER_FILE);
  const factGatePath = path.join(workdir, FACT_GATE_FILE);
  const preflightPath = path.join(workdir, PREFLIGHT_FILE);
  if (factBase) {
    persistArtifact(store, { batchId: effectiveBatchId, candidateId: candidate.id, kind: '事实基座', name: FACT_BASE_FILE, filePath: factBasePath, stat: writeJson(factBasePath, factBase) });
    persistArtifact(store, { batchId: effectiveBatchId, candidateId: candidate.id, kind: '发布主张登记', name: CLAIM_REGISTER_FILE, filePath: claimRegisterPath, stat: writeJson(claimRegisterPath, { generatedAt: new Date().toISOString(), claims: publicationClaimRegister }) });
    persistArtifact(store, { batchId: effectiveBatchId, candidateId: candidate.id, kind: '事实门禁', name: FACT_GATE_FILE, filePath: factGatePath, stat: writeJson(factGatePath, factGate) });
  }
  const result = {
    ready: gates.every((item) => item.passed),
    fingerprint: currentFingerprint,
    generatedAt: new Date().toISOString(),
    gates,
    readiness,
    route: routeResult,
    materialBrief,
    factBase,
    publicationClaimRegister,
    factGate,
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
