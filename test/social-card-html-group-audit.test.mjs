import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditSocialCardHtmlGroup } from '../server/features/social-cards/application/social-card-visual-audit.mjs';

const PAGE_ROLES = ['cover', 'content', 'content', 'ending'];

function pageMarkup(page, pageNumber, separator = '') {
  return `<!-- CARD-PAGE:${page}:START -->\n<section class="page" data-page="${pageNumber}" data-page-role="${PAGE_ROLES[page - 1]}"><div class="page-inner"><div class="page-body"><main class="page-content-stack"><h2>第 ${page} 页</h2><p>固定正文</p></main></div></div></section>\n<!-- CARD-PAGE:${page}:END -->${separator}`;
}

function buildHtml({ separator = '', pageNumbers = [1, 2, 3, 4], dropEndMarkerFor = 0 } = {}) {
  const pages = [1, 2, 3, 4].map((page, index) => pageMarkup(page, pageNumbers[index] ?? page, separator)).join('');
  const body = dropEndMarkerFor ? pages.replace(`<!-- CARD-PAGE:${dropEndMarkerFor}:END -->`, '') : pages;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

async function audit(html, expectedPageCount) {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-card-group-audit-'));
  const htmlPath = path.join(workdir, 'group.html');
  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    return await auditSocialCardHtmlGroup({ htmlPath, expectedPageCount });
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
}

test('整组结构审计接受首尾相接的相邻页面标记', async () => {
  // 分块 append 时 END 注释与下一页 START 注释之间可能没有任何空白字符。
  const report = await audit(buildHtml(), 4);
  assert.equal(report.valid, true, JSON.stringify(report.issues));
  assert.equal(report.pageCount, 4);
});

test('整组结构审计在页间留白时同样通过', async () => {
  const report = await audit(buildHtml({ separator: '\n' }), 4);
  assert.equal(report.valid, true, JSON.stringify(report.issues));
});

test('整组结构审计拒绝缺少结束锚点的文档', async () => {
  const report = await audit(buildHtml({ dropEndMarkerFor: 2 }), 4);
  assert.equal(report.valid, false);
  assert.equal(report.issues[0].code, 'DOCUMENT_STRUCTURE_INVALID');
  assert.equal(report.issues[0].actual.pageAnchorsValid, false);
});

test('整组结构审计拒绝页数与方案不一致的文档', async () => {
  const report = await audit(buildHtml(), 5);
  assert.equal(report.valid, false);
  assert.equal(report.issues[0].code, 'DOCUMENT_STRUCTURE_INVALID');
});

test('整组结构审计拒绝 data-page 顺序错乱的文档', async () => {
  const report = await audit(buildHtml({ pageNumbers: [2, 1, 3, 4] }), 4);
  assert.equal(report.valid, false);
  assert.equal(report.issues[0].code, 'DOCUMENT_STRUCTURE_INVALID');
  assert.equal(report.issues[0].actual.pageOrderValid, false);
});
