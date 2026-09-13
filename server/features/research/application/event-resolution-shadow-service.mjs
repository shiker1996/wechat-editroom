import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../../../platform/core/workspace-paths.mjs';

function readJson(filePath) {
  try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  return null;
}

export function loadShadowHistory({ store, workspaceRoot, currentBatchId, limit = 30 } = {}) {
  const batches = store?.listBatches?.(limit) || [];
  const events = new Map();
  for (const batch of batches) {
    if (!batch?.id || batch.id === currentBatchId) continue;
    const file = path.join(batchTopicsDir(workspaceRoot, batch), 'sources', 'event-resolution-shadow.json');
    const payload = readJson(file);
    for (const event of payload?.events || []) {
      if (!event.event_id || events.has(event.event_id)) continue;
      events.set(event.event_id, { ...event, historyBatchId: batch.id });
    }
  }
  return [...events.values()];
}
