import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRunInput, readRunInputDownload } from '../server/platform/agent/run-input.mjs';

test('Run Trace 输入读取现有研判文件并按阶段生成预览', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-input-'));
  const sources = path.join(root, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  fs.writeFileSync(path.join(sources, 'discussion-research-input.json'), JSON.stringify({ phases: [
    { phase: 'internal', attempt: 1, input: { event: '事件内假设', detail: 'x'.repeat(1800) } },
    { phase: 'topic_generation', attempt: 1, input: { digest: '选题生成输入', api_key: ['s', 'k'].join('') + '-test-secret-value-1234567890' } },
  ] }), 'utf8');
  const trace = { rootRunId: 'job:1', runs: [{ id: 'job:1', entry_point: 'batch-job:research', batch_id: 'batch-1' }], modelCalls: [{ id: 42, provider: 'deepseek', model: 'deepseek-v4', purpose: 'discussion-research', status: 'completed', prompt_tokens: 120, completion_tokens: 80 }] };
  const inputFile = JSON.parse(fs.readFileSync(path.join(sources, 'discussion-research-input.json'), 'utf8'));
  inputFile.phases[1].response = { call_id: 42 };
  fs.writeFileSync(path.join(sources, 'discussion-research-input.json'), JSON.stringify(inputFile), 'utf8');
  const store = { getBatch: () => ({ id: 'batch-1', batch_date: '2026-09-06' }) };
  const input = buildRunInput({ root: root, store, trace, batchWorkdir: () => root, previewLimit: 500 });
  assert.equal(input.available, true);
  assert.equal(input.stages.length, 2);
  assert.equal(input.stages[0].stageId, 'internal');
  assert.equal(input.stages[0].truncated, true);
  assert.match(input.records[0].preview, /已截断/);
  assert.doesNotMatch(input.stages[1].preview, /sk-test-secret-value/);
  assert.equal(input.stages[1].modelCallId, 42);
  assert.equal(input.stages[1].modelCall.model, 'deepseek-v4');
  assert.equal(input.index.source, 'existing-task-files');
  assert.equal(input.index.stages[1].stageId, 'topic_generation');
  assert.equal(input.index.files.every((item) => !('filePath' in item)), true);
  const download = readRunInputDownload({ root, store, trace, batchWorkdir: () => root, stageId: 'topic_generation', attempt: 1 });
  assert.equal(download.stageId, 'topic_generation');
  assert.equal(download.input.length, 1);
  assert.equal(download.input[0].phase, 'topic_generation');
  assert.doesNotMatch(JSON.stringify(download), /sk-test-secret-value/);
  assert.equal(download.input[0].response.call_id, 42);
});
