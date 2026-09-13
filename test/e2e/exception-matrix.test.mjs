import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AiJobManager } from '../../server/platform/jobs/ai-job-manager.mjs';
import { Store } from '../../server/platform/core/store.mjs';
import { closeHarness, createHttpRouteHarness, listenHarness, requestJson } from './support/http-route-harness.mjs';

function modelsThatFail(error) {
  return {
    config: { defaultProvider: 'fake', providers: { fake: { model: 'phase0-fake', maxOutputTokens: 4000 } } },
    resolveForInput: () => ({ provider: 'fake' }),
    complete: async () => { throw new Error(error); },
  };
}

async function withWorkspace(run, { models = null, aiJobsFactory = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-boundary-exception-'));
  const store = new Store(path.join(root, 'workbench.db'));
  const aiJobs = aiJobsFactory ? aiJobsFactory(store) : {};
  const server = createHttpRouteHarness({ root, store, models, aiJobs });
  const baseUrl = await listenHarness(server);
  try {
    return await run({ root, store, server, baseUrl });
  } finally {
    await closeHarness(server);
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function createBrief(baseUrl) {
  const material = await requestJson(baseUrl, '/api/writing-materials', {
    method: 'POST',
    body: { sourceType: 'conversation', title: '异常矩阵素材', rawText: '用于验证模型异常边界。' },
  });
  assert.equal(material.response.status, 201);
  const brief = await requestJson(baseUrl, '/api/writing-material-briefs', {
    method: 'POST',
    body: { materialIds: [material.data.id] },
  });
  assert.equal(brief.response.status, 201);
  return brief.data.id;
}

test('阶段 0 异常矩阵：模型失败、非法 JSON、超时、采集失败和任务取消可被观察', async (t) => {
  await t.test('模型服务失败返回结构化 HTTP 错误', async () => {
    await withWorkspace(async ({ baseUrl }) => {
      const briefId = await createBrief(baseUrl);
      const result = await requestJson(baseUrl, `/api/writing-material-briefs/${briefId}/generate`, { method: 'POST', body: {} });
      assert.equal(result.response.status, 400);
      assert.match(result.data.error, /提炼主线失败/);
    }, { models: modelsThatFail('模型服务不可用') });
  });

  await t.test('非法 JSON 不会被当作成功结果', async () => {
    await withWorkspace(async ({ baseUrl }) => {
      const briefId = await createBrief(baseUrl);
      const result = await requestJson(baseUrl, `/api/writing-material-briefs/${briefId}/generate`, { method: 'POST', body: {} });
      assert.equal(result.response.status, 400);
      assert.match(result.data.error, /提炼主线失败/);
    }, {
      models: {
        ...modelsThatFail('unused'),
        complete: async () => ({ provider: 'fake', model: 'phase0-fake', content: '这不是 JSON' }),
      },
    });
  });

  await t.test('超时异常不产生成功简报', async () => {
    await withWorkspace(async ({ baseUrl }) => {
      const briefId = await createBrief(baseUrl);
      const result = await requestJson(baseUrl, `/api/writing-material-briefs/${briefId}/generate`, { method: 'POST', body: {} });
      assert.equal(result.response.status, 400);
      assert.match(result.data.error, /请求超时/);
    }, { models: modelsThatFail('请求超时') });
  });

  await t.test('采集失败进入可查询的任务状态', async () => {
    await withWorkspace(async ({ baseUrl, store }) => {
      const batch = store.createBatch({ date: '2026-09-13', title: '异常矩阵采集批次' });
      const sourceRunId = store.startSourceRun(batch.id, 'phase0-source');
      store.finishSourceRun(sourceRunId, 'failed', 0, 'fixture source failed');
      const jobs = await requestJson(baseUrl, '/api/jobs');
      assert.equal(jobs.response.status, 200);
      const source = jobs.data.find((item) => item.id === `source:${sourceRunId}`);
      assert.equal(source.status, 'failed');
    });
  });

  await t.test('排队任务可通过 HTTP 取消并持久化状态', async () => {
    let releaseBlocker;
    let manager;
    const blocker = new Promise((resolve) => { releaseBlocker = resolve; });
    const gateway = {
      config: { defaultProvider: 'fake', providers: { fake: { model: 'phase0-fake' } } },
      resolve: () => ({ provider: 'fake' }),
    };
    const handlers = new Map([
      ['phase0-blocker', async () => blocker],
      ['phase0-queued', async () => ({ ok: true })],
    ]);
    const managerConfig = { aiJobs: { maxConcurrent: 1 }, rsshub: { maxAgeHours: 72 } };
    await withWorkspace(async ({ baseUrl, store }) => {
      const batch = store.createBatch({ date: '2026-09-13', title: '异常矩阵取消批次' });
      const running = manager.start({ batchId: batch.id, type: 'phase0-blocker', provider: 'fake' });
      const queued = manager.start({ batchId: batch.id, type: 'phase0-queued', provider: 'fake' });
      assert.equal(running.status, 'running');
      assert.equal(queued.status, 'queued');
      const cancelled = await requestJson(baseUrl, `/api/jobs/${queued.id}/cancel`, { method: 'POST', body: {} });
      assert.equal(cancelled.response.status, 200);
      assert.equal(cancelled.data.cancelled, true);
      assert.equal(store.getAiRun(queued.id).status, 'cancelled');
      releaseBlocker();
      await new Promise((resolve) => setImmediate(resolve));
    }, { aiJobsFactory: (store) => {
      manager = new AiJobManager(store, gateway, managerConfig, { handlers, batchLevelTypes: new Set(handlers.keys()) });
      return manager;
    } });
  });
});
