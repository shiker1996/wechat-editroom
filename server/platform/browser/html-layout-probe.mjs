import puppeteer from 'puppeteer';

/** Render a trusted HTML document in Chromium and report element box metrics. */
export async function probeHtmlLayout({ html, width = 375, height = 667, pageSelector = 'body', selectors = [], selectedPage = null, includeContactSheet = false } = {}) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: Number(width) || 375, height: Number(height) || 667, deviceScaleFactor: 1 });
    await page.setContent(String(html || ''), { waitUntil: 'networkidle0' });
    await page.evaluateHandle(() => document.fonts.ready);

    const measurements = await page.evaluate(({ pageSelector, selectors, selectedPage }) => {
      const pages = [...document.querySelectorAll(pageSelector)];
      return pages.map((pageElement, pageIndex) => ({
        page: pageIndex + 1,
        pageStyle: (() => {
          const style = getComputedStyle(pageElement);
          const rect = pageElement.getBoundingClientRect();
          const inner = pageElement.querySelector('.page-inner');
          const innerStyle = inner ? getComputedStyle(inner) : null;
          return {
            width: rect.width,
            height: rect.height,
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            display: style.display,
            overflow: style.overflow,
            pageNumber: pageElement.dataset.page || '',
            role: pageElement.dataset.pageRole || (pageElement.classList.contains('page-cover') ? 'cover' : pageElement.classList.contains('page-ending') ? 'ending' : ''),
            visualComposition: pageElement.dataset.visualComposition || '',
            primaryVisual: pageElement.dataset.primaryVisual || '',
            backgroundMode: pageElement.dataset.backgroundMode || '',
            accentPlacement: pageElement.dataset.accentPlacement || '',
            sharedAnchorIds: [...pageElement.querySelectorAll('[data-shared-anchor]')].filter((element) => {
              const anchorStyle = getComputedStyle(element);
              const anchorRect = element.getBoundingClientRect();
              return anchorStyle.display !== 'none' && anchorStyle.visibility !== 'hidden' && Number(anchorStyle.opacity) > 0 && anchorRect.width > 0 && anchorRect.height > 0;
            }).map((element) => element.dataset.sharedAnchor || '').filter(Boolean),
            listItemCount: Number(pageElement.dataset.listItemCount) || 0,
            innerDisplay: innerStyle?.display || null,
            innerHeight: inner?.getBoundingClientRect().height ?? null,
          };
        })(),
        listMetrics: (() => {
          const items = [...new Set(pageElement.querySelectorAll('li, [data-list-item], .list-item, .list-card, .feature-item, .flow-card, .step, .check, .risk'))];
          if (!items.length) return { itemCount: 0, averageItemHeight: 0, minItemHeight: 0, totalHeight: 0 };
          const heights = items.map((item) => item.getBoundingClientRect().height);
          return {
            itemCount: items.length,
            averageItemHeight: heights.reduce((sum, value) => sum + value, 0) / heights.length,
            minItemHeight: Math.min(...heights),
            totalHeight: heights.reduce((sum, value) => sum + value, 0),
          };
        })(),
        containers: selectors.flatMap((selector) => [...pageElement.querySelectorAll(selector)].map((element) => {
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
        })),
      })).filter((item) => !selectedPage || item.page === selectedPage);
    }, { pageSelector, selectors, selectedPage: Number(selectedPage) || null });

    if (includeContactSheet && !selectedPage) {
      const pageElements = await page.$$(pageSelector);
      const imageTiles = [];
      for (let index = 0; index < pageElements.length; index += 1) {
        const image = await pageElements[index].screenshot({ type: 'png', encoding: 'base64' });
        imageTiles.push(`<figure><figcaption>第 ${index + 1} 页</figcaption><img src="data:image/png;base64,${image}" alt="第 ${index + 1} 页图文预览"></figure>`);
      }
      const contactSheet = await browser.newPage();
      await contactSheet.setViewport({ width: 584, height: 760, deviceScaleFactor: 1 });
      await contactSheet.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:12px;background:#e8e9e5;color:#222;font:700 11px Arial,sans-serif}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}figure{margin:0;padding:4px;background:#fff;box-shadow:0 1px 4px #0002}figcaption{height:17px}img{display:block;width:100%;height:auto;aspect-ratio:375/667;object-fit:contain;background:#ddd}</style><div class="grid">${imageTiles.join('')}</div></html>`, { waitUntil: 'load' });
      measurements.previewImageBase64 = await contactSheet.screenshot({ type: 'png', encoding: 'base64', fullPage: true });
      await contactSheet.close();
    }
    return measurements;
  } finally {
    if (browser) await browser.close();
  }
}
