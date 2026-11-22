import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFinalScore, TOPIC_SCORING_FORMULA_VERSION } from '../server/shared/domain/topic-scoring.mjs';

const scoring = {
  weights: { h: 0.5, b: 0.3, p: 0.2 },
  eventValueWeight: 0.25,
  researchValueWeight: 0.1,
  domesticWeight: 0.1,
};

test('v4 shared formula includes A, T, J, DOM, M, and competition penalty', () => {
  const result = computeFinalScore({ H: 80, B: 60, P: 80, T: 80, J: 20, S: 2, D: 3, chinaRelevance: 6 }, scoring);
  assert.equal(TOPIC_SCORING_FORMULA_VERSION, 'v4');
  assert.equal(result.A, 74);
  assert.equal(result.DOM, 50);
  assert.equal(result.C, 5);
  assert.equal(result.M, 50);
  assert.equal(result.materialFitSource, 'neutral_unclassified');
  assert.equal(result.F, 55);
  assert.deepEqual(
    { A: result.weights.article, T: result.weights.eventValue, J: result.weights.researchValue, DOM: result.weights.domestic, M: result.weights.material },
    { A: 0.5, T: 0.2, J: 0.1, DOM: 0.1, M: 0.1 },
  );
});

test('missing DOM redistributes its share across A, T, J, and M', () => {
  const result = computeFinalScore({ H: 80, B: 60, P: 80, T: 80, J: 20, S: 0, D: 0 }, scoring);
  assert.equal(result.DOM, null);
  assert.equal(result.weights.domestic, 0);
  assert.equal(Number((result.weights.article + result.weights.eventValue + result.weights.researchValue + result.weights.material).toFixed(8)), 1);
  assert.equal(result.F, 66.7);
});

test('missing T yields no final score even when other components exist', () => {
  const result = computeFinalScore({ H: 80, B: 60, P: 80, T: null, J: 20, chinaRelevance: 6 }, scoring);
  assert.equal(result.F, null);
});

test('configured score warnings are returned once', () => {
  const warning = '账号评分配置尚未升级到 v4';
  const result = computeFinalScore({ H: 60, B: 60, P: 60, T: 60, J: 60 }, {
    eventValueWeight: 0.5, researchValueWeight: 0.5, domesticWeight: 0.25, scoringWarnings: [warning],
  });
  assert.equal(result.weightWarnings.filter((item) => item === warning).length, 1);
});
