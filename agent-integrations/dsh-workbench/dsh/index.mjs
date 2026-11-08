import { createJianziClient } from '../shared/client.mjs';
import { executeJianziTool } from '../shared/tools.mjs';

export const name = 'jianzi-content-workbench';
// Profile entries load concurrently, so resolving the Host HTTP carrier with
// ctx.get() at apply time can miss it and silently drop every panel route.
// Declaring the dependency lets cordis re-apply once webServer is active.
export const inject = ['webServer'];

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const failed = (error) => {
  console.error('Jianzi workbench route failure', error);
  const compatibilityError = error?.code === 'WORKBENCH_VERSION_MISMATCH';
  return {
    ok: false,
    error: {
      code: error?.code || 'JIANZI_READ_FAILED',
      message: compatibilityError ? error.message : 'Request failed',
      ...(compatibilityError && error.details ? { details: error.details } : {}),
    },
  };
};

// The Client panel cannot call MCP tools: those belong to the model-facing tool
// registry. It reads Jianzi data through read-only Host routes. Startup actions
// are prepared as native DSH prompts so the Agent invokes the MCP tool.
export function apply(ctx) {
  const server = ctx.webServer;

  const client = createJianziClient();
  const read = async (tool, args) => {
    try {
      return { ok: true, data: await executeJianziTool(client, tool, args || {}) };
    } catch (error) {
      return failed(error);
    }
  };

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/jianzi/status',
    resource: async () => json(await read('jianzi_doctor')),
  }), 'jianzi: status route');

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/jianzi/batches',
    resource: async (request) => {
      const url = new URL(request.url);
      const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 8));
      return json(await read('jianzi_batches_list', { limit }));
    },
  }), 'jianzi: batches route');

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/jianzi/candidates',
    resource: async (request) => {
      const url = new URL(request.url);
      const batchId = String(url.searchParams.get('batch') || '').trim();
      if (!batchId) {
        return json({ ok: false, error: { code: 'BATCH_REQUIRED', message: 'batch query parameter is required' } }, 400);
      }
      const track = url.searchParams.get('track') === 'social_cards' ? 'social_cards' : 'article';
      return json(await read('jianzi_batch_candidates', { batchId, track, kind: 'all' }));
    },
  }), 'jianzi: candidates route');

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/jianzi/social-ranking',
    resource: async (request) => {
      const url = new URL(request.url);
      const batchId = String(url.searchParams.get('batch') || '').trim();
      if (!batchId) {
        return json({ ok: false, error: { code: 'BATCH_REQUIRED', message: 'batch query parameter is required' } }, 400);
      }
      return json(await read('jianzi_batch_social_ranking', { batchId }));
    },
  }), 'jianzi: social ranking route');

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/jianzi/jobs',
    resource: async (request) => {
      const url = new URL(request.url);
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 12));
      const batchId = String(url.searchParams.get('batch') || '').trim();
      try {
        const rows = await client.get(`/api/jobs?limit=${limit}`);
        const list = Array.isArray(rows) ? rows : [];
        return json({ ok: true, data: batchId ? list.filter((row) => row.batch_id === batchId) : list });
      } catch (error) {
        return json(failed(error));
      }
    },
  }), 'jianzi: jobs route');

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/jianzi/calendar',
    resource: async (request) => {
      const url = new URL(request.url);
      const month = String(url.searchParams.get('month') || '').trim();
      const batchId = String(url.searchParams.get('batch') || '').trim();
      const result = await read('jianzi_calendar_list', month ? { month } : {});
      if (!result.ok || !Array.isArray(result.data)) return json(result);
      const baseUrl = String(client.baseUrl || 'http://127.0.0.1:4317').replace(/\/+$/, '');
      const data = result.data.filter((entry) => !batchId || String(entry?.batch_id || '') === batchId).map((entry) => {
        const id = Number(entry?.id);
        if (!Number.isSafeInteger(id) || id < 1) return entry;
        const path = entry.content_type === 'article'
          ? `/api/documents/${id}/content`
          : entry.content_type === 'social_cards'
            ? `/api/artifacts/${id}/preview`
            : '';
        return path ? { ...entry, previewUrl: `${baseUrl}${path}` } : entry;
      });
      return json({ ...result, data });
    },
  }), 'jianzi: calendar route');
}
