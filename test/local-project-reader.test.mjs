import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractLocalProjectPath, readLocalProject } from '../server/platform/integrations/local-project-reader.mjs';

test('本地项目读取器只读取受支持文本并跳过密钥和依赖目录', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-project-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\nnpm run dev', 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'main.js'), 'console.log("ok")', 'utf8');
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=secret', 'utf8');
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'secret dependency', 'utf8');
  fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0, 1, 2]));
  const result = readLocalProject(root);
  assert.deepEqual(result.files.map((item) => item.path), ['README.md', path.join('src', 'main.js')]);
  assert.ok(!JSON.stringify(result).includes('API_KEY'));
  assert.equal(result.skipped.secrets, 1);
  assert.equal(result.skipped.directories, 1);
});

test('可从对话中识别 Windows 本地目录', () => {
  assert.equal(extractLocalProjectPath('请读取 E:\\projects\\demo，然后写教程。'), 'E:\\projects\\demo');
  assert.equal(extractLocalProjectPath('E:\\Documents\\write-assistant 这个我自己开发的工具想写一篇使用教程'), 'E:\\Documents\\write-assistant');
  assert.equal(extractLocalProjectPath('请读取 "E:\\My Projects\\demo app" 写教程'), 'E:\\My Projects\\demo app');
});

test('可识别单独一行中真实存在且包含空格的本地目录', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-path-'));
  const root = path.join(parent, 'my project');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  assert.equal(extractLocalProjectPath(root), root);
});

test('读取单个 txt、md 和 markdown 文件，并拒绝其他单文件类型', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-document-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const extension of ['.txt', '.md', '.markdown']) {
    const file = path.join(root, `article${extension}`);
    fs.writeFileSync(file, '# 标题\n\n这是文章内容。', 'utf8');
    const result = readLocalProject(file);
    assert.equal(result.totalFiles, 1);
    assert.deepEqual(result.files.map((item) => item.path), [path.basename(file)]);
    assert.match(result.files[0].excerpt, /文章内容/);
    assert.equal(extractLocalProjectPath(file), file);
  }
  const unsupported = path.join(root, 'article.json');
  fs.writeFileSync(unsupported, '{}', 'utf8');
  assert.throws(() => readLocalProject(unsupported), /单文件读取仅支持/);

  const spacedFile = path.join(root, '想写公众号爆款，第一步不是让 AI 写文章.md');
  fs.writeFileSync(spacedFile, '正文', 'utf8');
  assert.equal(extractLocalProjectPath(spacedFile), spacedFile);
});
