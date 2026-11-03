import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';

test('外部编辑事实列表保存为文本，非法结构给出字段错误', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editorial-input-'));
  const store = new Store(path.join(root, 'test.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const batch = store.createBatch({ date: new Date().toISOString().slice(0, 10), title: '测试' });
  store.addHotspots(batch.id, 'rsshub', [{ id: 'one', title: '测试热点', url: 'https://example.com/a' }]);
  const hotspot = store.getBatch(batch.id).hotspots[0];
  store.addCandidates(batch.id, [hotspot.id]);
  const candidate = store.listCandidates(batch.id, 'article')[0];
  const saved = store.saveEditorial(candidate.id, { confirmed_facts: ['事实一', '事实二'], open_questions: ['待核实'] });
  assert.equal(saved.confirmed_facts, '事实一\n事实二');
  assert.equal(saved.open_questions, '待核实');
  assert.throws(() => store.saveEditorial(candidate.id, { confirmed_facts: [{ claim: '事实' }] }),
    { code: 'INVALID_EDITORIAL_FIELD' });
  assert.equal(store.getEditorial(candidate.id).confirmed_facts, '事实一\n事实二');
});
