import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CORE_RESOURCE_TYPES = new Set(['document', 'script', 'stylesheet', 'xhr', 'fetch']);

export async function runBrowserSmoke({ baseUrl, routes, diagnosticsDir = null }) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location();
      if (location?.url?.endsWith('/favicon.ico')) return;
      consoleErrors.push(`${message.text()}${location?.url ? ` @ ${location.url}` : ''}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    if (CORE_RESOURCE_TYPES.has(request.resourceType())) failedRequests.push(`${request.method()} ${request.url()} · ${request.failure()?.errorText || 'failed'}`);
  });
  page.on('response', (response) => {
    const request = response.request();
    if (response.status() >= 500 && CORE_RESOURCE_TYPES.has(request.resourceType())) badResponses.push(`${response.status()} ${request.method()} ${response.url()}`);
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#view-dashboard.view.active') !== null, { timeout: 30000 });
    await delay(150);

    const results = [];
    for (const route of routes) {
      await page.evaluate(async (target) => {
        if (typeof window.go !== 'function') throw new Error('工作台路由函数未初始化');
        await window.go(target.route);
      }, route);
      await page.waitForFunction(({ view, selector }) => {
        const section = document.querySelector(`#view-${view}`);
        const element = document.querySelector(selector);
        return Boolean(section?.classList.contains('active') && element && !element.hidden);
      }, { timeout: 30000 }, route);
      await delay(150);
      const snapshot = await page.evaluate(({ view, selector }) => ({
        title: document.querySelector('#page-title')?.textContent?.trim() || '',
        bodyLength: document.body.innerText.trim().length,
        activeView: document.querySelector('.view.active')?.id || '',
        elementTextLength: (document.querySelector(selector)?.value || document.querySelector(selector)?.textContent || document.querySelector(selector)?.getAttribute('aria-label') || '').trim().length,
      }), route);
      assert.equal(snapshot.activeView, `view-${route.view}`, `${route.name} 未激活正确视图`);
      assert.ok(snapshot.bodyLength > 100, `${route.name} 页面疑似空白`);
      assert.ok(snapshot.elementTextLength > 0 || route.allowEmpty, `${route.name} 关键区域没有内容`);
      results.push({ ...route, ...snapshot });
    }

    assert.deepEqual(consoleErrors, [], `浏览器控制台出现错误：${consoleErrors.join(' | ')}`);
    assert.deepEqual(pageErrors, [], `浏览器页面异常：${pageErrors.join(' | ')}`);
    assert.deepEqual(failedRequests, [], `关键资源加载失败：${failedRequests.join(' | ')}`);
    assert.deepEqual(badResponses, [], `关键资源返回服务端错误：${badResponses.join(' | ')}`);
    return results;
  } catch (error) {
    if (diagnosticsDir) {
      try {
        fs.mkdirSync(diagnosticsDir, { recursive: true });
        await page.screenshot({ path: path.join(diagnosticsDir, 'browser-failure.png'), fullPage: true });
        fs.writeFileSync(path.join(diagnosticsDir, 'browser-failure.json'), JSON.stringify({
          message: error.message,
          consoleErrors,
          pageErrors,
          failedRequests,
          badResponses,
        }, null, 2));
      } catch {
        // Preserve the original browser assertion when diagnostics themselves fail.
      }
    }
    throw error;
  } finally {
    await browser.close();
  }
}
