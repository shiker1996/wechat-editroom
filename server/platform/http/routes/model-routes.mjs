import { deleteModelProvider, saveModelProvider } from '../../integrations/model-provider-settings.mjs';
import { getAgentRuntimeSettings, setAgentRuntimeSettings } from '../../integrations/agent-runtime-settings.mjs';

export async function handleModelRoutes(context) {
  const { request, response, pathname, root, config, store, models, body, json, codexOAuth, workbuddyOAuth, agentRuntimeRegistry } = context;
  const availableRuntimes = ['local-harness', ...(agentRuntimeRegistry?.list?.() || [])];

  if (pathname === '/api/agent-runtimes/codex/status' && request.method === 'GET') {
    const host = String(request.headers.host || '127.0.0.1');
    const port = Number(new URL(`http://${host}`).port || config.port || 4317);
    json(response, 200, { ...await codexOAuth.status(), workbuddy: { ...await workbuddyOAuth.status(), redirectUri: `http://127.0.0.1:${port}/auth/workbuddy/callback` }, ...getAgentRuntimeSettings(root), availableRuntimes });
    return true;
  }
  if (pathname === '/api/agent-runtimes/default' && request.method === 'GET') {
    json(response, 200, { ...getAgentRuntimeSettings(root), availableRuntimes });
    return true;
  }
  if (pathname === '/api/agent-runtimes/default' && request.method === 'PUT') {
    const input = await body(request);
    try { json(response, 200, setAgentRuntimeSettings(root, input, { registeredRuntimes: agentRuntimeRegistry?.list?.() || [] })); }
    catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  if (pathname === '/api/agent-runtimes/codex/oauth/start' && request.method === 'POST') {
    const host = String(request.headers.host || '127.0.0.1');
    const port = Number(new URL(`http://${host}`).port || config.port || 4317);
    const result = await codexOAuth.begin({ redirectUri: `http://127.0.0.1:${port}/auth/callback` });
    json(response, 200, result);
    return true;
  }
  if (pathname === '/api/agent-runtimes/codex/oauth/disconnect' && request.method === 'POST') {
    codexOAuth.disconnect();
    setAgentRuntimeSettings(root, { defaultRuntime: 'local-harness' });
    json(response, 200, { disconnected: true });
    return true;
  }
  if (pathname === '/api/agent-runtimes/workbuddy/application' && request.method === 'PUT') {
    try { json(response, 200, await workbuddyOAuth.saveApplication(await body(request))); }
    catch (error) { json(response, 400, { error: error.message || 'WorkBuddy 应用配置失败' }); }
    return true;
  }
  if (pathname === '/api/agent-runtimes/workbuddy/oauth/start' && request.method === 'POST') {
    try {
      const host = String(request.headers.host || '127.0.0.1');
      const port = Number(new URL(`http://${host}`).port || config.port || 4317);
      const redirectUri = `http://127.0.0.1:${port}/auth/workbuddy/callback`;
      json(response, 200, await workbuddyOAuth.begin({ redirectUri }));
    } catch (error) { json(response, 400, { error: error.message || 'WorkBuddy 授权启动失败' }); }
    return true;
  }
  if (pathname === '/api/agent-runtimes/workbuddy/oauth/disconnect' && request.method === 'POST') {
    workbuddyOAuth.disconnect();
    if (getAgentRuntimeSettings(root).defaultRuntime === 'workbuddy') setAgentRuntimeSettings(root, { defaultRuntime: 'local-harness' });
    json(response, 200, { disconnected: true });
    return true;
  }
  if (pathname === '/auth/workbuddy/callback' && request.method === 'GET') {
    try {
      const callback = `http://127.0.0.1${new URL(request.url, 'http://127.0.0.1').search}`;
      const result = await workbuddyOAuth.complete(callback);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(`<!doctype html><meta charset="utf-8"><title>见字 - WorkBuddy 已连接</title><p>WorkBuddy 账号 ${String(result.openId || '').replace(/[&<>"']/g, '') || '已授权'} 已连接，可以关闭此页面并返回见字。</p>`);
    } catch (error) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end(error.message || 'WorkBuddy OAuth 授权失败');
    }
    return true;
  }
  if (pathname === '/auth/callback' && request.method === 'GET') {
    try {
      const result = await codexOAuth.complete(`http://127.0.0.1${new URL(request.url, 'http://127.0.0.1').search}`);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(`<!doctype html><meta charset="utf-8"><title>见字 - Codex 已连接</title><p>ChatGPT 账号 ${String(result.email || '').replace(/[&<>"']/g, '')} 已连接，可以关闭此页面并返回见字。</p>`);
    } catch (error) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end(error.message || 'Codex OAuth 授权失败');
    }
    return true;
  }

  if (request.method === 'GET' && pathname === '/api/models') {
    json(response, 200, { ...models.listProviders(), calls: store.listModelCalls(150) });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/models/config') {
    const id = saveModelProvider(root, config, await body(request), { repository: store?.repositories?.extensionSettings });
    json(response, 200, { saved: true, id, ...models.listProviders() });
    return true;
  }
  const deleteMatch = pathname.match(/^\/api\/models\/config\/([^/]+)$/);
  if (request.method === 'DELETE' && deleteMatch) {
    const id = deleteModelProvider(root, config, decodeURIComponent(deleteMatch[1]), { repository: store?.repositories?.extensionSettings });
    json(response, 200, { deleted: true, id, ...models.listProviders() });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/models/test') {
    const input = await body(request);
    const result = await models.complete({
      provider: input.provider,
      purpose: 'connection-test',
      maxOutputTokens: 16,
      messages: [{ role: 'user', content: '只回复 OK', protected: true }],
    });
    json(response, 200, {
      provider: result.provider,
      model: result.model,
      reply: result.content,
      latencyTokens: result.usage,
      compressed: result.context.compressed,
    });
    return true;
  }
  return false;
}
