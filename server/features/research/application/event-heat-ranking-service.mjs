import fs from 'node:fs';
import path from 'node:path';
import { batchTopicsDir } from '../../../platform/core/workspace-paths.mjs';

/** Read the most recent completed batch's ranking for cross-batch movement. */
export function loadPreviousEventHeatItems({ store, workspaceRoot, batch, limit = 60 } = {}) {
  if (!store || !workspaceRoot || !batch) return [];
  const currentDate = String(batch.batch_date || '');
  const currentCreatedAt = String(batch.created_at || '');
  const previousBatches = (store.listBatches?.(limit) || [])
    .filter((candidate) => candidate?.id && candidate.id !== batch.id)
    .filter((candidate) => {
      const date = String(candidate.batch_date || '');
      if (date < currentDate) return true;
      return date === currentDate && String(candidate.created_at || '') < currentCreatedAt;
    })
    .sort((left, right) => String(right.batch_date || '').localeCompare(String(left.batch_date || ''))
      || String(right.created_at || '').localeCompare(String(left.created_at || '')));
  for (const previous of previousBatches) {
    const file = path.join(batchTopicsDir(workspaceRoot, previous), 'sources', 'event-heat-ranking.json');
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(payload?.items)) return payload.items;
    } catch {}
  }
  return [];
}
