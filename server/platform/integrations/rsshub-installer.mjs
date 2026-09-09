import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import unzipper from 'unzipper';

// RSSHub does not publish desktop binaries. Keep the source revision explicit so
// a later installer run does not silently turn into a different dependency tree.
export const RSSHUB_INSTALL_MANIFEST = Object.freeze({
  revision: '49b3eb74531c6312e9eb11f8244e82ed0532de28',
  archiveUrl: 'https://github.com/DIYgod/RSSHub/archive/49b3eb74531c6312e9eb11f8244e82ed0532de28.zip',
  license: 'AGPL-3.0',
});

function normalizePath(value) {
  return path.resolve(String(value || ''));
}

function isInside(parent, target) {
  const relative = path.relative(normalizePath(parent), normalizePath(target));
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function bundledNodePath() {
  const value = String(process.env.WORKBENCH_NODE_PATH || '').trim();
  if (value && fs.existsSync(value)) return value;
  return process.execPath;
}

function nodeRuntimeRoot(nodePath) {
  return path.dirname(normalizePath(nodePath));
}

function npmCommand(nodePath) {
  const resourceRoot = path.resolve(process.env.WORKBENCH_RESOURCE_ROOT || process.cwd());
  const npmCli = path.join(resourceRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(npmCli)) return { command: nodePath, args: [npmCli] };
  const runtimeRoot = nodeRuntimeRoot(nodePath);
  if (process.platform === 'win32') return { command: path.join(runtimeRoot, 'npm.cmd'), args: [] };
  return { command: path.join(runtimeRoot, 'bin', 'npm'), args: [] };
}

function pnpmCommand(nodePath) {
  const resourceRoot = path.resolve(process.env.WORKBENCH_RESOURCE_ROOT || process.cwd());
  const pnpmCli = path.join(resourceRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  if (!fs.existsSync(pnpmCli)) return null;
  return { command: nodePath, args: [pnpmCli] };
}

function hasRsshubSource(rootDir) {
  return fs.existsSync(path.join(rootDir, 'package.json'))
    && fs.existsSync(path.join(rootDir, 'lib', 'index.ts'));
}

function bundledRsshubSourceRoot() {
  const resourceRoot = path.resolve(process.env.WORKBENCH_RESOURCE_ROOT || process.cwd());
  const explicit = String(process.env.WORKBENCH_RSSHUB_SOURCE_ROOT || '').trim();
  const candidates = [
    explicit,
    path.join(resourceRoot, 'rsshub-source'),
    path.join(resourceRoot, 'RSSHub'),
    path.resolve(process.cwd(), 'RSSHub'),
  ].filter(Boolean).map(normalizePath);
  return [...new Set(candidates)].find(hasRsshubSource) || null;
}

function copyRsshubSource(sourceRoot, targetRoot) {
  if (normalizePath(sourceRoot) === normalizePath(targetRoot)) return;
  const ignoredTopLevel = new Set(['node_modules', '.git', 'logs']);
  const shouldCopy = (sourcePath) => {
    const relative = path.relative(sourceRoot, sourcePath);
    if (!relative) return true;
    const parts = relative.split(path.sep);
    if (ignoredTopLevel.has(parts[0])) return false;
    return !parts.some((part) => part === '.env' || part.startsWith('.env.'));
  };
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    if (!shouldCopy(sourcePath)) continue;
    fs.cpSync(sourcePath, targetPath, { recursive: true, force: true, filter: shouldCopy });
  }
}

function hasRsshubDependencies(rootDir) {
  return fs.existsSync(path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'));
}

async function probe(baseUrl, timeoutMs = 1200) {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(timeoutMs) });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

export async function inspectRsshubEnvironment(config = {}) {
  const rootDir = normalizePath(config.rootDir);
  const sourceInstalled = hasRsshubSource(rootDir);
  const dependenciesInstalled = sourceInstalled && hasRsshubDependencies(rootDir);
  const healthy = await probe(config.baseUrl || 'http://127.0.0.1:1200');
  let reason = '';
  if (!sourceInstalled) reason = '尚未安装 RSSHub';
  else if (!dependenciesInstalled) reason = 'RSSHub 依赖尚未安装';
  else if (!healthy) reason = 'RSSHub 已安装，启动后即可使用';
  let revision = null;
  const markerPath = path.join(rootDir, '.workbench-rsshub.json');
  if (fs.existsSync(markerPath)) {
    try { revision = JSON.parse(fs.readFileSync(markerPath, 'utf8')).revision || null; } catch { revision = null; }
  }
  return {
    service: 'rsshub',
    ready: sourceInstalled && dependenciesInstalled,
    installed: sourceInstalled,
    dependenciesInstalled,
    healthy,
    rootDir,
    baseUrl: config.baseUrl || 'http://127.0.0.1:1200',
    revision,
    reason,
  };
}

function runProcess(command, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 600_000);
  const useWindowsShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(String(command));
  const quoteCmdArg = (value) => {
    const text = String(value);
    if (!/[\s"&|<>^]/.test(text)) return text;
    return `"${text.replace(/(["^])/g, '^$1')}"`;
  };
  const spawnCommand = useWindowsShell ? (process.env.ComSpec || 'cmd.exe') : command;
  const spawnArgs = useWindowsShell
    ? ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')]
    : args;
  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${options.label || command} 超时`));
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${options.label || command} 失败：${(stderr || stdout).trim() || `退出码 ${code}`}`));
    });
  });
}

async function downloadArchive(archivePath, onProgress) {
  onProgress?.('正在下载 RSSHub 安装包');
  const response = await fetch(RSSHUB_INSTALL_MANIFEST.archiveUrl, {
    headers: { 'user-agent': 'Jianzhi-Workbench RSSHub installer' },
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`RSSHub 下载失败：HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024 * 1024) throw new Error('RSSHub 下载内容异常，未写入安装目录');
  fs.writeFileSync(archivePath, buffer);
}

async function extractArchive(archivePath, extractionRoot, onProgress) {
  onProgress?.('正在解压 RSSHub');
  fs.mkdirSync(extractionRoot, { recursive: true });
  await fs.createReadStream(archivePath)
    .pipe(unzipper.Extract({ path: extractionRoot }))
    .promise();
  const entries = fs.readdirSync(extractionRoot, { withFileTypes: true });
  const sourceRoot = entries.find((entry) => entry.isDirectory() && fs.existsSync(path.join(extractionRoot, entry.name, 'package.json')));
  if (!sourceRoot) throw new Error('RSSHub 安装包结构无法识别');
  return path.join(extractionRoot, sourceRoot.name);
}

export async function installRsshub(config = {}, options = {}) {
  if (process.platform !== 'win32') throw new Error('RSSHub 一键安装目前只支持 Windows 桌面版');
  const rootDir = normalizePath(config.rootDir);
  const workspaceRoot = normalizePath(options.workspaceRoot || path.dirname(rootDir));
  if (!isInside(workspaceRoot, rootDir)) throw new Error('RSSHub 安装目录必须位于工作区内');
  if (fs.existsSync(rootDir) && !hasRsshubSource(rootDir)) throw new Error('RSSHub 目录已存在但不是有效安装，未覆盖现有文件');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzhi-rsshub-'));
  const archivePath = path.join(tempRoot, 'rsshub.zip');
  const extractionRoot = path.join(tempRoot, 'extract');
  const onProgress = options.onProgress || (() => {});
  try {
    const bundledSourceRoot = bundledRsshubSourceRoot();
    if (bundledSourceRoot) {
      onProgress?.('正在准备随应用提供的 RSSHub 源码');
      copyRsshubSource(bundledSourceRoot, rootDir);
    } else {
      await downloadArchive(archivePath, onProgress);
      const extractedRoot = await extractArchive(archivePath, extractionRoot, onProgress);
      if (!fs.existsSync(rootDir)) {
        fs.mkdirSync(path.dirname(rootDir), { recursive: true });
        fs.cpSync(extractedRoot, rootDir, { recursive: true, errorOnExist: true });
      }
    }
    if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml'))) {
      fs.rmSync(path.join(rootDir, 'package-lock.json'), { force: true });
    }
    const nodePath = bundledNodePath();
    const pnpm = fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml')) ? pnpmCommand(nodePath) : null;
    const npm = pnpm ? null : npmCommand(nodePath);
    if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml')) && !pnpm) {
      throw new Error('RSSHub 需要 pnpm，但应用内未找到 pnpm 运行时');
    }
    onProgress?.('正在安装 RSSHub 依赖，这一步可能需要几分钟');
    const manager = pnpm || npm;
    const installArgs = pnpm
      ? ['install', '--frozen-lockfile', '--ignore-scripts', '--config.package-manager-strict=false']
      : [fs.existsSync(path.join(rootDir, 'package-lock.json')) ? 'ci' : 'install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'];
    await runProcess(manager.command, [...manager.args, ...installArgs], {
      cwd: rootDir,
      timeoutMs: 30 * 60 * 1000,
      label: '安装 RSSHub 依赖',
      env: {
        PATH: `${nodeRuntimeRoot(nodePath)}${path.delimiter}${process.env.PATH || ''}`,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        HUSKY: '0',
      },
    });
    fs.writeFileSync(path.join(rootDir, '.workbench-rsshub.json'), JSON.stringify({
      revision: RSSHUB_INSTALL_MANIFEST.revision,
      installedAt: new Date().toISOString(),
      license: RSSHUB_INSTALL_MANIFEST.license,
    }, null, 2));
    onProgress?.('RSSHub 安装完成');
    return inspectRsshubEnvironment(config);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
