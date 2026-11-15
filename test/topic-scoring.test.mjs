import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFinalScore, resolveTopicScoreWeights, TOPIC_SCORING_FORMULA_VERSION } from '../server/shared/domain/topic-scoring.mjs';

const scoring = {
  weights: { h: 0.5, b: 0.3, p: 0.2 },
  eventValueWeight: 0.25,
  researchValueWeight: 0.1,
  domesticWeight: 0.1,
};

test('v3 shared formula includes A, T, J, DOM, and competition penalty', () => {
  const result = computeFinalScore({ H: 80, B: 60, P: 80, T: 80, J: 20, S: 2, D: 3, chinaRelevance: 6 }, scoring);
  assert.equal(TOPIC_SCORING_FORMULA_VERSION, 'v3');
  assert.equal(result.A, 74);
  assert.equal(result.DOM, 50);
  assert.equal(result.C, 5);
  assert.equal(result.F, 62.7);
  assert.deepEqual(
    { A: result.weights.article, T: result.weights.eventValue, J: result.weights.researchValue, DOM: result.weights.domestic },
    { A: 0.55, T: 0.25, J: 0.1, DOM: 0.1 },
  );
});

test('missing DOM redistributes its share across A, T, and J', () => {
  const result = computeFinalScore({ H: 80, B: 60, P: 80, T: 80, J: 20, S: 0, D: 0 }, scoring);
  assert.equal(result.DOM, null);
  assert.equal(result.weights.domestic, 0);
  assert.equal(Number((result.weights.article + result.weights.eventValue + result.weights.researchValue).toFixed(8)), 1);
  assert.equal(result.F, 69.7);
});

test('missing T yields no final score even when other components exist', () => {
  const result = computeFinalScore({ H: 80, B: 60, P: 80, T: null, J: 20, chinaRelevance: 6 }, scoring);
  assert.equal(result.F, null);
});

test('non-article weights are capped at 0.85 with an auditable warning', () => {
  const weights = resolveTopicScoreWeights({ eventValueWeight: 0.4, researchValueWeight: 0.3, domesticWeight: 0.25 });
  assert.equal(Number((weights.article + weights.eventValue + weights.researchValue + weights.domestic).toFixed(8)), 1);
  assert.ok(weights.article >= 0.149999 && weights.article <= 0.150001);
  assert.equal(weights.warnings.length, 1);
});