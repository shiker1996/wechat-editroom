import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { clearCredentialFields, getCredentialFields, setCredentialFields } from '../tools/remote-credentials.mjs';
import { protectLocalSecret, revealLocalSecret } from './windows-dpapi.mjs';

const PROFILE = 'codex-chatgpt-plan';
const PLUGIN_ID = 'codex-runtime';
const AUTH_URL = 'https://auth.openai.com/api/accounts/authorize';
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
const JWKS_URL = 'https://auth.openai.com/.well-known/jwks.json';
const RESOURCE = 'https://api.openai.com/v1';
const REQUIRED_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'];
const TOKEN_FIELDS = ['accessToken', 'refreshToken', 'idToken', 'clientId', 'email', 'subject', 'scope', 'expiresAt', 'hostId'];

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function hostIdPath(root) { return path.join(root, 'data', 'codex-runtime-host.json'); }

function readHostId(root) {
  const file = hostIdPath(root);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof data.hostId === 'string' && data.hostId) {
      const raw = data.hostId.replace(/^urn:uuid:/i, '');
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
        const hostId = `urn:uuid:${raw.toLowerCase()}`;
        if (hostId !== data.hostId) fs.writeFileSync(file, `${JSON.stringify({ hostId }, null, 2)}\n`, { mode: 0o600 });
        return hostId;
      }
    }
  } catch {}
  const hostId = `urn:uuid:${crypto.randomUUID()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ hostId }, null, 2)}\n`, { mode: 0o600 });
  return hostId;
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('OAuth 返回的 ID Token 格式无效');
  try {
    return { header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()), claims: JSON.parse(Buffer.from(parts[1], 'base64url').toString()), signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
  } catch { throw new Error('OAuth 返回的 ID Token 无法解析'); }
}

async function validateIdToken(token, { clientId, nonce, fetchImpl }) {
  const parsed = parseJwt(token);
  if (parsed.header.alg !== 'RS256' || typeof parsed.header.kid !== 'string') throw new Error('ID Token 使用了不支持的签名算法');
  const jwksResponse = await fetchImpl(JWKS_URL);
  if (!jwksResponse.ok) throw new Error(`无法获取 OpenAI 签名公钥（HTTP ${jwksResponse.status}）`);
  const jwks = await jwksResponse.json();
  const jwk = jwks.keys?.find((item) => item.kid === parsed.header.kid && item.kty === 'RSA');
  if (!jwk) throw new Error('ID Token 签名密钥未被信任');
  const validSignature = crypto.verify('RSA-SHA256', Buffer.from(parsed.signingInput), crypto.createPublicKey({ key: jwk, format: 'jwk' }), parsed.signature);
  const claims = parsed.claims;
  const now = Math.floor(Date.now() / 1000);
  if (!validSignature || claims.iss !== 'https://auth.openai.com') throw new Error('ID Token 签名或发行方校验失败');
  if (!(claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId)))) throw new Error('ID Token audience 与 OAuth 客户端不匹配');
  if (!Number.isFinite(claims.exp) || claims.exp <= now || claims.nonce !== nonce || typeof claims.sub !== 'string') throw new Error('ID Token 已过期或身份校验失败');
  return claims;
}

function scopesFrom(value) { return new Set(String(value || '').split(/\s+/).filter(Boolean)); }

async function oauthFailure(response, operation) {
  let payload = null;
  try { payload = await response.json(); } catch { /* OAuth errors may not be JSON. */ }
  const error = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
  const code = typeof error?.code === 'string' ? error.code : typeof payload?.error === 'string' ? payload.error : '';
  const message = [error?.message, payload?.error_description, payload?.detail, payload?.message]
    .find((value) => typeof value === 'string' && value.trim());
  const requestId = response.headers?.get?.('x-request-id') || response.headers?.get?.('request-id') || '';
  const details = [code, message ? String(message).slice(0, 500) : '', requestId ? `request_id=${requestId}` : ''].filter(Boolean);
  return new Error(`${operation}失败（HTTP ${response.status}${details.length ? `：${details.join('；')}` : ''}）`);
}

export function createCodexOAuthService({ root, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!root) throw new TypeError('Codex OAuth 需要配置根目录');
  const pending = new Map();
  const loadCredentials = async () => {
    const values = getCredentialFields(root, PROFILE, TOKEN_FIELDS);
    for (const field of ['accessToken', 'refreshToken', 'idToken']) if (values[field]) values[field] = await revealLocalSecret(values[field]);
    return values;
  };
  const saveCredentials = (values) => setCredentialFields(root, PLUGIN_ID, PROFILE, values);

  return {
    async status() {
      const fields = getCredentialFields(root, PROFILE, TOKEN_FIELDS);
      const ready = Boolean(fields.refreshToken && fields.clientId && fields.subject && scopesFrom(fields.scope).has('chatgpt.tokens.use.direct'));
      return { provider: 'codex', configured: ready, email: ready ? fields.email || '' : '', expiresAt: ready ? Number(fields.expiresAt) : null };
    },
    async begin({ redirectUri, agentName = '见字工作台' } = {}) {
      const uri = new URL(redirectUri);
      if (uri.protocol !== 'http:' || uri.hostname !== '127.0.0.1' || uri.pathname !== '/auth/callback') throw new Error('Codex OAuth 回调必须是 127.0.0.1 的 /auth/callback');
      const state = randomToken();
      const nonce = randomToken();
      const verifier = randomToken(48);
      const credentials = await loadCredentials();
      const clientId = credentials.clientId || 'dynamic_agent_client';
      const hostId = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(credentials.hostId || '')
        ? credentials.hostId : readHostId(root);
      const query = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: uri.toString(),
        scope: REQUIRED_SCOPES.join(' '),
        resource: RESOURCE,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
        ext_agent_host_id: hostId,
      });
      if (clientId === 'dynamic_agent_client') query.set('agent_name_hint', agentName);
      else if (credentials.idToken) query.set('id_token_hint', credentials.idToken);
      if (credentials.email) query.set('login_hint', credentials.email);
      pending.set(state, { nonce, verifier, redirectUri: uri.toString(), requestedClientId: clientId, expiresAt: now() + 10 * 60_000 });
      return { authorizationUrl: `${AUTH_URL}?${query}`, expiresInMs: 10 * 60_000 };
    },
    async complete(callbackUrl) {
      const url = new URL(callbackUrl);
      const state = url.searchParams.get('state') || '';
      const attempt = pending.get(state);
      pending.delete(state);
      if (!attempt || attempt.expiresAt <= now()) throw new Error('Codex OAuth 状态无效或已过期，请重新连接');
      if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || '用户取消了 Codex 授权');
      const code = url.searchParams.get('code');
      const returnedClientId = url.searchParams.get('client_id');
      const clientId = attempt.requestedClientId === 'dynamic_agent_client' ? returnedClientId : attempt.requestedClientId;
      if (!code || !clientId || (returnedClientId && attempt.requestedClientId !== 'dynamic_agent_client' && returnedClientId !== attempt.requestedClientId)) throw new Error('Codex OAuth 回调缺少授权码或客户端 ID');
      const form = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE });
      const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
      if (!response.ok) throw await oauthFailure(response, 'Codex OAuth 令牌交换');
      const tokens = await response.json();
      const claims = await validateIdToken(tokens.id_token, { clientId, nonce: attempt.nonce, fetchImpl });
      const granted = scopesFrom(tokens.scope || url.searchParams.get('scope'));
      if (REQUIRED_SCOPES.some((scope) => !granted.has(scope))) throw new Error('当前 ChatGPT 授权未包含计划推理所需权限');
      const hostId = (await loadCredentials()).hostId || readHostId(root);
      saveCredentials({ accessToken: await protectLocalSecret(tokens.access_token), refreshToken: await protectLocalSecret(tokens.refresh_token), idToken: await protectLocalSecret(tokens.id_token),
        clientId, email: claims.email || '', subject: claims.sub, scope: [...granted].join(' '),
        expiresAt: String(now() + Number(tokens.expires_in || 0) * 1000), hostId });
      return { connected: true, email: claims.email || '' };
    },
    async getAccessToken() {
      let credentials = getCredentialFields(root, PROFILE, TOKEN_FIELDS);
      if (!credentials.refreshToken) throw Object.assign(new Error('请先连接 ChatGPT 账号'), { code: 'CODEX_AUTH_REQUIRED' });
      let accessToken = '';
      try { accessToken = await revealLocalSecret(credentials.accessToken); } catch { /* Refresh token can repair a truncated or stale access token. */ }
      if (accessToken && Number(credentials.expiresAt) > now() + 60_000) return accessToken;
      const refreshToken = await revealLocalSecret(credentials.refreshToken);
      const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: credentials.clientId, resource: RESOURCE });
      const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
      if (!response.ok) throw Object.assign(await oauthFailure(response, 'Codex OAuth 刷新'), { code: 'CODEX_AUTH_REQUIRED' });
      const tokens = await response.json();
      credentials = { ...credentials, accessToken: tokens.access_token || accessToken,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresAt: String(now() + Number(tokens.expires_in || 0) * 1000), scope: tokens.scope || credentials.scope };
      credentials.accessToken = await protectLocalSecret(credentials.accessToken);
      credentials.refreshToken = await protectLocalSecret(credentials.refreshToken);
      if (tokens.id_token) credentials.idToken = await protectLocalSecret(tokens.id_token);
      saveCredentials(credentials);
      return tokens.access_token || accessToken;
    },
    disconnect() {
      clearCredentialFields(root, PROFILE, TOKEN_FIELDS);
      return { disconnected: true };
    },
  };
}
