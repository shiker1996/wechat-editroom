import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const main = fs.readFileSync(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const renderer = fs.readFileSync(new URL('../public/src/main.js', import.meta.url), 'utf8');
const firstRun = fs.readFileSync(new URL('../public/src/core/first-run.js', import.meta.url), 'utf8');

test('Windows 安装引导使用中文向导并保留用户数据', () => {
  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.deepEqual(packageJson.build.nsis.installerLanguages, ['zh_CN']);
  assert.equal(packageJson.build.nsis.language, '2052');
  assert.equal(packageJson.build.nsis.include, 'build/installer.nsh');
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
});

test('桌面壳提供原生菜单、工作区目录和安全的渲染器桥接', () => {
  assert.match(main, /Menu\.buildFromTemplate/);
  assert.match(main, /打开数据目录/);
  assert.match(main, /preload: path\.join\(appRoot, 'desktop', 'preload\.cjs'\)/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('desktopBridge'/);
  assert.match(preload, /ipcRenderer\.on\('desktop-command'/);
  assert.match(preload, /removeListener\('desktop-command', listener\)/);
  assert.match(preload, /desktop-command-trace/);
  assert.match(preload, /desktop-renderer-ready/);
  assert.match(preload, /ready\(\)/);
  assert.match(main, /pendingDesktopCommands/);
  assert.match(main, /flushDesktopCommands/);
  assert.match(main, /did-start-navigation/);
  assert.doesNotMatch(main, /webContents\.on\(['"]did-start-loading['"]/);
  assert.doesNotMatch(main, /nativeCommandScripts/);
  assert.doesNotMatch(main, /executeJavaScript\(script\)/);
  assert.match(main, /webContents\.send\('desktop-command', message\)/);
  assert.match(main, /desktop-command-trace/);
  assert.match(main, /buildApplicationMenu\(\);/);
  assert.match(main, /new-batch/);
  assert.match(main, /quick-material/);
  assert.match(main, /onboarding/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
});

test('主界面提供桌面侧栏、快捷键和本机工作区提示', () => {
  assert.match(html, /id="rail-toggle"/);
  assert.match(html, /id="desktop-shortcuts-dialog"/);
  assert.match(html, /id="command-palette-dialog"/);
  assert.match(html, /本机工作区/);
  assert.match(renderer, /jianzhi\.rail-collapsed/);
  assert.match(renderer, /window\.desktopBridge\?\.onCommand/);
  assert.match(renderer, /bindCommandPalette\(\)/);
  assert.match(renderer, /bindDrawerScrollLock\(\)/);
  assert.match(renderer, /dialog\.drawer/);
  assert.match(renderer, /drawer-open/);
  assert.match(renderer, /commandPaletteItems/);
  assert.doesNotMatch(renderer, /desktopCommandTail/);
  assert.match(renderer, /renderer-dispatch/);
  assert.doesNotMatch(html, /class="nav-icon"[^>]*>\s*[^<\s][^<]*<\/span>/);
  assert.doesNotMatch(renderer, /font-size:0/);
  assert.match(fs.readFileSync(new URL('../public/styles/chrome.css', import.meta.url), 'utf8'), /\.nav-item>\.nav-label[^}]*white-space:nowrap/);
  assert.ok(renderer.indexOf('bindBatchDrawer();') < renderer.indexOf('window.desktopBridge?.ready?.();'));
  assert.ok(renderer.indexOf('window.desktopBridge?.ready?.();') < renderer.indexOf('await init();'));
  assert.match(renderer, /Ctrl\+\/|event\.key === "\/"/);
  assert.match(renderer, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(renderer, /\^\[1-4\]\$/);
  assert.match(html, /id="rail-toggle"/);
  assert.doesNotMatch(html, /pulse-dot/);
});

test('首次启动向导覆盖模型、采集、文章和图文交付路径', () => {
  assert.match(html, /id="first-run-dialog"/);
  assert.match(html, /id="first-run-progress"/);
  assert.match(html, /id="first-run-steps"/);
  assert.match(html, /id="view-editor"/);
  assert.match(html, /id="view-social-editor"/);
  assert.match(renderer, /openFirstRunWizard/);
  assert.match(renderer, /command === "onboarding"/);
  assert.match(firstRun, /\/api\/models/);
  assert.match(firstRun, /\/api\/collection-capabilities/);
  assert.match(firstRun, /jianzhi\.first-run-wizard\.v1/);
  assert.match(firstRun, /data-first-run-open/);
  assert.match(firstRun, /data-first-run-reddit-action/);
  assert.match(firstRun, /\/api\/system\/runtime\/reddit\/start/);
  assert.match(firstRun, /打开浏览器登录/);
  assert.match(firstRun, /renderProgressDock/);
  assert.doesNotMatch(firstRun, /installButton\.parentElement/);
  assert.match(main, /sendDesktopCommand\('onboarding'\)/);
});
