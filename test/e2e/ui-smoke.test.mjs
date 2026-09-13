import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function startUiServer(t) {
  const capturedMaterials = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/models") return json(response, 200, []);
      if (url.pathname === "/api/overview") return json(response, 200, {
        current: { sourceTotal: 0, sourceOk: 0, pendingArticleCandidates: 0, blockedBriefs: 0, failedRuns: 0 },
        latest: null,
        sourceHealth: [],
        efficiency: {},
        efficiencyBaseline: {},
        articleInProgress: 0,
        socialInProgress: 0,
        hotspots: 0,
        artifacts: 0,
      });
      if (url.pathname === "/api/batches") return json(response, 200, []);
      if (url.pathname === "/api/jobs") return json(response, 200, []);
      if (url.pathname === "/api/content-columns") return json(response, 200, []);
      if (url.pathname === "/api/writing-materials") {
        if (request.method === "POST") {
          const payload = JSON.parse(await readBody(request));
          capturedMaterials.push(payload);
          return json(response, 201, { id: capturedMaterials.length, ...payload });
        }
        return json(response, 200, capturedMaterials);
      }
      if (url.pathname === "/api/security/session") return json(response, 200, { csrfToken: "ui-smoke-token" });
      return json(response, 200, {});
    }

    const relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.resolve(publicRoot, `.${relativePath}`);
    if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
      response.writeHead(403); response.end("Forbidden"); return;
    }
    try {
      const body = fs.readFileSync(filePath);
      response.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404); response.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, capturedMaterials };
}

test("浏览器 UI Smoke：首屏可进入素材入箱并快速保存素材", async (t) => {
  const { url, capturedMaterials } = await startUiServer(t);
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(5000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  // 工作台启动后会按固定间隔轮询任务状态，因此不能用 networkidle0 作为首屏完成条件。
  await page.goto(`${url}/#dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("page-title")?.textContent === "工作台总览");

  await page.click('summary[title="文章生产"]');
  await page.click('[data-view="material-inbox"]');
  try {
    await page.waitForSelector("#material-list .empty-state");
  } catch (error) {
    const state = await page.evaluate(() => ({
      title: document.getElementById("page-title")?.textContent,
      hash: location.hash,
      active: document.getElementById("view-material-inbox")?.className,
      materialList: document.getElementById("material-list")?.innerHTML,
      go: typeof window.go,
      readyState: document.readyState,
    }));
    error.message += `; browser state: ${JSON.stringify(state)}; page errors: ${pageErrors.map((item) => item.message).join(" | ")}`;
    throw error;
  }
  assert.equal(await page.$eval("#page-title", (node) => node.textContent), "素材入箱");
  assert.equal(await page.$eval('[data-view="material-inbox"]', (node) => node.classList.contains("active")), true);
  await page.waitForFunction(() => document.getElementById("view-material-inbox")?.classList.contains("active"));

  await page.click('summary[aria-label="更多操作"]');
  await page.click("#quick-material-button");
  assert.equal(await page.$eval("#quick-material-dialog", (dialog) => dialog.open), true);
  await page.type('#quick-material-form [name="title"]', "UI Smoke 素材");
  await page.type('#quick-material-form [name="rawText"]', "验证从工作台进入素材入箱并保存真实片段。");
  await page.click('#quick-material-form button[type="submit"]');
  try {
    await page.waitForFunction(() => !document.getElementById("quick-material-dialog")?.open);
  } catch (error) {
    error.message += `; quick state: ${JSON.stringify(await page.evaluate(() => ({ open: document.getElementById("quick-material-dialog")?.open, submitDisabled: document.querySelector("#quick-material-form button[type=submit]")?.disabled })))}; captured: ${JSON.stringify(capturedMaterials)}; page errors: ${pageErrors.map((item) => item.message).join(" | ")}`;
    throw error;
  }
  await page.waitForSelector("#material-list .material-card");

  assert.deepEqual(capturedMaterials, [{
    sourceType: "conversation",
    capturedAt: new Date().toISOString().slice(0, 10),
    title: "UI Smoke 素材",
    rawText: "验证从工作台进入素材入箱并保存真实片段。",
    tags: [],
  }]);
  assert.deepEqual(pageErrors, []);
});
