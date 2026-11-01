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
