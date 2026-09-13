import assert from 'node:assert/strict';
import test from 'node:test';
import { startFakeModel, startFakeRssHub } from './support/fake-upstreams.mjs';
import { waitForJob } from './support/workbench-process.mjs';

test('异常矩阵：任务完成、失败和超时都能被明确识别', async () => {
  const completedStatuses = [];
  let polls = 0;
  await waitForJob(async () => ({ status: ['queued', 'running', 'completed'][Math.min(polls++, 2)] }), 'job-complete', {
    intervalMs: 1,
    observedStatuses: completedStatuses,
  });
  assert.deepEqual(completedStatuses, ['queued', 'running', 'completed']);

  const failedStatuses = [];
  await assert.rejects(
    waitForJob(async () => ({ status: 'failed', error: '模型格式错误' }), 'job-failed', { intervalMs: 1, observedStatuses: failedStatuses }),
    /模型格式错误/,
  );
  assert.deepEqual(failedStatuses, ['failed']);

  await assert.rejects(
    waitForJob(async () => ({ status: 'running', progress: '处理中' }), 'job-timeout', { timeoutMs: 5, intervalMs: 1 }),
    /超时/,
  );
});

test('异常矩阵：RSS 失败和模型 HTTP/格式错误保持可复现', async () => {
  const rsshub = await startFakeRssHub({ status: 503 });
  const modelHttpError = await startFakeModel({ mode: 'http-error' });
  const modelInvalidJson = await startFakeModel({ mode: 'invalid-json' });
  try {
    const rssResponse = await fetch(`${rsshub.baseUrl}/e2e/news?limit=30`);
    assert.equal(rssResponse.status, 503);
    assert.equal(await rssResponse.text(), 'fixture rss failure');

    const request = { messages: [{ role: 'user', content: '返回 JSON' }], response_format: { type: 'json_object' } };
    const httpResponse = await fetch(`${modelHttpError.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    });
    assert.equal(httpResponse.status, 502);
    assert.match(await httpResponse.text(), /fixture model failure/);

    const invalidResponse = await fetch(`${modelInvalidJson.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    });
    assert.equal(invalidResponse.status, 200);
    const invalidPayload = await invalidResponse.json();
    assert.equal(invalidPayload.choices[0].message.content, '{invalid fixture json');
  } finally {
    await modelInvalidJson.close();
    await modelHttpError.close();
    await rsshub.close();
  }
});
