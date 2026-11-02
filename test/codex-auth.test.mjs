import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loginCodexOAuth } from '../scripts/agent-integration/codex-auth.mjs';

test('Codex CLI login opens the browser, validates the loopback callback through OAuth service, and returns no auth URL', async () => {
  const root = path.resolve('.');
  let authorizationUrl = '';
  let callbackUri = '';
  let completeUrl = '';
  const service = {
    async status() { return { provider: 'codex', configured: false, email: '', expiresAt: null }; },
    async begin(input) {
      callbackUri = input.redirectUri;
      return { authorizationUrl: 'https://auth.example.test/authorize?state=private-state', expiresInMs: 2_000 };
    },
    async complete(url) { completeUrl = url; return { connected: true, email: 'test@example.com' }; },
  };
  const result = await loginCodexOAuth({
    root, service, platform: 'win32', timeoutMs: 1_000,
    openBrowser: async (url) => {
      authorizationUrl = url;
      const callback = new URL(callbackUri);
      callback.search = '?code=fake-code&state=private-state&client_id=fake-client';
      const response = await fetch(callback);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /授权完成/);
    },
  });
  assert.equal(authorizationUrl, 'https://auth.example.test/authorize?state=private-state');
  assert.match(callbackUri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.equal(new URL(completeUrl).searchParams.get('code'), 'fake-code');
  assert.deepEqual(result, { provider: 'codex', configured: true, alreadyConnected: false });
  assert.equal(JSON.stringify(result).includes('private-state'), false);
  assert.equal(JSON.stringify(result).includes('fake-code'), false);
});

test('Codex CLI login skips browser authorization when already connected', async () => {
  let opened = false;
  const service = {
    async status() { return { provider: 'codex', configured: true, email: 'connected@example.com', expiresAt: 1234 }; },
    async begin() { throw new Error('must not start OAuth'); },
  };
  const result = await loginCodexOAuth({ root: path.resolve('.'), service, platform: 'win32', openBrowser: async () => { opened = true; } });
  assert.equal(opened, false);
  assert.equal(result.alreadyConnected, true);
  assert.equal(result.configured, true);
});

test('all interactive Agent Skills declare the platform-neutral external Runtime contract', () => {
  const skillIds = [
    'account-context-assistant',
    'editorial-room-chat',
    'wechat-mp-tutorial',
    'wechat-mp-personal-writing',
    'custom-card-storyboard',
    'article-cover-ai-visual-generator',
    'social-card-ai-visual-generator',
  ];
  for (const skillId of skillIds) {
    const manifestPath = path.join('skills', skillId, 'skill.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.runtimePolicy, { mode: 'external-agent', requiredCapabilities: ['hostToolCallbacks'] }, skillId);
  }
});
