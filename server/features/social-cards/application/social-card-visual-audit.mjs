import fs from 'node:fs';
import puppeteer from 'puppeteer';

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

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: result.canvas.width, height: result.canvas.height, deviceScaleFactor: 1 });
    await page.setContent(fs.readFileSync(htmlPath, 'utf8'), { waitUntil: 'networkidle0' });
    await page.evaluateHandle(() => document.fonts.ready);

    const measurements = await page.evaluate(({ selectors, selectedPage }) => {
      const pages = [...document.querySelectorAll('.page')];
      return pages.map((pageElement, pageIndex) => {
        const containers = selectors.flatMap((selector) => [...pageElement.querySelectorAll(selector)].map((element) => {
          const style = getComputedStyle(element);
          return {
            selector,
            visible: style.display !== 'none' && style.visibility !== 'hidden',
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
          };
        }));
        return { page: pageIndex + 1, containers };
      }).filter((item) => !selectedPage || item.page === selectedPage);
    }, { selectors: AUDIT_SELECTORS, selectedPage: Number(selectedPage) || null });

    result.pageCount = measurements.length;
    for (const item of measurements) {
      const pageReport = { page: item.page, valid: true, containers: [] };
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
  } finally {
    if (browser) await browser.close();
  }
}
