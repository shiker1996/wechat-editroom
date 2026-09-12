import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

export async function runBrowserMainlineFlow({ baseUrl, socialCandidateId, factsText = '固定仓库分析 Fixture 工具', diagnosticsDir = null, visualBaselinePath = null }) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  let visualSnapshot = null;
  page.on('console', (message) => { if (message.type() === 'error' && !message.location()?.url?.endsWith('/favicon.ico')) consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => { if (CORE_RESOURCE_TYPES.has(request.resourceType())) failedRequests.push(`${request.method()} ${request.url()} · ${request.failure()?.errorText || 'failed'}`); });
  page.on('response', (response) => { const request = response.request(); if (response.status() >= 500 && CORE_RESOURCE_TYPES.has(request.resourceType())) badResponses.push(`${response.status()} ${request.method()} ${response.url()}`); });
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#view-dashboard.view.active') !== null, { timeout: 30000 });
    await page.evaluate(() => window.go('social-editor'));
    await page.waitForSelector(`[data-social-candidate="${Number(socialCandidateId)}"]`, { visible: true, timeout: 30000 });
    await page.click(`[data-social-candidate="${Number(socialCandidateId)}"]`);
    await page.waitForFunction(() => document.querySelector('#social-editor-fields:not([hidden])') !== null, { timeout: 30000 });
    await page.click('#inspect-repository');
    await page.waitForFunction((expected) => document.querySelector('#repository-facts')?.innerText.includes(expected), { timeout: 30000 }, factsText);
    await page.click('#analyze-card-editorial');
    await page.waitForFunction(() => document.querySelectorAll('#card-plan-preview [data-card-page]').length >= 4 && document.querySelector('#generate-social-card')?.disabled === false, { timeout: 120000 });
    await page.click('#generate-social-card');
    await page.waitForFunction(() => {
      const panel = document.querySelector('#social-delivery');
      const meta = document.querySelector('#social-delivery-meta')?.textContent || '';
      return panel && !panel.hidden && /\d+ 张/.test(meta);
    }, { timeout: 180000 });
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    await delay(100);
    const preview = await page.$('#card-plan-preview');
    assert.ok(preview, '图文故事板预览节点不存在，无法执行视觉回归');
    visualSnapshot = await page.$eval('#card-plan-preview', (node) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const stableText = (value) => normalize(value)
        .replace(/智能构图\s*·.*?(?=编辑戳记|按内容关系|$)/g, '')
        .replace(/编辑戳记\s*·.*?(?=按内容关系|$)/g, '')
        .replace(/\s+/g, ' ').trim();
      const geometry = (element) => {
        const rect = element.getBoundingClientRect();
        return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
      };
      return {
        geometry: geometry(node),
        pages: [...node.querySelectorAll('[data-card-page]')].map((page) => {
          const style = window.getComputedStyle(page);
          const descendantTags = [...page.querySelectorAll('*')].reduce((counts, element) => {
            counts[element.tagName] = (counts[element.tagName] || 0) + 1;
            return counts;
          }, {});
          return {
            role: page.getAttribute('data-role') || page.getAttribute('data-card-page') || '',
            text: stableText(page.innerText),
            descendantTags,
            style: { display: style.display, position: style.position, overflow: style.overflow, backgroundColor: style.backgroundColor },
          };
        }),
      };
    });
    const visualSignature = crypto.createHash('sha256').update(JSON.stringify(visualSnapshot)).digest('hex');
    if (visualBaselinePath) {
      if (process.env.UPDATE_E2E_VISUAL_BASELINE === '1') {
        fs.mkdirSync(path.dirname(visualBaselinePath), { recursive: true });
        fs.writeFileSync(visualBaselinePath, `${visualSignature}\n`);
      } else if (fs.existsSync(visualBaselinePath)) {
        const expected = fs.readFileSync(visualBaselinePath, 'utf8').trim();
        assert.match(expected, /^[a-f0-9]{64}$/, `视觉基线格式无效：${visualBaselinePath}`);
        assert.equal(visualSignature, expected, `图文故事板视觉基线不一致：${visualBaselinePath}`);
      } else {
        throw new Error(`缺少图文故事板视觉基线：${visualBaselinePath}；如确认更新，请设置 UPDATE_E2E_VISUAL_BASELINE=1`);
      }
    }
    assert.deepEqual(consoleErrors, [], `主链路浏览器操作出现控制台错误：${consoleErrors.join(' | ')}`);
    assert.deepEqual(pageErrors, [], `主链路浏览器操作出现页面异常：${pageErrors.join(' | ')}`);
    assert.deepEqual(failedRequests, [], `主链路浏览器操作关键资源加载失败：${failedRequests.join(' | ')}`);
    assert.deepEqual(badResponses, [], `主链路浏览器操作返回服务端错误：${badResponses.join(' | ')}`);
    return { actions: ['打开工具图文', '选择图文候选', '分析仓库', '生成故事板', '生成图文并等待交付'], deliveryMeta: await page.$eval('#social-delivery-meta', (node) => node.textContent.trim()), visualSignature };
  } catch (error) {
    if (diagnosticsDir) {
      try {
        fs.mkdirSync(diagnosticsDir, { recursive: true });
        await page.screenshot({ path: path.join(diagnosticsDir, 'browser-mainline-failure.png'), fullPage: true });
        fs.writeFileSync(path.join(diagnosticsDir, 'browser-mainline-failure.json'), JSON.stringify({ message: error.message, consoleErrors, pageErrors, failedRequests, badResponses, visualSnapshot }, null, 2));
      } catch {}
    }
    throw error;
  } finally {
    await browser.close();
  }
}
