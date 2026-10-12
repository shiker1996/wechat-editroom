import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nodeProxyEnvironment } from '../../server/platform/network/node-proxy-environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const nodeOptions = ['--disable-warning=ExperimentalWarning'];
const serverOptions = [];

for (const arg of args) {
  if (arg === '--watch' || arg.startsWith('--watch-path=') || arg.startsWith('--inspect')) nodeOptions.push(arg);
  else serverOptions.push(arg);
}

const child = spawn(process.execPath, [...nodeOptions, path.join(root, 'server.mjs'), ...serverOptions], {
  cwd: root,
  env: nodeProxyEnvironment(process.env),
  stdio: 'inherit',
  windowsHide: true,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}

child.once('error', (error) => {
  console.error(`工作台服务启动失败：${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
