import puppeteer from 'puppeteer';

/** Render a trusted HTML document in Chromium and report element box metrics. */
export async function probeHtmlLayout({ html, width = 375, height = 667, pageSelector = 'body', selectors = [], selectedPage = null } = {}) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: Number(width) || 375, height: Number(height) || 667, deviceScaleFactor: 1 });
    await page.setContent(String(html || ''), { waitUntil: 'networkidle0' });
    await page.evaluateHandle(() => document.fonts.ready);

    return await page.evaluate(({ pageSelector, selectors, selectedPage }) => {
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
            role: pageElement.dataset.pageRole || (pageElement.classList.contains('page-cover') ? 'cover' : pageElement.classList.contains('page-ending') ? 'ending' : ''),
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
  } finally {
    if (browser) await browser.close();
  }
}
