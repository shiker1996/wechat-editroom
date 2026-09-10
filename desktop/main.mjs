import { app, BrowserWindow, Menu, dialog, shell, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(appRoot, 'server.mjs');
let serverProcess = null;
let mainWindow = null;
let rendererReady = false;
const pendingDesktopCommands = [];
let applicationMenuBuilt = false;
let shuttingDown = false;
let workspaceRootPath = null;
let logDirectoryPath = null;
const workspaceLocationFileName = 'workspace-location.txt';

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function defaultWorkspaceRoot() {
  return path.join(app.getPath('userData'), 'workspace');
}

function configuredWorkspaceRoot() {
  const locationFile = path.join(app.getPath('userData'), workspaceLocationFileName);
  try {
    const configuredPath = fs.readFileSync(locationFile, 'utf8').trim();
    if (configuredPath && path.isAbsolute(configuredPath)) return path.normalize(configuredPath);
  } catch {
    // A missing or unreadable installer marker falls back to the historical
    // per-user workspace location so upgrades remain safe.
  }
  return defaultWorkspaceRoot();
}

function seedWorkspaceResources(workspaceRoot) {
  const sourceRoot = path.join(appRoot, 'config');
  const targetRoot = path.join(workspaceRoot, 'config');
  if (!fs.existsSync(sourceRoot)) return;
  ensureDirectory(targetRoot);
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (!fs.existsSync(target)) fs.copyFileSync(source, target);
  }
}

function bundledNodeCandidates() {
  const packagedRoot = process.resourcesPath || '';
  return [
    process.env.WORKBENCH_NODE_PATH,
    path.join(packagedRoot, 'node-runtime', process.platform === 'win32' ? 'node.exe' : 'bin/node'),
    path.join(appRoot, '.node-runtime', 'node-v24.12.0', process.platform === 'win32' ? 'node.exe' : 'bin/node'),
  ].filter(Boolean);
}

function findNodeRuntime() {
  for (const candidate of bundledNodeCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const version = execFileSync(candidate, ['-p', 'process.versions.node'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5_000,
      }).trim();
      const major = Number.parseInt(version.split('.')[0], 10);
      if (major >= 24) return candidate;
    } catch {
      // Try the next candidate so a stale or non-executable bundled file does
      // not leave the desktop shell with an opaque startup failure.
    }
  }
  // Development fallback only. Packaged builds must carry the pinned runtime.
  const fallback = process.platform === 'win32' ? 'node.exe' : 'node';
  try {
    const version = execFileSync(fallback, ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    }).trim();
    if (Number.parseInt(version.split('.')[0], 10) >= 24) return fallback;
  } catch {
    // Report the actionable error below.
  }
  throw new Error('未找到 Node.js 24 或更高版本。开发环境请安装 Node.js 24，正式桌面包必须包含 node-runtime。');
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForWorkbench(port, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/overview`;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`工作台服务未能在规定时间内启动${lastError ? `：${lastError.message}` : ''}`);
}

function openExternalLinks() {
  if (!mainWindow) return;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://127.0.0.1:') && !url.startsWith('https://')) return { action: 'deny' };
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:')) {
      event.preventDefault();
      if (url.startsWith('https://')) void shell.openExternal(url);
    }
  });
}

function traceDesktopIpc(stage, details = {}) {
  const record = { time: new Date().toISOString(), stage, ...details };
  const line = `${JSON.stringify(record)}\n`;
  try {
    if (logDirectoryPath) fs.appendFileSync(path.join(logDirectoryPath, 'desktop-ipc.log'), line, 'utf8');
  } catch {
    // 诊断日志不能影响菜单功能。
  }
  console.log(`[desktop-ipc] ${stage}`, details);
}

let nextDesktopCommandId = 1;

function sendDesktopCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const message = typeof command === 'object' && command ? command : {
    id: nextDesktopCommandId++,
    command: String(command),
    createdAt: Date.now(),
  };
  traceDesktopIpc('menu-command', { id: message.id, command: message.command, rendererReady });
  if (!rendererReady) {
    pendingDesktopCommands.push(message);
    if (pendingDesktopCommands.length > 20) pendingDesktopCommands.shift();
    traceDesktopIpc('menu-command-queued', { id: message.id, command: message.command, queueLength: pendingDesktopCommands.length });
    return;
  }
  // 与 Electron 官方 IPC 菜单示例保持一致：菜单 click 只向目标
  // WebContents 发送命令，具体路由和对话框动作由 renderer 处理。
  traceDesktopIpc('menu-command-sent', { id: message.id, command: message.command });
  mainWindow.webContents.send('desktop-command', message);
}

function flushDesktopCommands() {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) return;
  const commands = pendingDesktopCommands.splice(0);
  commands.forEach((command) => sendDesktopCommand(command));
}

function buildApplicationMenu() {
  if (applicationMenuBuilt) return;
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '工作区',
      submenu: [
        { label: '工作台总览', accelerator: 'CmdOrCtrl+1', click: () => sendDesktopCommand('dashboard') },
        { label: '批次管理', accelerator: 'CmdOrCtrl+2', click: () => sendDesktopCommand('batches') },
        { label: '采集源', accelerator: 'CmdOrCtrl+3', click: () => sendDesktopCommand('sources') },
        { label: '文章编辑器', accelerator: 'CmdOrCtrl+4', click: () => sendDesktopCommand('editor') },
        { type: 'separator' },
        { label: '新建今日批次', accelerator: 'CmdOrCtrl+N', click: () => sendDesktopCommand('new-batch') },
        { label: '快速记素材', accelerator: 'CmdOrCtrl+Shift+M', click: () => sendDesktopCommand('quick-material') },
        { type: 'separator' },
        { label: '打开数据目录', click: () => { if (workspaceRootPath) void shell.openPath(workspaceRootPath); } },
        { label: '打开运行日志', click: () => { if (logDirectoryPath) void shell.openPath(logDirectoryPath); } },
        { type: 'separator' },
        isMac ? { role: 'quit', label: '退出见字' } : { role: 'quit', label: '退出见字' },
      ],
    },
    {
      label: '查看',
      submenu: [
        { label: '收起 / 展开侧栏', accelerator: 'CmdOrCtrl+B', click: () => sendDesktopCommand('toggle-rail') },
        { label: '显示快捷键', accelerator: 'CmdOrCtrl+/', click: () => sendDesktopCommand('shortcuts') },
        { type: 'separator' },
        { role: 'reload', label: '重新加载工作台' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '最大化 / 还原' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '首次使用说明', click: () => sendDesktopCommand('onboarding') },
        { label: '查看任务日志', click: () => sendDesktopCommand('logs') },
        { label: '显示快捷键', click: () => sendDesktopCommand('shortcuts') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  applicationMenuBuilt = true;
}

function startServer({ port, workspaceRoot, logDirectory }) {
  const nodePath = findNodeRuntime();
  if (!fs.existsSync(serverEntry)) throw new Error(`找不到工作台服务入口：${serverEntry}`);
  ensureDirectory(logDirectory);
  const stdoutPath = path.join(logDirectory, 'desktop-workbench.log');
  const stderrPath = path.join(logDirectory, 'desktop-workbench.error.log');
  const stdout = fs.createWriteStream(stdoutPath, { flags: 'a' });
  const stderr = fs.createWriteStream(stderrPath, { flags: 'a' });
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    WORKBENCH_RESOURCE_ROOT: appRoot,
    WORKBENCH_CONFIG_ROOT: workspaceRoot,
    WORKBENCH_WORKSPACE_ROOT: workspaceRoot,
    WORKBENCH_PORT: String(port),
    WORKBENCH_DESKTOP: '1',
    WORKBENCH_NODE_PATH: nodePath,
    WORKBENCH_RSSHUB_SOURCE_ROOT: fs.existsSync(path.join(process.resourcesPath || '', 'rsshub-source'))
      ? path.join(process.resourcesPath, 'rsshub-source')
      : path.join(appRoot, 'RSSHub'),
  };
  serverProcess = spawn(nodePath, ['--disable-warning=ExperimentalWarning', serverEntry], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProcess.stdout.pipe(stdout);
  serverProcess.stderr.pipe(stderr);
  serverProcess.once('error', (error) => {
    console.error(`工作台服务启动失败：${error.message}`);
  });
  serverProcess.once('exit', (code, signal) => {
    if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '见字工作台已停止',
        message: `本地工作台服务已退出（${signal || `代码 ${code ?? '未知'}`}）。`,
        detail: `日志：${stderrPath}`,
      });
    }
  });
}

async function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', finish);
    if (process.platform === 'win32') child.kill();
    else child.kill('SIGTERM');
    setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
        finish();
      }
    }, 5_000).unref();
  });
}

async function createMainWindow(port) {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: '见字 · 公众号编辑工作台',
    backgroundColor: '#f4f0e8',
    autoHideMenuBar: false,
    webPreferences: {
      // 沙箱预加载脚本必须使用 CommonJS；Electron 不会在 sandbox preload
      // 中执行 ESM import，否则会导致 desktopBridge 完全无法注入。
      preload: path.join(appRoot, 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 只在主框架发生真正文档导航时重置握手状态。
  // 旧的加载事件可能在首屏脚本已经 ready 后再次触发，会把可用状态
  // 错误改回 false，导致后续菜单命令全部排队，直到用户手动刷新页面。
  mainWindow.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    rendererReady = false;
    traceDesktopIpc('renderer-navigation-start', { url });
  });
  openExternalLinks();
  // 菜单属于窗口生命周期，不依赖首屏视图是否已经完成加载。
  // renderer 尚未就绪时由 sendDesktopCommand 暂存，ready 后再 flush。
  buildApplicationMenu();
  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.on('desktop-renderer-ready', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  rendererReady = true;
  traceDesktopIpc('renderer-ready');
  flushDesktopCommands();
});

ipcMain.on('desktop-command-trace', (event, details = {}) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  traceDesktopIpc(details.stage || 'renderer-trace', details);
});

async function boot() {
  const workspaceRoot = ensureDirectory(configuredWorkspaceRoot());
  workspaceRootPath = workspaceRoot;
  seedWorkspaceResources(workspaceRoot);
  const logDirectory = ensureDirectory(path.join(workspaceRoot, 'logs'));
  logDirectoryPath = logDirectory;
  const port = await findFreePort();
  startServer({ port, workspaceRoot, logDirectory });
  await waitForWorkbench(port);
  await createMainWindow(port);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(boot).catch(async (error) => {
    console.error(error);
    if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, { type: 'error', title: '见字工作台启动失败', message: error.message });
    else await dialog.showErrorBox('见字工作台启动失败', error.message);
    shuttingDown = true;
    await stopServer();
    app.quit();
  });
  app.on('before-quit', (event) => {
    if (shuttingDown || !serverProcess) return;
    event.preventDefault();
    shuttingDown = true;
    void stopServer().finally(() => app.quit());
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
