import puppeteer from 'puppeteer';

/** Render a trusted HTML document in Chromium and report element box metrics. */
export async function probeHtmlLayout({ html, width = 375, height = 667, pageSelector = 'body', selectors = [], selectedPage = null, includeContactSheet = false, includeDesignMetrics = false } = {}) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: Number(width) || 375, height: Number(height) || 667, deviceScaleFactor: 1 });
    await page.setContent(String(html || ''), { waitUntil: 'networkidle0' });
    await page.evaluateHandle(() => document.fonts.ready);

    const measurements = await page.evaluate(({ pageSelector, selectors, selectedPage, includeDesignMetrics }) => {
      const pages = [...document.querySelectorAll(pageSelector)];
      return pages.map((pageElement, pageIndex) => {
        const pageRect = pageElement.getBoundingClientRect();
        const textRuns = [];
        const contentTextRuns = [];
        const contentStackElement = pageElement.querySelector('.page-content-stack');
        const walker = document.createTreeWalker(pageElement, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const textNode = walker.currentNode;
          const text = String(textNode.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text || textNode.parentElement?.closest('[data-ornament],[aria-hidden="true"],script,style')) continue;
          let hidden = false;
          for (let element = textNode.parentElement; element && element !== pageElement; element = element.parentElement) {
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) { hidden = true; break; }
          }
          if (hidden) continue;
          const range = document.createRange();
          range.selectNodeContents(textNode);
          for (const rect of range.getClientRects()) {
            if (rect.width > 0 && rect.height > 0) {
              const textRun = {
                text: text.slice(0, 90),
                rect: { x: rect.x - pageRect.x, y: rect.y - pageRect.y, width: rect.width, height: rect.height },
              };
              textRuns.push(textRun);
              if (contentStackElement?.contains(textNode.parentElement)) contentTextRuns.push(textRun);
            }
          }
          range.detach?.();
        }
        return ({
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
            coverLayout: pageElement.dataset.coverLayout || '',
            sharedAnchorIds: [...pageElement.querySelectorAll('[data-shared-anchor]')].filter((element) => {
              const anchorStyle = getComputedStyle(element);
              const anchorRect = element.getBoundingClientRect();
              return anchorStyle.display !== 'none' && anchorStyle.visibility !== 'hidden' && Number(anchorStyle.opacity) > 0 && anchorRect.width > 0 && anchorRect.height > 0;
            }).map((element) => element.dataset.sharedAnchor || '').filter(Boolean),
            ornaments: [...pageElement.querySelectorAll('[data-ornament]')].map((element) => {
              const ornamentStyle = getComputedStyle(element);
              const ornamentRect = element.getBoundingClientRect();
              const left = Math.max(rect.left, ornamentRect.left);
              const top = Math.max(rect.top, ornamentRect.top);
              const right = Math.min(rect.right, ornamentRect.right);
              const bottom = Math.min(rect.bottom, ornamentRect.bottom);
              const hasOpaqueColor = (color) => color !== 'transparent' && !/^rgba\([^)]*,\s*0(?:\.0+)?\)$/i.test(color);
              const hasVisibleBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) => Number.parseFloat(ornamentStyle[`border${side}Width`]) > 0
                && ornamentStyle[`border${side}Style`] !== 'none'
                && hasOpaqueColor(ornamentStyle[`border${side}Color`]));
              const hasVisualTreatment = hasVisibleBorder
                || hasOpaqueColor(ornamentStyle.backgroundColor)
                || ornamentStyle.backgroundImage !== 'none'
                || ornamentStyle.boxShadow !== 'none'
                || Boolean((element.innerText || element.textContent || '').trim() && hasOpaqueColor(ornamentStyle.color));
              const clippedWidth = right - left;
              const clippedHeight = bottom - top;
              // Rails and rules are intentionally narrow in one dimension; requiring
              // 6px on both axes incorrectly marks visible line ornaments as missing.
              const visibleLinearOrnament = Math.min(clippedWidth, clippedHeight) >= 2
                && Math.max(clippedWidth, clippedHeight) >= 24;
              const visibleBlockOrnament = clippedWidth >= 6 && clippedHeight >= 6;
              const visible = ornamentStyle.display !== 'none'
                && ornamentStyle.visibility !== 'hidden'
                && Number(ornamentStyle.opacity) > 0
                && hasVisualTreatment
                && (visibleBlockOrnament || visibleLinearOrnament);
              const relativeRect = { x: ornamentRect.x - rect.x, y: ornamentRect.y - rect.y, width: ornamentRect.width, height: ornamentRect.height };
              const borderWidth = Math.max(0, ...['Top', 'Right', 'Bottom', 'Left'].map((side) => Number.parseFloat(ornamentStyle[`border${side}Width`]) || 0));
              const frameLike = element.dataset.ornament === 'frame';
              const textOverlaps = visible ? textRuns.filter((run) => {
                const regions = frameLike && borderWidth > 0
                  ? [
                    { x: relativeRect.x, y: relativeRect.y, width: relativeRect.width, height: borderWidth + 2 },
                    { x: relativeRect.x, y: relativeRect.y + relativeRect.height - borderWidth - 2, width: relativeRect.width, height: borderWidth + 2 },
                    { x: relativeRect.x, y: relativeRect.y, width: borderWidth + 2, height: relativeRect.height },
                    { x: relativeRect.x + relativeRect.width - borderWidth - 2, y: relativeRect.y, width: borderWidth + 2, height: relativeRect.height },
                  ]
                  : [relativeRect];
                return regions.some((region) => Math.min(region.x + region.width, run.rect.x + run.rect.width) - Math.max(region.x, run.rect.x) > 1
                  && Math.min(region.y + region.height, run.rect.y + run.rect.height) - Math.max(region.y, run.rect.y) > 1);
              }).map((run) => run) : [];
              return {
                kind: element.dataset.ornament || '',
                placement: element.dataset.ornamentPlacement || '',
                visible,
                hasVisualTreatment,
                rect: relativeRect,
                textOverlaps,
              };
            }),
            contentAlignment: (() => {
              const body = pageElement.querySelector('.page-body');
              const bodyRect = body?.getBoundingClientRect();
              if (!bodyRect || !contentTextRuns.length) return null;
              const bodyStyle = getComputedStyle(body);
              const availableTop = bodyRect.top + (Number.parseFloat(bodyStyle.paddingTop) || 0) - rect.top;
              const availableBottom = bodyRect.bottom - (Number.parseFloat(bodyStyle.paddingBottom) || 0) - rect.top;
              const contentTop = Math.min(...contentTextRuns.map((run) => run.rect.y));
              const contentBottom = Math.max(...contentTextRuns.map((run) => run.rect.y + run.rect.height));
              const bodyCenterY = (availableTop + availableBottom) / 2;
              const contentCenterY = (contentTop + contentBottom) / 2;
              return {
                verticalCenterOffsetPx: Number((contentCenterY - bodyCenterY).toFixed(1)),
                bodyCenterY: Number(bodyCenterY.toFixed(1)),
                contentCenterY: Number(contentCenterY.toFixed(1)),
                contentBounds: { top: Number(contentTop.toFixed(1)), bottom: Number(contentBottom.toFixed(1)) },
              };
            })(),
            listItemCount: Number(pageElement.dataset.listItemCount) || 0,
            innerDisplay: innerStyle?.display || null,
            innerHeight: inner?.getBoundingClientRect().height ?? null,
          };
        })(),
        coverComponents: [...pageElement.querySelectorAll('[data-cover-component]')].map((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            component: element.dataset.coverComponent || '',
            colorRole: element.dataset.coverColorRole || '',
            text: element.innerText || element.textContent || '',
            color: style.color,
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            borderColor: style.borderColor,
            fontSize: Number.parseFloat(style.fontSize) || 0,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        }),
        designMetrics: includeDesignMetrics ? (() => {
          const styleRecord = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0 || rect.width <= 0 || rect.height <= 0) return null;
            return {
              tag: element.tagName.toLowerCase(),
              color: style.color,
              backgroundColor: style.backgroundColor,
              borderColor: style.borderColor,
              fontSize: Number.parseFloat(style.fontSize) || 0,
              lineHeight: Number.parseFloat(style.lineHeight) || 0,
              marginTop: Number.parseFloat(style.marginTop) || 0,
              marginBottom: Number.parseFloat(style.marginBottom) || 0,
              borderRadius: Number.parseFloat(style.borderRadius) || 0,
            };
          };
          const collect = (selector) => [...pageElement.querySelectorAll(selector)].map(styleRecord).filter(Boolean);
          return {
            elements: [...pageElement.querySelectorAll('*')].map(styleRecord).filter(Boolean),
            paragraphs: collect('p'),
            headings: collect('h1,h2,h3,h4'),
            sectionHeadings: collect('h2,h3'),
            images: collect('img'),
            captions: collect('figcaption,[data-caption],small'),
          };
        })() : null,
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
      });
      }).filter((item) => !selectedPage || item.page === selectedPage);
    }, { pageSelector, selectors, selectedPage: Number(selectedPage) || null, includeDesignMetrics });

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
