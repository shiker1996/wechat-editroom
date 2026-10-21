import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteUtf8 } from '../../../platform/core/atomic-file.mjs';

export function xPostId(value) {
  const text = String(value || '').trim();
  const match = text.match(/https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/(?:[^/?#]+\/status|i\/web\/status)\/(\d{5,30})/i);
  return match?.[1] || '';
}

function cacheFile(workspaceRoot, hotspotId) {
  if (!workspaceRoot || hotspotId == null || !Number.isFinite(Number(hotspotId))) return '';
  return path.join(workspaceRoot, 'data', 'reader-reactions-cache', `${Number(hotspotId)}.json`);
}

export function readReaderReactions(workspaceRoot, hotspotId) {
  const file = cacheFile(workspaceRoot, hotspotId);
  if (!file) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && value.schemaVersion === 1 ? value : null;
  } catch {
    return null;
  }
}

export function writeReaderReactions(workspaceRoot, hotspotId, value) {
  const file = cacheFile(workspaceRoot, hotspotId);
  if (!file) throw new Error('评论素材缓存目标无效');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return atomicWriteUtf8(file, `${JSON.stringify({ schemaVersion: 1, ...value }, null, 2)}\n`, { stat: true });
}
