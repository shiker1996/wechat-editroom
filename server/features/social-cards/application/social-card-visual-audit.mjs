import fs from 'node:fs';
import { probeHtmlLayout } from '../../../platform/browser/html-layout-probe.mjs';

const AUDIT_SELECTORS = Object.freeze(['.page-body', '.page-content-stack']);

export async function auditSocialCardHtmlFit({ htmlPath, width = 375, height = 667, tolerancePx = 2, page: selectedPage = null } = {}) {
  const result = {
    valid: false,
    status: 'error',
    canvas: { width: Number(width) || 375, height: Number(height) || 667 },
    pageCount: 0,
    pages: [],
    checkedSelectors: [...AUDIT_SELECTORS],
    issues: [],
  };

  if (!htmlPath || !fs.existsSync(htmlPath)) {
    result.issues.push({ code: 'HTML_MISSING', message: '找不到待审计的 AI 图文 HTML' });
    return result;
  }

  try {
    const measurements = await probeHtmlLayout({
      html: fs.readFileSync(htmlPath, 'utf8'),
      width: result.canvas.width,
      height: result.canvas.height,
      pageSelector: '.page',
      selectors: AUDIT_SELECTORS,
      selectedPage,
    });

    result.pageCount = measurements.length;
    for (const item of measurements) {
      const pageReport = { page: item.page, valid: true, containers: [] };
      const pageStyle = item.pageStyle || {};
      const styleProblems = [];
      if (Math.abs(Number(pageStyle.width) - result.canvas.width) > tolerancePx) styleProblems.push(`画布宽度应为 ${result.canvas.width}px，实测 ${Math.round(Number(pageStyle.width) || 0)}px`);
      if (Math.abs(Number(pageStyle.height) - result.canvas.height) > tolerancePx) styleProblems.push(`画布高度应为 ${result.canvas.height}px，实测 ${Math.round(Number(pageStyle.height) || 0)}px`);
      if (pageStyle.overflow !== 'hidden') styleProblems.push(`画布 overflow 应为 hidden，实测 ${pageStyle.overflow || '未设置'}`);
      if (pageStyle.innerDisplay !== 'flex') styleProblems.push(`页面内部布局应为 flex，实测 ${pageStyle.innerDisplay || '缺少 .page-inner'}`);
      pageReport.pageStyle = pageStyle;
      if (styleProblems.length) {
        pageReport.valid = false;
        result.issues.push({
          code: 'PAGE_STYLE_DEGRADED',
          page: item.page,
          message: `第 ${item.page} 页样式或画布布局缺失：${styleProblems.join('；')}`,
        });
      }
      for (const container of item.containers) {
        if (!container.visible) continue;
        const overflowX = Math.max(0, container.scrollWidth - container.clientWidth);
        const overflowY = Math.max(0, container.scrollHeight - container.clientHeight);
        pageReport.containers.push({
          selector: container.selector,
          clientWidth: container.clientWidth,
          clientHeight: container.clientHeight,
          scrollWidth: container.scrollWidth,
          scrollHeight: container.scrollHeight,
          overflowX,
          overflowY,
        });
        if (overflowX <= tolerancePx && overflowY <= tolerancePx) continue;
        pageReport.valid = false;
        result.issues.push({
          code: 'CONTENT_OVERFLOW',
          page: item.page,
          selector: container.selector,
          overflowX,
          overflowY,
          overflowMode: { x: container.overflowX, y: container.overflowY },
          message: `第 ${item.page} 页 ${container.selector} 内容超出可用区域${overflowY > tolerancePx ? ` ${overflowY}px（纵向）` : ''}${overflowX > tolerancePx ? ` ${overflowX}px（横向）` : ''}`,
        });
      }
      result.pages.push(pageReport);
    }
    if (!result.pageCount) result.issues.push({
      code: selectedPage ? 'PAGE_NOT_FOUND' : 'NO_PAGES',
      page: Number(selectedPage) || undefined,
      message: selectedPage ? `AI 图文 HTML 中没有找到第 ${selectedPage} 页` : 'AI 图文 HTML 中没有找到 .page 页面',
    });
    result.valid = result.issues.length === 0;
    result.status = result.valid ? 'passed' : 'blocked';
    return result;
  } catch (error) {
    result.issues.push({ code: 'AUDIT_FAILED', message: `浏览器视觉适配审计失败：${error.message}` });
    return result;
  }
}
