import fs from 'node:fs';
import path from 'node:path';
import { computeFinalScore, TOPIC_SCORING_FORMULA_VERSION } from '../../server/shared/domain/topic-scoring.mjs';

const batchDirectory = process.argv[2];
if (!batchDirectory) {
  console.error('Usage: node scripts/quality/backtest-topic-scoring.mjs <batch-workdir> [output.json]');
  process.exit(2);
}
const sourcesDirectory = path.join(path.resolve(batchDirectory), 'sources');
const replayPath = path.join(sourcesDirectory, 'topic-scoring-candidates.json');
const preselectionPath = path.join(sourcesDirectory, 'preselection-ranking.json');
if (!fs.existsSync(replayPath)) throw new Error('Missing replay input: ' + replayPath);
const replay = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
if (!Array.isArray(replay.items)) throw new Error('topic-scoring-candidates.json must contain items[]');
const preselection = fs.existsSync(preselectionPath)
  ? JSON.parse(fs.readFileSync(preselectionPath, 'utf8'))
  : null;
const scoring = replay.scoring || {};
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function scoreLegacyV2(inputs, configured = {}) {
  const configuredWeights = configured.weights || {};
  const eventValueWeight = Number(configured.eventValueWeight ?? 0.25);
  const researchValueWeight = Number(configured.researchValueWeight ?? 0.20);
  const articleWeight = clamp(1 - eventValueWeight - researchValueWeight, 0, 1);
  const weights = { h: Number(configuredWeights.h ?? 0.6), b: Number(configuredWeights.b ?? 0.25), p: Number(configuredWeights.p ?? 0.15) };
  const H = clamp(inputs.H, 0, 100);
  const B = clamp(inputs.B, 0, 100);
  const P = clamp(inputs.P, 0, 100);
  const T = inputs.T == null || !Number.isFinite(Number(inputs.T)) ? null : clamp(inputs.T, 0, 100);
  const J = clamp(inputs.J, 0, 100);
  const C = clamp(clamp(inputs.S, 0, 15) + clamp(inputs.D, 0, 20), 0, 35);
  const A = clamp(H * weights.h + B * weights.b + P * weights.p, 0, 100);
  const F = T == null ? null : clamp(A * articleWeight + T * eventValueWeight + J * researchValueWeight - C, 0, 100);
  return { A: Number(A.toFixed(1)), F: F == null ? null : Number(F.toFixed(1)), C: Number(C.toFixed(1)) };
}

const items = replay.items.map((item) => {
  const inputs = item.inputs || {};
  const v4 = computeFinalScore({ ...inputs, materialStrategy: item.materialStrategy,
    materialFit: item.materialFit }, scoring);
  const v2Inputs = item.legacyInputs || inputs;
  return {
    candidateId: String(item.candidateId || ''),
    title: String(item.title || ''),
    category: String(item.category || ''),
    poolRole: String(item.poolRole || ''),
    v2: scoreLegacyV2(v2Inputs, replay.legacyScoring),
    v4: { A: v4.A, DOM: v4.DOM, strategy: v4.materialStrategy, M: v4.M,
      materialFitSource: v4.materialFitSource, reason: String(item.materialFitReason || ''), F: v4.F },
    savedHistoricalScore: item.output || null,
    usesLegacyComponentSnapshot: Boolean(item.legacyInputs),
  };
});
const rank = (key) => new Map(items.filter((item) => item[key].F != null)
  .sort((a, b) => b[key].F - a[key].F || a.candidateId.localeCompare(b.candidateId))
  .map((item, index) => [item.candidateId, index + 1]));
const v2Ranks = rank('v2');
const v4Ranks = rank('v4');
for (const item of items) {
  item.v2.rank = v2Ranks.get(item.candidateId) ?? null;
  item.v4.rank = v4Ranks.get(item.candidateId) ?? null;
  item.rankChange = item.v2.rank == null || item.v4.rank == null ? null : item.v2.rank - item.v4.rank;
}
const ranked = Array.isArray(preselection?.items) ? preselection.items : [];
const report = {
  schemaVersion: 1,
  formulaVersion: TOPIC_SCORING_FORMULA_VERSION,
  historicalFormulaVersion: replay.formulaVersion || 'unknown',
  comparisonBasis: 'Recalculates all replay rows with the active v4 formula. Old replay rows without materialStrategy/materialFit use unclassified neutral M=50; this does not edit the archived batch or reconstruct editorial choices.',
  preselection: preselection ? {
    rankedEventCount: ranked.length,
    selectedEventCount: ranked.filter((item) => item.poolRole && item.poolRole !== '未入选').length,
    unavailableGates: ['hasResearchBasis', 'brainstorm', 'candidate score inputs are not reconstructed by this artifact'],
  } : { available: false },
  sampleSize: items.length,
  items,
};
const output = JSON.stringify(report, null, 2) + '\n';
if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), output, 'utf8');
process.stdout.write(output);
