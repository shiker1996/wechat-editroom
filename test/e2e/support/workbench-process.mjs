import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function createRsshubFixture(root) {
  const rsshubRoot = path.join(root, 'rsshub-fixture');
  fs.mkdirSync(path.join(rsshubRoot, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(rsshubRoot, 'node_modules', 'tsx', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(rsshubRoot, 'package.json'), JSON.stringify({ name: 'e2e-rsshub-fixture', private: true }, null, 2));
  fs.writeFileSync(path.join(rsshubRoot, 'lib', 'index.ts'), '// E2E only: the HTTP fixture is provided by startFakeRssHub.\n');
  fs.writeFileSync(path.join(rsshubRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '// E2E only: RSSHub is already served by the local HTTP fixture.\n');
  return rsshubRoot;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
  const body = await response.text();
  let data = null; try { data = JSON.parse(body); } catch { data = body; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} -> HTTP ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function startWorkbench({ projectRoot, workspaceRoot, configRoot, port, env = {} }) {
  if (!port) {
    const probe = net.createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
  }
  const configPath = path.join(configRoot, 'config.local.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.port = port;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
  const output = [];
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
    cwd: projectRoot,
    env: { ...process.env, WORKBENCH_CONFIG_ROOT: configRoot, WORKBENCH_WORKSPACE_ROOT: workspaceRoot, WORKBENCH_PORT: String(port), E2E_FIXTURE_KEY: 'fixture-key', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { await requestJson(`${baseUrl}/api/security/session`); break; } catch { await delay(100); }
  }
  if (Date.now() >= deadline) throw new Error(`Workbench 未启动：${output.join('')}`);
  let csrf = null;
  async function api(pathname, options = {}) {
    if (!csrf) csrf = (await requestJson(`${baseUrl}/api/security/session`)).csrfToken;
    const headers = options.method && options.method !== 'GET' ? { 'x-csrf-token': csrf } : {};
    return requestJson(`${baseUrl}${pathname}`, { ...options, headers: { ...headers, ...(options.headers || {}) }, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  }
  async function close() {
    if (child.exitCode == null) child.kill('SIGTERM');
    const deadline = Date.now() + 10000;
    while (child.exitCode == null && Date.now() < deadline) await delay(50);
    if (child.exitCode == null) child.kill('SIGKILL');
  }
  return { baseUrl, api, close, logs: output, process: child };
}

export async function waitForJob(api, jobId, timeoutOrOptions = 180000) {
  const options = typeof timeoutOrOptions === 'number' ? { timeoutMs: timeoutOrOptions } : (timeoutOrOptions || {});
  const timeoutMs = options.timeoutMs ?? 180000;
  const intervalMs = options.intervalMs ?? 250;
  const observedStatuses = options.observedStatuses || [];
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
    observedStatuses.push(latest.status);
    await options.onPoll?.(latest, observedStatuses.length);
    if (['completed', 'failed', 'interrupted', 'cancelled'].includes(latest.status)) {
      if (latest.status !== 'completed') throw new Error(`任务 ${jobId} 失败：${latest.error || latest.progress || JSON.stringify(latest)}`);
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`任务 ${jobId} 超时：${JSON.stringify(latest)}`);
}

export function writeFixtureConfig(configRoot, config) {
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(path.join(configRoot, 'config.local.json'), JSON.stringify(config, null, 2));
}
