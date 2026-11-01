const DEFAULT_BASE_URL = 'http://127.0.0.1:4317';

function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname.toLowerCase())) {
    throw new Error('jianzi 只允许连接本机见字工作台（127.0.0.1 / localhost / ::1）');
  }
  if (url.protocol !== 'http:') throw new Error('jianzi 只支持本机 HTTP 工作台地址');
  return url.toString().replace(/\/$/, '');
}

export class JianziApiClient {
  constructor({ baseUrl = process.env.JIANZI_WORKBENCH_URL || DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetch = fetchImpl;
    this.csrfToken = '';
  }

  async request(method, pathname, body) {
    const verb = String(method || 'GET').toUpperCase();
    if (!pathname.startsWith('/api/')) throw new Error('API 路径必须以 /api/ 开头');
    const headers = { accept: 'application/json' };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(verb)) {
      if (!this.csrfToken) {
        const session = await this.fetch(`${this.baseUrl}/api/security/session`, { headers: { accept: 'application/json' } });
        const sessionData = await readResponse(session);
        this.csrfToken = String(sessionData.csrfToken || '');
        if (!this.csrfToken) throw new Error('工作台未返回本地会话令牌，请刷新或重启工作台');
      }
      headers['x-csrf-token'] = this.csrfToken;
      headers['content-type'] = 'application/json';
    }
    const response = await this.fetch(`${this.baseUrl}${pathname}`, {
      method: verb,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await readResponse(response);
    if (!response.ok) {
      const error = new Error(data.error || data.message || `工作台请求失败（HTTP ${response.status}）`);
      error.code = data.code || `HTTP_${response.status}`;
      error.status = response.status;
      error.details = data;
      throw error;
    }
    return data;
  }

  get(pathname) { return this.request('GET', pathname); }
  post(pathname, body = {}) { return this.request('POST', pathname, body); }
  put(pathname, body = {}) { return this.request('PUT', pathname, body); }
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new Error(`工作台返回了非 JSON 响应：${text.slice(0, 240)}`); }
}

export function createJianziClient(options) { return new JianziApiClient(options); }
