import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';

test('missing domesticSubject stays unmarked instead of becoming the explicit 无 tag', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hotspot-domestic-subject-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const batch = store.createBatch({ date: new Date().toISOString().slice(0, 10), title: 'subject' });
  store.addHotspots(batch.id, 'rsshub', [{ id: 'one', title: 'event', url: 'https://example.com' }]);
  const hotspot = store.getBatch(batch.id).hotspots[0];
  const updated = store.updateHotspotTags(hotspot.id, { chinaRelevance: 4, category: '产品与技术动态' });
  assert.equal(JSON.parse(updated.raw_json).aiTags.domesticSubject, '');
});
