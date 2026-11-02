import test from 'node:test';
import assert from 'node:assert/strict';
import { executeJianziTool, findJianziTool } from '../scripts/agent-integration/tools.mjs';

function clientStub() {
  const calls = [];
  return {
    calls,
    async post(path, body) { calls.push({ method: 'POST', path, body }); return { ok: true }; },
  };
}

test('MCP candidate add routes social cards to event content by default', async () => {
  const client = clientStub();
  await executeJianziTool(client, 'jianzi_candidate_add', { batchId: 'batch-1', hotspotIds: [3], tracks: ['social_cards'] });
  assert.deepEqual(client.calls[0], {
    method: 'POST', path: '/api/batches/batch-1/candidates',
    body: { hotspotIds: [3], tracks: ['social_cards'], socialMaterialType: 'event' },
  });
});

test('MCP candidate add preserves an explicitly selected social material type', async () => {
  const client = clientStub();
  await executeJianziTool(client, 'jianzi_candidate_add', { batchId: 'batch-1', hotspotIds: [3], tracks: ['social_cards'], socialMaterialType: 'repository' });
  assert.equal(client.calls[0].body.socialMaterialType, 'repository');
});

test('candidate source fetch is exposed as a scoped MCP tool and calls the existing endpoint', async () => {
  const tool = findJianziTool('jianzi_candidate_source_fetch');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['candidateId']);
  const client = clientStub();
  await executeJianziTool(client, 'jianzi_candidate_source_fetch', { candidateId: 12, hotspotId: 7, force: true });
  assert.deepEqual(client.calls[0], {
    method: 'POST', path: '/api/candidates/12/source',
    body: { hotspotId: 7, eventId: undefined, force: true },
  });
});
