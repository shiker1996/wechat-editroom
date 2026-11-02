import crypto from 'node:crypto';
import { clearCredentialFields, getCredentialFields, setCredentialFields } from '../tools/remote-credentials.mjs';
import { protectLocalSecret, revealLocalSecret } from './windows-dpapi.mjs';

const PROFILE = 'workbuddy-runtime';
const PLUGIN_ID = 'workbuddy-runtime';
const AUTHORIZE_URL = 'https://www.workbuddy.cn/openapi/v2/authorize';
const TOKEN_URL = 'https://www.workbuddy.cn/openapi/v2/token';
const APP_FIELDS = ['clientId', 'clientSecret'];
const TOKEN_FIELDS = ['accessToken', 'refreshToken', 'openId', 'scope', 'expiresAt', 'tokenClientId'];
const REQUIRED_SCOPES = ['user.task.invokable', 'user.task.readable'];

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
async function oauthError(response, action) {
  let detail = '';
  try { const body = await response.json(); detail = body.msg || body.message || body.error_description || body.error || ''; } catch {}
  return new Error(`${action}失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
}
function parseScopes(value) { return new Set(String(value || '').split(/\s+/u).filter(Boolean)); }

export function createWorkBuddyOAuthService({ root, fetchImpl = fetch, now = Date.now } = {}) {
  const pending = new Map();
  const appCredentials = async () => {
    const saved = getCredentialFields(root, PROFILE, APP_FIELDS);
    if (!saved.clientId || !saved.clientSecret) return null;
    return { clientId: saved.clientId, clientSecret: await revealLocalSecret(saved.clientSecret) };
  };
  const saveTokens = async (tokenSet, clientId) => {
    const values = {
      accessToken: await protectLocalSecret(tokenSet.access_token),
      refreshToken: await protectLocalSecret(tokenSet.refresh_token),
      openId: tokenSet.open_id || '', scope: tokenSet.scope || '',
      expiresAt: String(now() + Number(tokenSet.expires_in || 0) * 1000),
      tokenClientId: await protectLocalSecret(clientId),
    };
    setCredentialFields(root, PLUGIN_ID, PROFILE, Object.fromEntries(Object.entries(values).filter(([, value]) => Boolean(value))));
  };
  const tokenFields = TOKEN_FIELDS;
  const readTokenFields = () => getCredentialFields(root, PROFILE, tokenFields);

  return {
    async saveApplication(input = {}) {
      const clientId = String(input.clientId || '').trim();
      const clientSecret = String(input.clientSecret || '').trim();
      const saved = getCredentialFields(root, PROFILE, APP_FIELDS);
      if (!clientId) throw new Error('请填写 WorkBuddy 应用 Client ID');
      if (!clientSecret && !saved.clientSecret) throw new Error('请填写 WorkBuddy 应用 Client Secret');
      if (saved.clientId && saved.clientId !== clientId) clearCredentialFields(root, PROFILE, TOKEN_FIELDS);
      const fields = { clientId };
      if (clientSecret) fields.clientSecret = await protectLocalSecret(clientSecret);
      setCredentialFields(root, PLUGIN_ID, PROFILE, fields);
      return this.status();
    },
    async status() {
      const saved = getCredentialFields(root, PROFILE, [...APP_FIELDS, ...TOKEN_FIELDS]);
      let secretReadable = false;
      if (saved.clientSecret) {
        try { await revealLocalSecret(saved.clientSecret); secretReadable = true; } catch {}
      }
      return {
        applicationConfigured: Boolean(saved.clientId && secretReadable),
        applicationClientId: saved.clientId || '',
        configured: Boolean(saved.refreshToken && saved.accessToken),
        openId: saved.openId || '', scope: saved.scope || '',
        expiresAt: Number(saved.expiresAt) || 0,
      };
    },
    async begin({ redirectUri }) {
      const app = await appCredentials();
      if (!app) throw Object.assign(new Error('请先填写并保存 WorkBuddy 开放平台应用凭据'), { code: 'WORKBUDDY_APP_CONFIG_REQUIRED' });
      const state = randomToken();
      const uri = new URL(AUTHORIZE_URL);
      uri.searchParams.set('response_type', 'code');
      uri.searchParams.set('client_id', app.clientId);
      uri.searchParams.set('redirect_uri', redirectUri);
      uri.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
      uri.searchParams.set('state', state);
      pending.set(state, { redirectUri, clientId: app.clientId, expiresAt: now() + 10 * 60_000 });
      return { authorizationUrl: uri.toString(), redirectUri, expiresInMs: 10 * 60_000 };
    },
    async complete(callbackUrl) {
      const url = new URL(callbackUrl);
      const state = url.searchParams.get('state') || '';
      const attempt = pending.get(state);
      pending.delete(state);
      if (!attempt || attempt.expiresAt <= now()) throw new Error('WorkBuddy OAuth 状态无效或已过期，请重新连接');
      if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || '用户取消了 WorkBuddy 授权');
      const code = url.searchParams.get('code');
      if (!code) throw new Error('WorkBuddy OAuth 回调缺少授权码');
      const app = await appCredentials();
      if (!app || app.clientId !== attempt.clientId) throw new Error('WorkBuddy 应用凭据已变更，请重新授权');
      const form = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: app.clientId,
        client_secret: app.clientSecret, redirect_uri: attempt.redirectUri });
      const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
      if (!response.ok) throw await oauthError(response, 'WorkBuddy OAuth 令牌交换');
      const tokens = await response.json();
      const scopes = parseScopes(tokens.scope);
      if (REQUIRED_SCOPES.some((scope) => !scopes.has(scope))) throw new Error('WorkBuddy 授权未包含云端任务创建与读取权限');
      await saveTokens(tokens, app.clientId);
      return { connected: true, openId: tokens.open_id || '' };
    },
    async getAccessToken() {
      const saved = readTokenFields();
      if (!saved.refreshToken || !saved.tokenClientId) throw Object.assign(new Error('请先连接 WorkBuddy 账号'), { code: 'WORKBUDDY_AUTH_REQUIRED' });
      const tokenClientId = await revealLocalSecret(saved.tokenClientId);
      const app = await appCredentials();
      if (!app || tokenClientId !== app.clientId) throw Object.assign(new Error('WorkBuddy 应用凭据与当前授权不匹配，请重新连接账号'), { code: 'WORKBUDDY_AUTH_REQUIRED' });
      let accessToken = '';
      try { accessToken = await revealLocalSecret(saved.accessToken); } catch {}
      if (accessToken && Number(saved.expiresAt) > now() + 60_000) return accessToken;
      const refreshToken = await revealLocalSecret(saved.refreshToken);
      const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken,
        client_id: app.clientId, client_secret: app.clientSecret });
      const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
      if (!response.ok) throw Object.assign(await oauthError(response, 'WorkBuddy OAuth 刷新'), { code: 'WORKBUDDY_AUTH_REQUIRED' });
      const tokens = await response.json();
      const updated = { ...tokens, access_token: tokens.access_token || accessToken,
        refresh_token: tokens.refresh_token || refreshToken, scope: tokens.scope || saved.scope };
      await saveTokens(updated, app.clientId);
      return updated.access_token;
    },
    disconnect() {
      clearCredentialFields(root, PROFILE, tokenFields);
      return { disconnected: true };
    },
  };
}

export const WORKBUDDY_REQUIRED_SCOPES = REQUIRED_SCOPES;
