import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';

test('未填写批次名称时由服务端生成当天时间和不可复用序号', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-naming-'));
  let store;
  try {
    store = new Store(path.join(root, 'workbench.db'));
    const first = store.createBatch({ date: '2026-09-11' });
    const second = store.createBatch({ date: '2026-09-11', title: '   ' });
    const manual = store.createBatch({ date: '2026-09-11', title: '手动批次' });
    const third = store.createBatch({ date: '2026-09-11' });
    assert.match(first.title, /^2026-09-11 \d{2}:\d{2}:\d{2} · 每日选题 #01$/);
    assert.match(second.title, /^2026-09-11 \d{2}:\d{2}:\d{2} · 每日选题 #02$/);
    assert.equal(manual.title, '手动批次');
    assert.match(third.title, /^2026-09-11 \d{2}:\d{2}:\d{2} · 每日选题 #04$/);
    assert.equal(store.db.prepare('SELECT next_sequence FROM batch_daily_sequences WHERE batch_date=?').get('2026-09-11').next_sequence, 5);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
