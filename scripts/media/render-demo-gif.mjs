// 录制 README 用的工作台演示 GIF：从热点研判依次走过选题、编辑、排版视图。
// 用法：node scripts/media/render-demo-gif.mjs [baseUrl] [输出 gif]
// 依赖：演示模式服务与 puppeteer。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseUrl = (process.argv[2] || 'http://127.0.0.1:4317').replace(/\/$/, '');
const outPath = path.resolve(process.argv[3] || path.join(root, 'docs', 'screenshots', 'ui-demo.gif'));
const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-editroom-demo-'));

async function loadPuppeteer() {
  try {
    return (await import('puppeteer')).default;
  } catch {
    const require = createRequire(import.meta.url);
    const sibling = path.join(root, 'skills', 'html-pages-to-images');
    const entry = require.resolve('puppeteer', { paths: [process.cwd(), sibling] });
    const loaded = await import(pathToFileURL(entry).href);
    return loaded.default ?? loaded;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scenes = [
  ['dashboard', '工作台总览'],
  ['overview', '热点全景'],
  ['topics', '文章选题池'],
  ['editorial', 'AI 编辑会'],
  ['editor', '文章编辑器'],
  ['preview', '公众号排版'],
];
let frame = 0;

try {
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/#dashboard`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });

  for (const [view, label] of scenes) {
    if (view !== 'dashboard') await page.evaluate((nextView) => window.go(nextView), view);
    await sleep(view === 'dashboard' ? 1800 : 1400);
    // 6 个场景 × 14 帧 ÷ 4 fps = 21 秒，落在 README 要求的 20–30 秒区间。
    for (let i = 0; i < 14; i += 1) {
      const target = path.join(frameDir, `frame-${String(frame++).padStart(4, '0')}.png`);
      await page.screenshot({ path: target });
      await sleep(250);
    }
    console.log(`${label}: ${frame} frames`);
  }
} finally {
  await browser.close();
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
await run('ffmpeg', [
  '-y', '-loglevel', 'error', '-framerate', '4', '-i', path.join(frameDir, 'frame-%04d.png'),
  '-vf', 'fps=4,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
  '-loop', '0', outPath,
]);
fs.rmSync(frameDir, { recursive: true, force: true });
console.log(`gif -> ${outPath}`);
