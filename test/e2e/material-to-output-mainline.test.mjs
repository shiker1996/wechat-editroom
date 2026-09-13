import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../../server/platform/core/store.mjs';
import { candidateSocialCardDir } from '../../server/platform/core/workspace-paths.mjs';
import { createHttpRouteHarness, closeHarness, listenHarness, requestJson } from './support/http-route-harness.mjs';

function fakeModels() {
  return {
    config: { defaultProvider: 'fake', providers: { fake: { model: 'phase0-fake', maxOutputTokens: 4000 } } },
    resolveForInput: () => ({ provider: 'fake' }),
    complete: async () => ({
      provider: 'fake',
      model: 'phase0-fake',
      content: JSON.stringify({
        fact_summary: [{ id: 'material-fact-1', text: '团队将一次失败复盘记录成可复用的工作流边界。', source: 'material', confidence: 'confirmed' }],
        context: '素材来自一次真实工作流复盘。',
        tension: '流程看起来自动化，但边界条件仍需要人工确认。',
        why_it_matters: '读者可以据此判断何时应该保留人工门禁。',
        mainline_candidates: [{
          id: 'mainline-1',
          title: '自动化流程的人工边界',
          question: '自动化到什么程度仍需要人工确认？',
          thesis: '稳定的自动化应该把人工确认放在高风险边界，而不是完全移除人工。',
          argument: ['用失败复盘说明边界条件。'],
          counter_argument: '低风险、可回滚的操作可以完全自动化。',
          evidence_refs: ['material-fact-1'],
        }],
        discussion_question: '哪些步骤值得保留人工确认？',
        missing_evidence: [],
        recommended_formats: ['article-experience'],
      }),
    }),
  };
}

test('阶段 0 主链路：素材入箱到规划、候选、文稿、产物和任务状态保持可追踪', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-boundary-e2e-'));
  const store = new Store(path.join(root, 'workbench.db'));
  const server = createHttpRouteHarness({ root, store, models: fakeModels() });
  t.after(async () => {
    await closeHarness(server);
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const baseUrl = await listenHarness(server);

  const materialResult = await requestJson(baseUrl, '/api/writing-materials', {
    method: 'POST',
    body: { sourceType: 'conversation', title: '自动化流程复盘', rawText: '记录一次失败复盘，以及人工确认边界。' },
  });
  assert.equal(materialResult.response.status, 201);
  const material = materialResult.data;
  assert.equal(material.source_type, 'conversation');
  assert.ok(['low', 'medium', 'high'].includes(material.assessment.topic_potential.level));

  const listedMaterials = await requestJson(baseUrl, '/api/writing-materials');
  assert.equal(listedMaterials.response.status, 200);
  assert.equal(listedMaterials.data.find((item) => item.id === material.id).mainline_status, '未提炼');

  const briefResult = await requestJson(baseUrl, '/api/writing-material-briefs', {
    method: 'POST',
    body: { materialIds: [material.id] },
  });
  assert.equal(briefResult.response.status, 201);
  const briefId = briefResult.data.id;

  const generated = await requestJson(baseUrl, `/api/writing-material-briefs/${briefId}/generate`, { method: 'POST', body: {} });
  assert.equal(generated.response.status, 200);
  assert.equal(generated.data.mainlineCandidates[0].id, 'mainline-1');
  assert.equal(generated.data.readiness.ready, false);

  const confirmed = await requestJson(baseUrl, `/api/writing-material-briefs/${briefId}/confirm`, {
    method: 'POST',
    body: {
      confirmedBy: 'phase0-e2e',
      draft: {
        selectedMainlineId: 'mainline-1',
        confirmedTopic: '自动化流程的人工边界',
        confirmedThesis: '稳定的自动化应该把人工确认放在高风险边界。',
        missingEvidence: [],
      },
    },
  });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.data.status, 'confirmed');
  assert.equal(confirmed.data.readiness.ready, true);

  const afterBrief = await requestJson(baseUrl, '/api/writing-materials');
  assert.equal(afterBrief.data.find((item) => item.id === material.id).mainline_status, '已锁定');

  const planResult = await requestJson(baseUrl, '/api/writing-material-plans', {
    method: 'POST',
    body: { materialId: material.id, titleDirection: '自动化流程的人工边界', plannedDate: '2026-09-13', status: 'planned' },
  });
  assert.equal(planResult.response.status, 201);
  const calendar = await requestJson(baseUrl, '/api/calendar?month=2026-09');
  assert.equal(calendar.response.status, 200);
  assert.ok(calendar.data.some((item) => item.id === planResult.data.id));

  const batch = store.createBatch({ date: '2026-09-13', title: '阶段 0 主链路批次' });
  const hotspot = store.addManualHotspot(batch.id, { title: '自动化流程的人工边界', url: 'https://example.com/material', notes: 'E2E fixture' });
  const candidates = await requestJson(baseUrl, `/api/batches/${encodeURIComponent(batch.id)}/candidates`, {
    method: 'POST',
    body: { hotspotIds: [hotspot.id], tracks: ['article'] },
  });
  assert.equal(candidates.response.status, 201);
  const candidate = candidates.data[0];
  assert.ok(candidate.id);

  const socialHotspot = store.addManualHotspot(batch.id, { title: '自动化流程图文表达', url: 'https://example.com/social-material', notes: 'Social E2E fixture' });
  const socialCandidates = await requestJson(baseUrl, `/api/batches/${encodeURIComponent(batch.id)}/candidates`, {
    method: 'POST',
    body: { hotspotIds: [socialHotspot.id], tracks: ['social_cards'], socialContentClass: 'news_event' },
  });
  assert.equal(socialCandidates.response.status, 201);
  const socialCandidate = socialCandidates.data[0];
  assert.ok(socialCandidate.id);
  const socialDir = candidateSocialCardDir(root, store.getBatch(batch.id), store.getCandidate(socialCandidate.id));
  fs.mkdirSync(path.join(socialDir, 'output'), { recursive: true });
  fs.writeFileSync(path.join(socialDir, 'copy.txt'), '图文发布文案：自动化也需要人工边界。', 'utf8');
  fs.writeFileSync(path.join(socialDir, 'card-plan.json'), JSON.stringify([{ page: 1, title: '自动化边界' }]));
  fs.writeFileSync(path.join(socialDir, 'delivery-report.json'), JSON.stringify({ valid: true, pages: 1 }));
  fs.writeFileSync(path.join(socialDir, 'output', 'page-01.png'), 'phase0-social-card-fixture', 'utf8');
  store.upsertArtifact({ batchId: batch.id, candidateId: socialCandidate.id, track: 'social_cards', kind: 'social-card-copy', name: 'copy.txt', path: path.join(socialDir, 'copy.txt'), size: fs.statSync(path.join(socialDir, 'copy.txt')).size, modifiedAt: new Date().toISOString(), status: 'ready' });
  const socialOutput = await requestJson(baseUrl, `/api/candidates/${socialCandidate.id}/social-cards`);
  assert.equal(socialOutput.response.status, 200, JSON.stringify(socialOutput.data));
  assert.equal(socialOutput.data.ready, true);
  assert.equal(socialOutput.data.images.length, 1);
  assert.match(socialOutput.data.copy, /人工边界/);

  const articlePath = path.join(root, 'articles', batch.id, 'final.md');
  fs.mkdirSync(path.dirname(articlePath), { recursive: true });
  fs.writeFileSync(articlePath, '# 自动化流程的人工边界\n\n正文。', 'utf8');
  const document = store.saveDocument({ batchId: batch.id, candidateId: candidate.id, kind: 'final', title: '自动化流程的人工边界', content: '# 自动化流程的人工边界\n\n正文。', filePath: articlePath, status: 'finalized' });
  const articles = await requestJson(baseUrl, '/api/articles?month=2026-09');
  assert.equal(articles.response.status, 200);
  assert.ok(articles.data.some((item) => item.id === document.id));

  store.upsertArtifact({ batchId: batch.id, candidateId: candidate.id, track: 'article', kind: 'article-final', name: 'final.md', path: articlePath, size: fs.statSync(articlePath).size, modifiedAt: new Date().toISOString(), status: 'ready' });
  const artifacts = await requestJson(baseUrl, `/api/artifacts?batch_id=${encodeURIComponent(batch.id)}`);
  assert.equal(artifacts.response.status, 200);
  assert.equal(artifacts.data.filter((item) => item.batch_id === batch.id).length, 2);
  assert.ok(artifacts.data.some((item) => item.track === 'social_cards' && Number(item.candidate_row_id) === Number(socialCandidate.id)), JSON.stringify(artifacts.data));

  const runId = crypto.randomUUID();
  store.createAiRun({ id: runId, batchId: batch.id, type: 'phase0-smoke', provider: 'fake' });
  store.updateAiRun(runId, { status: 'completed', progress: '阶段 0 Smoke 完成' });
  const jobs = await requestJson(baseUrl, '/api/jobs');
  assert.equal(jobs.response.status, 200);
  assert.equal(jobs.data.find((item) => item.id === runId).status, 'completed');

  const feedback = await requestJson(baseUrl, '/api/wechat/feedback');
  assert.equal(feedback.response.status, 200);
});
