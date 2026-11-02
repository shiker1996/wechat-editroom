import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCodexOAuthService } from '../server/platform/integrations/codex-oauth.mjs';

test('Codex OAuth surfaces safe token endpoint diagnostics without exposing authorization codes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzi-codex-oauth-'));
  try {
    const service = createCodexOAuthService({ root, fetchImpl: async () => new Response(JSON.stringify({
      error: { code: 'invalid_client', message: 'Client registration is not allowed' },
    }), { status: 403, headers: { 'content-type': 'application/json', 'x-request-id': 'req-test-123' } }) });
    const { authorizationUrl } = await service.begin({ redirectUri: 'http://127.0.0.1:1455/auth/callback' });
    const authorization = new URL(authorizationUrl);
    const callback = new URL('http://127.0.0.1:1455/auth/callback');
    callback.searchParams.set('code', 'private-authorization-code');
    callback.searchParams.set('state', authorization.searchParams.get('state'));
    callback.searchParams.set('client_id', 'oaiapp-test-client');

    await assert.rejects(service.complete(callback.toString()), (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.match(error.message, /invalid_client/);
      assert.match(error.message, /Client registration is not allowed/);
      assert.match(error.message, /req-test-123/);
      assert.doesNotMatch(error.message, /private-authorization-code/);
      return true;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
