import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeProxyEnvironment } from '../../server/platform/network/node-proxy-environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entry = path.join(root, 'scripts', 'agent-integration', 'cli.mjs');
const env = nodeProxyEnvironment(process.env);
const args = [...(env.NODE_USE_ENV_PROXY === '1' ? ['--use-env-proxy'] : []), entry, ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  process.stderr.write(`见字 Agent CLI 启动失败：${result.error.message}\n`);
  process.exitCode = 1;
} else process.exitCode = result.status ?? 1;
