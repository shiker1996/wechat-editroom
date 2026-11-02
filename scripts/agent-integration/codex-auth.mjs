import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createCodexOAuthService } from '../../server/platform/integrations/codex-oauth.mjs';

const CALLBACK_PATH = '/auth/callback';

export function openSystemBrowser(url, { platform = process.platform, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      if (platform === 'win32') {
        child = spawnProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$url=[Console]::In.ReadToEnd(); Start-Process -FilePath $url'], {
          stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true,
        });
        child.stdin.end(String(url), 'utf8');
      } else if (platform === 'darwin') child = spawnProcess('open', [String(url)], { stdio: 'ignore' });
      else child = spawnProcess('xdg-open', [String(url)], { stdio: 'ignore' });
    } catch (error) { reject(error); return; }

    let stderr = '';
    child.stderr?.setEncoding?.('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`无法打开系统浏览器${stderr.trim() ? `：${stderr.trim()}` : ''}`)));
  });
}

function callbackPage(success) {
  const title = success ? '授权完成' : '授权失败';
  const message = success ? 'Codex 账号已连接。可以关闭此页面并返回见字。' : 'Codex 授权未完成。请返回终端查看错误并重试。';
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:24px;color:#24313d"><h1>${title}</h1><p>${message}</p></body></html>`;
}

export async function loginCodexOAuth({
  root,
  service = createCodexOAuthService({ root }),
  openBrowser = openSystemBrowser,
  platform = process.platform,
  timeoutMs = 10 * 60_000,
  onWaiting = () => {},
} = {}) {
  if (!root) throw new TypeError('Codex CLI 授权需要项目配置目录');
  if (platform !== 'win32') throw Object.assign(new Error('Codex OAuth 令牌保护目前只支持 Windows DPAPI'), { code: 'SECURE_STORE_UNAVAILABLE' });
  const before = await service.status();
  if (before.configured) return { provider: 'codex', configured: true, alreadyConnected: true };

  let settleCallback;
  let rejectCallback;
  let redirectUri = '';
  const callbackResult = new Promise((resolve, reject) => { settleCallback = resolve; rejectCallback = reject; });
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', redirectUri || 'http://127.0.0.1');
    if (request.method !== 'GET' || requestUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Not found');
      return;
    }
    try {
      const result = await service.complete(requestUrl.toString());
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      response.end(callbackPage(true));
      settleCallback(result);
    } catch (error) {
      response.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      response.end(callbackPage(false));
      rejectCallback(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法建立本机 Codex OAuth 回调');
  }
  redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
  let timer;
  try {
    const { authorizationUrl, expiresInMs } = await service.begin({ redirectUri });
    onWaiting({ expiresInMs });
    const loginResult = Promise.race([callbackResult, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Codex OAuth 等待超时，请重新运行 jianzi auth codex login'), { code: 'OAUTH_TIMEOUT' })), Math.min(timeoutMs, expiresInMs || timeoutMs));
    })]);
    await openBrowser(authorizationUrl);
    const connected = await loginResult;
    return { provider: 'codex', configured: true, alreadyConnected: false };
  } finally {
    clearTimeout(timer);
    await new Promise((resolve) => server.close(() => resolve()));
  }
}
