import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { INITIAL_COLLECTION_SOURCES, seedInitialCollectionSources } from '../server/features/collection/application/initial-source-seed.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-initial-sources-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return store;
}

test('新工作区一次性写入生产参考采集源且默认暂停', (t) => {
  const store = fixture(t);
  const first = seedInitialCollectionSources(store);
  assert.deepEqual(first, { seeded: true, count: INITIAL_COLLECTION_SOURCES.length });
  const sources = store.listCollectionSources();
  assert.equal(sources.length, INITIAL_COLLECTION_SOURCES.length);
  assert.equal(sources.every((item) => item.enabled === false), true);
  assert.equal(sources.every((item) => item.origin === 'initial-sample' && item.managed === false), true);
  assert.ok(sources.some((item) => item.source_key === 'reddit:r/programming'));
  assert.ok(sources.some((item) => item.source_key === 'github:search'));
});

test('参考采集源初始化幂等，已有来源不会被覆盖', (t) => {
  const store = fixture(t);
  store.repositories.collectionSources.upsert({ pluginId: 'demo', sourceType: 'demo', sourceKey: 'demo:existing', label: '已有来源', config: {}, enabled: true });
  const result = seedInitialCollectionSources(store);
  assert.deepEqual(result, { seeded: false, reason: 'existing-sources', count: 1 });
  assert.deepEqual(store.listCollectionSources().map((item) => item.source_key), ['demo:existing']);
  assert.deepEqual(seedInitialCollectionSources(store), { seeded: false, reason: 'already-initialized', count: 1 });
});
