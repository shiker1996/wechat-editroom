import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';

function tmpStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-history-'));
  return new Store(path.join(root, 'test.db'));
}

function addGitHubHotspot(store, batch, repository, scenarioIds, title) {
  store.addHotspots(batch.id, 'github', [{
    id: `github:${repository}`,
    title: repository,
    url: `https://github.com/${repository}`,
    sourceGroup: 'github',
    sourceType: 'search',
    sourceName: 'GitHub Search',
    repository,
    scenarioIds,
    projectType: 'tool',
    titleOverride: title,
  }]);
  return store.db.prepare('SELECT id FROM hotspots WHERE batch_id=? ORDER BY id DESC LIMIT 1').get(batch.id).id;
}

test('GitHub 历史覆盖识别同仓库、同场景和草稿项目', () => {
  const store = tmpStore();
  const publishedOne = store.createBatch({ date: '2026-08-20', title: '历史一' });
  const publishedTwo = store.createBatch({ date: '2026-08-25', title: '历史二' });
  const draftBatch = store.createBatch({ date: '2026-08-30', title: '草稿' });
  const current = store.createBatch({ date: '2026-09-07', title: '当前' });

  const firstHotspot = addGitHubHotspot(store, publishedOne, 'acme/old-tool', ['developer-productivity'], '旧工具');
  const secondHotspot = addGitHubHotspot(store, publishedTwo, 'acme/other-tool', ['file-content'], '文件工具一');
  const thirdHotspot = addGitHubHotspot(store, publishedTwo, 'acme/third-tool', ['file-content'], '文件工具二');
  const draftHotspot = addGitHubHotspot(store, draftBatch, 'acme/draft-tool', ['terminal-remote'], '草稿工具');
  store.repositories.candidates.addFromHotspots(publishedOne.id, [firstHotspot]);
  store.repositories.candidates.addFromHotspots(publishedTwo.id, [secondHotspot, thirdHotspot]);
  store.repositories.candidates.addFromHotspots(draftBatch.id, [draftHotspot]);
  const draftCandidate = store.db.prepare('SELECT id FROM candidates WHERE batch_id=? LIMIT 1').get(draftBatch.id);
  store.repositories.candidates.updateTrack(draftCandidate.id, 'article', { status: 'drafting' });
  const candidates = store.db.prepare('SELECT id,batch_id,hotspot_id FROM candidates WHERE batch_id IN (?,?,?)').all(publishedOne.id, publishedTwo.id, draftBatch.id);
  const finalDoc = store.db.prepare(`INSERT INTO documents
    (batch_id,candidate_row_id,kind,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`);
  const now = new Date().toISOString();
  for (const candidate of candidates.filter((item) => item.hotspot_id !== draftHotspot)) {
    finalDoc.run(candidate.batch_id, candidate.id, 'final', '已发布', 'final', now, now);
  }

  const coverage = store.findGitHubHistoryCoverage([
    { repository: 'acme/old-tool', scenarioIds: ['developer-productivity'] },
    { repository: 'acme/new-tool', scenarioIds: ['file-content'] },
    { repository: 'acme/draft-tool', scenarioIds: ['terminal-remote'] },
  ], { batchId: current.id });
  assert.equal(coverage['acme/old-tool'].status, 'same_repository_published');
  assert.equal(coverage['acme/new-tool'].status, 'same_scenario_published');
  assert.equal(coverage['acme/new-tool'].penalty, -10);
  assert.equal(coverage['acme/draft-tool'].status, 'same_repository_drafted');
  assert.equal(coverage['acme/draft-tool'].penalty, -20);
  store.close();
});
