import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const databasePath = path.join(root, 'data', 'demo-production.db');
const outputDirectory = path.join(root, 'site');
const outputPath = path.join(outputDirectory, 'demo-data.json');
const publicBatchManifestPath = path.join(outputDirectory, 'public-demo-batch.json');

function argumentValue(name) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function cleanSource(value) {
  return String(value || '')
    .replace(/^\/+/, '')
    .replace(/\/lists\/\d+$/, '')
    .replace(/^readhub\/daily$/, 'Readhub daily')
    .replace(/^readhub$/, 'Readhub')
    .replace(/^huxiu\/article$/, '虎嗅')
    .replace(/^36kr\/hot-list$/, '36氪热榜')
    .replace(/^jiemian\/lists\/\d+$/, '界面新闻')
    .replace(/^DO news$/, 'DoNews')
    .trim() || '未知来源';
}

function parseScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.round(score * 10) / 10 : 0;
}

if (!fs.existsSync(databasePath)) {
  throw new Error(`找不到生产预览快照：${databasePath}`);
}

if (!fs.existsSync(publicBatchManifestPath)) {
  throw new Error(`找不到公开批次清单：${publicBatchManifestPath}`);
}

const publicBatchManifest = JSON.parse(fs.readFileSync(publicBatchManifestPath, 'utf8'));
const requestedBatchId = String(process.env.WORKBENCH_DEMO_BATCH_ID || argumentValue('--batch-id')).trim();
const batchId = requestedBatchId || String(publicBatchManifest.batchId || '').trim();
if (!batchId) throw new Error('公开批次清单缺少 batchId；请先人工确认要发布的已完成批次');
if (!requestedBatchId && publicBatchManifest.reviewStatus !== 'approved') {
  throw new Error('公开批次清单尚未通过人工审核；请确认脱敏后将 reviewStatus 设置为 approved');
}

const db = new DatabaseSync(databasePath, { readOnly: true });
const batch = db.prepare(`
  SELECT b.*
  FROM batches b
  WHERE b.id = ?
    AND EXISTS (SELECT 1 FROM hotspots h WHERE h.batch_id = b.id)
`).get(batchId);

if (!batch) throw new Error(`生产预览快照中没有可展示的指定批次：${batchId}`);

const hotspots = db.prepare(`
  SELECT id, title, category, market_scope, score, published_at, source_name, url
  FROM hotspots
  WHERE batch_id = ? AND research_eligible = 1
  ORDER BY score DESC, COALESCE(published_at, created_at) DESC
  LIMIT 36
`).all(batch.id).map((item, index) => ({
  rank: index + 1,
  id: item.id,
  title: String(item.title || '').trim(),
  category: String(item.category || '综合资讯').trim(),
  market: String(item.market_scope || '未标注').trim(),
  score: parseScore(item.score),
  publishedAt: item.published_at || '',
  source: cleanSource(item.source_name),
  url: safeExternalUrl(item.url),
}));

const events = db.prepare(`
  SELECT e.id, e.title, e.who, e.action_type, e.status, e.confidence,
         e.event_state, e.article_eligible, e.social_eligible,
         COUNT(eh.hotspot_id) AS hotspot_count
  FROM event_records e
  JOIN event_hotspots eh ON eh.event_id = e.id AND eh.batch_id = ?
  GROUP BY e.id
  ORDER BY hotspot_count DESC, e.confidence DESC, e.updated_at DESC
  LIMIT 18
`).all(batch.id).map((item, index) => ({
  rank: index + 1,
  id: item.id,
  title: String(item.title || '').trim(),
  who: String(item.who || '').trim(),
  action: String(item.action_type || '其他').trim(),
  status: String(item.status || 'active').trim(),
  confidence: String(item.confidence || 'medium').trim(),
  state: String(item.event_state || 'new_event').trim(),
  hotspotCount: Number(item.hotspot_count || 0),
  articleEligible: Boolean(item.article_eligible),
  socialEligible: Boolean(item.social_eligible),
}));

const candidates = db.prepare(`
  SELECT c.id, c.candidate_id, c.pool_role, c.risk_level, c.angle, c.thesis,
         c.h_score, c.b_score, c.p_score, c.s_score, c.d_score, c.f_score,
         c.status, c.content_class, c.content_route, h.title AS hotspot_title
  FROM candidates c
  LEFT JOIN hotspots h ON h.id = c.hotspot_id
  WHERE c.batch_id = ?
  ORDER BY COALESCE(c.f_score, 0) DESC, c.updated_at DESC
  LIMIT 12
`).all(batch.id).map((item, index) => ({
  rank: index + 1,
  id: item.id,
  candidateId: String(item.candidate_id || `C${String(index + 1).padStart(3, '0')}`),
  poolRole: String(item.pool_role || '候选池').trim(),
  risk: String(item.risk_level || '待评估').trim(),
  angle: String(item.angle || '').trim(),
  thesis: String(item.thesis || '').trim(),
  score: parseScore(item.f_score),
  status: String(item.status || 'pooled').trim(),
  contentClass: String(item.content_class || 'news_event').trim(),
  route: String(item.content_route || 'article').trim(),
  hotspotTitle: String(item.hotspot_title || '').trim(),
}));

const documents = db.prepare(`
  SELECT id, kind, title, visible_chars, status, created_at, updated_at
  FROM documents
  WHERE batch_id = ?
  ORDER BY updated_at DESC
  LIMIT 6
`).all(batch.id).map((item) => ({
  id: item.id,
  kind: String(item.kind || 'draft').trim(),
  title: String(item.title || '未命名文稿').trim(),
  chars: Number(item.visible_chars || 0),
  status: String(item.status || 'draft').trim(),
  updatedAt: item.updated_at || item.created_at || '',
}));

const categoryCounts = db.prepare(`
  SELECT COALESCE(category, '综合资讯') AS label, COUNT(*) AS value
  FROM hotspots
  WHERE batch_id = ? AND research_eligible = 1
  GROUP BY category
  ORDER BY value DESC
  LIMIT 8
`).all(batch.id).map((item) => ({ label: item.label, value: Number(item.value || 0) }));

const counts = {
  hotspots: Number(db.prepare('SELECT COUNT(*) AS n FROM hotspots WHERE batch_id = ? AND research_eligible = 1').get(batch.id).n || 0),
  events: Number(db.prepare('SELECT COUNT(DISTINCT event_id) AS n FROM event_hotspots WHERE batch_id = ?').get(batch.id).n || 0),
  candidates: Number(db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE batch_id = ?').get(batch.id).n || 0),
  documents: Number(db.prepare('SELECT COUNT(*) AS n FROM documents WHERE batch_id = ?').get(batch.id).n || 0),
};

const payload = {
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  source: {
    batchId: batch.id,
    date: batch.batch_date,
    title: batch.title,
    status: batch.status,
    stage: batch.stage,
    lifecycleStatus: batch.lifecycle_status,
  },
  counts,
  categoryCounts,
  hotspots,
  events,
  candidates,
  documents,
};

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`已导出 Vercel 只读 Demo 数据：${outputPath}`);
console.log(`批次 ${batch.id} · 热点 ${counts.hotspots} · 事件 ${counts.events} · 选题 ${counts.candidates} · 文稿 ${counts.documents}`);
