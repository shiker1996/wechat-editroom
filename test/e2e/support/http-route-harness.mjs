import fs from 'node:fs';
import path from 'node:path';
import { handleSocialCardRoutes } from '../../../server/platform/http/routes/social-card-routes.mjs';
import { candidateSocialCardDir } from '../../../server/platform/core/workspace-paths.mjs';
import http from 'node:http';
import { handleCandidateRoutes } from '../../../server/platform/http/routes/candidate-routes.mjs';
import { handleContentRoutes } from '../../../server/platform/http/routes/content-routes.mjs';
import { handleContentFeedbackRoutes } from '../../../server/platform/http/routes/content-feedback-routes.mjs';
import { handleMaterialRoutes } from '../../../server/platform/http/routes/material-routes.mjs';
import { handleTaskRoutes } from '../../../server/platform/http/routes/task-routes.mjs';
import { createMaterialService } from '../../../server/features/materials/index.mjs';

function json(response, status, value) {
  if (response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

// 这是面向阶段 0 的真实 HTTP 边界 harness：使用生产 route handler、Store 和临时数据库，
// 但把模型、任务和未纳入本次 Smoke 的基础设施显式替换为受控依赖。
export function createHttpRouteHarness({ root, store, models = null, aiJobs: providedAiJobs = {} }) {
  if (!store.services.material) {
    store.services = Object.freeze({ ...store.services, material: createMaterialService({ repository: store.repositories.material }) });
  }
  const config = { workspaceRoot: root, llm: { defaultProvider: 'fake' }, aiJobs: { maxConcurrent: 1 } };
  const aiJobs = providedAiJobs;
  const jobs = new Map();
  const socialCardWorkdir = (batch, candidate) => candidateSocialCardDir(root, batch, candidate);
  const socialCardFiles = (batch, candidate) => {
    const dir = socialCardWorkdir(batch, candidate);
    const names = ['fact-sheet.md', 'card-plan.json', 'copy.txt', 'my-design.html', 'layout-report.json', 'delivery-report.json'];
    const files = names.filter((name) => fs.existsSync(path.join(dir, name))).map((name) => ({ name, path: path.join(dir, name) }));
    const output = path.join(dir, 'output');
    if (fs.existsSync(output)) {
      for (const name of fs.readdirSync(output).filter((item) => item.toLowerCase().endsWith('.png')).sort()) {
        files.push({ name: `output/${name}`, path: path.join(output, name) });
      }
    }
    return { dir, files };
  };
  const isInsideRoots = (file, roots) => {
    const resolved = path.resolve(file);
    return roots.some((rootPath) => {
      const rootResolved = path.resolve(rootPath);
      return resolved === rootResolved || resolved.startsWith(`${rootResolved}${path.sep}`);
    });
  };
  const contextFor = (request, response, url) => ({
    request,
    response,
    pathname: url.pathname,
    searchParams: url.searchParams,
    store,
    artifactRoots: [root],
    mime: {},
    path,
    fs,
    root,
    config,
    models,
    aiJobs,
    jobs,
    body: () => readBody(request),
    json,
    batchWorkdir: () => root,
    articleWorkdir: () => root,
    socialCardWorkdir,
    socialCardFiles,
    isInsideRoots,
    batchMaxAgeHours: () => 72,
    writeUtf8: async (filePath, content) => fs.writeFileSync(filePath, content, 'utf8'),
    localSecurity: null,
    candidateRepositoryUrl: () => null,
    candidateEventGroups: () => [],
    attachEventConclusions: (items) => items,
    evaluateCustomCardGate: () => ({ pass: true }),
  });

  return http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    try {
      const context = contextFor(request, response, url);
      let handled = await handleMaterialRoutes(context);
      if (!handled) handled = await handleContentFeedbackRoutes(context);
      if (!handled) handled = await handleContentRoutes(context);
      if (!handled) handled = await handleSocialCardRoutes(context);
      if (!handled) handled = await handleCandidateRoutes(context);
      if (!handled) handled = await handleTaskRoutes(context);
      if (!handled && !response.writableEnded) json(response, 404, { error: 'Not found' });
    } catch (error) {
      if (!response.writableEnded) json(response, 500, { error: error.message });
    }
  });
}

export async function listenHarness(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

export async function closeHarness(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export async function requestJson(baseUrl, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { response, data };
}
