import http from 'node:http';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let value = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { value += chunk; });
    request.on('end', () => {
      try { resolve(JSON.parse(value || '{}')); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, payload, status = 200) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(body);
}

function articleMarkdown() {
  const paragraph = '这是一段来自固定测试模型的文章正文。它只验证采集、事实、规划、写作、审查、搜索优化和发布安全门禁能够依次完成，不代表真实项目效果，也不替代人工核验来源。';
  return `# E2E 主链路：固定事实如何变成可核验内容\n\n${Array.from({ length: 10 }, (_, index) => `## 第 ${index + 1} 节：验证一条完整内容链路\n\n${paragraph}${paragraph}`).join('\n\n')}\n`;
}

function userContent(payload) {
  return [...(payload.messages || [])].reverse().find((item) => item?.role === 'user')?.content || '';
}

function parseEmbeddedJson(content) {
  const text = String(content || '');
  try { return JSON.parse(text.trim()); } catch {}
  for (const marker of ['\n\n{', '\n\n[', '【候选】\n']) {
    const index = text.lastIndexOf(marker);
    if (index < 0) continue;
    try { return JSON.parse(text.slice(index + (marker === '【候选】\n' ? marker.length : 2))); } catch {}
  }
  return null;
}

function hotspotTaggingJson(payload) {
  const input = parseEmbeddedJson(userContent(payload));
  const items = Array.isArray(input) ? input : [];
  return { items: items.map((item) => {
    const project = /^https:\/\/github\.com\//i.test(String(item.url || ''));
    const who = project ? 'E2E 开源项目' : 'E2E 固定来源';
    const what = project ? '工具发布' : '文章发布';
    return {
      id: item.id,
      eventKey: `${who}|${what}`,
      eventParts: { who, what, where: '固定测试', when: item.publishedAt || '2026-09-12', actionType: project ? '开源' : '发布', object: item.title, occasion: '主链路回归' },
      keywords: project ? ['开源工具', 'E2E'] : ['固定来源', 'E2E'],
      preScores: { conflict: 12, audience: 16, informationGain: 14, emotion: 8, timeliness: 10, impact: 8, sourceReliability: 8 },
      riskLevel: '低', riskReason: '固定测试夹具', credibleScoop: 0, saturationPenalty: 0, duplicatePenalty: 0,
    };
  }) };
}

function eventCardJson(payload) {
  const input = parseEmbeddedJson(userContent(payload));
  const events = Array.isArray(input) ? input : [];
  return { items: events.map((event) => {
    const project = JSON.stringify(event).includes('github.com/example/e2e-tool');
    return {
      event_id: event.event_id,
      conclusion: project ? '固定仓库条目可进入图文验证链路。' : '固定来源条目可进入文章验证链路。',
      background: '这是仅用于自动化回归的固定事件卡。',
      confirmed_facts: ['固定 RSS 返回了该条目。'],
      source_increment: [], disagreements: [], timeline: [{ time: '2026-09-12', fact: '固定采集任务返回该条目。' }],
      unverified: [], angles: ['验证采集结果是否继续驱动下游产物'],
      classification: project
        ? { content_class: 'github_project', confidence: 0.99, status: 'classified', reason: 'URL 指向 GitHub 项目', evidence: ['github URL'], article_eligible: false, social_eligible: true, default_route: 'social_cards' }
        : { content_class: 'news_event', confidence: 0.99, status: 'classified', reason: '固定 RSS 文章条目', evidence: ['RSS URL'], article_eligible: true, social_eligible: false, default_route: 'article' },
    };
  }) };
}

function discussionInput(payload) {
  return parseEmbeddedJson(userContent(payload)) || {};
}

function discussionReport(payload) {
  const input = discussionInput(payload);
  const event = input.event || {};
  const sourceUrl = event.sources?.[0]?.url || event.url || 'https://example.com/e2e/article';
  return `# 事件研判报告

## 事件内研判

### 反常
- 结论：固定采集结果可以稳定进入后续内容流程；可写角度：验证采集到产物的完整链路。

### 利益冲突
- 结论：改动后的功能正确性与测试执行成本之间需要保持平衡；可写角度：用固定夹具降低回归风险。

### 可发散方向
- 方向：把任务状态、来源和最终文件一起作为自动化验收证据；观点种子：功能测试必须检查可交付结果。

## 事件外研判

固定测试只输出事件内研判，不对其他事件作事实判断。

## 来源

- [S1](${sourceUrl}) 摘要：固定 RSS 返回的主链路测试资料。`;
}

function discussionJson(payload) {
  const input = discussionInput(payload);
  const event = input.event || input.events?.[0] || {};
  const eventId = event.event_id || input.events?.[0]?.event_id || '';
  const eventIds = (input.events || []).map((item) => item.event_id).filter(Boolean);
  const sourceId = event.sources?.[0]?.source_id || '';
  const signal = { statement: '固定采集结果具备可追踪的下游验证价值。', question: '采集结果是否真正进入最终产物？', source_ids: sourceId ? [sourceId] : [], writing_angles: ['验证采集到产物的完整链路'], thesis_seeds: ['自动化测试应检查最终交付结果。'] };
  if (String(input.phase || '').includes('topic_generation')) return {
    topic_candidates: [{ candidate_title: '从固定采集到最终产物：如何验证主链路没有断', event_ids: eventIds.length ? [eventIds[0]] : [eventId], core_question: '改动后如何确认采集结果仍然进入最终内容产物？', angle: '用可复现夹具验证真实业务链路', thesis_seed: '端到端测试必须沿着真实数据流检查最终交付。', research_status: 'needs_review', evidence_source_ids: sourceId ? [sourceId] : [] }],
    event_coverage: eventIds.map((id) => ({ event_id: id, status: id === eventIds[0] ? 'covered' : 'uncovered', reason: id === eventIds[0] ? '' : '固定测试只选择文章事件' })),
  };
  return { items: [{ event_id: eventId, anomalies: [signal], interest_conflicts: [], divergence_directions: [signal] }], relations: [], topic_candidates: [] };
}

function brainstormJson(payload) {
  const text = userContent(payload);
  const candidateId = text.match(/"candidateId":"(C\d+)"/)?.[1] || 'C001';
  return { items: [{ candidateId, status: 'PASS', angle: '验证采集结果是否完整进入文章产物', thesis: '稳定的固定夹具可以让主链路回归测试可重复。', hypotheses: [{ claim: '采集结果能够驱动最终产物', support: '真实 HTTP 采集和产物断言', counter: '上游失败时任务应失败', verify: '检查任务状态和最终文件', readerValue: '降低改动后的回归风险' }], packaging: { contentPillar: '工程实践', readerJob: '确认改动没有破坏主链路', mode: '搜索型', distributionLane: '实验池', readerStake: '开发者可以复跑同一条验证路径', readerStakeScore: 5, readerTarget: '维护内容流水线的开发者', readerAction: '在合并前运行 E2E', readerConsequence: '避免产物缺失', readerStakeEvidence: '固定测试输出', practicalIncrement: '固定输入、可复算输出、失败可追踪', materialGaps: '' }, bScores: { angleUniqueness: 4, emotionSpread: 3, titleHook: 4, readerStakeScore: 5, factSupport: 5 }, hProfile: { historicalType: 'technology', fiveSenseCount: 2, fiveQuestionCount: 4, recommendationFit: 5, emotionTheme: 2, searchFriendly: 4 }, evidenceBoundary: '仅代表固定夹具下的流程验证。' }] };
}

function synthesisJson(payload) {
  const candidateId = userContent(payload).match(/"candidateId":"(C\d+)"/)?.[1] || 'C001';
  return { items: [{ candidateId, saturationPenalty: 0, duplicatePenalty: 0, readerStakeScore: 5, reason: '固定测试候选具备明确验证价值。' }] };
}

function jsonForRequest(payload) {
  const text = JSON.stringify(payload.messages || []);
  if (/hotspot-tagging|语义打标|preScores|eventParts/i.test(text)) return hotspotTaggingJson(payload);
  if (/event-card|事件事实卡|classification_features/i.test(text)) return eventCardJson(payload);
  if (/脑暴输入规则|hotspot-brainstorm-explore/i.test(text)) return brainstormJson(payload);
  if (/hotspot-synthesis-provisional|综合复排/i.test(text)) return synthesisJson(payload);
  if (/topic_generation|候选选题|研判素材|research_digest/i.test(text)) return discussionJson(payload);
  if (/discussion-research|事件研判报告|事件内研判/i.test(text)) return discussionJson(payload);
  if (/social-card-editorial|repository-card-storyboard|tool-cards|图文故事板/i.test(text)) return {
    target_reader: '需要核验内容链路的开发者', pain_point: '改动后无法确认产物是否完整', tool_positioning: '固定测试工具',
    must_highlight: '固定输入、可复算输出和失败可追踪', must_disclose: '内容基于固定测试资料，未实际运行第三方项目',
    getting_started: 'npm test', forbidden_claims: '不得声称真实用户收益', recommended_pages: 4,
    card_plan: [{ role: 'cover', kind: 'cover', title: 'E2E 主链路测试', lead: '固定输入与可追踪输出' }, { role: 'concept', kind: 'content', title: '为什么需要', content_blocks: [{ type: 'text', title: '问题', content: '每次改动都需要确认采集、文章和图文产物仍能闭环。' }] }, { role: 'steps', kind: 'content', title: '验证步骤', content_blocks: [{ type: 'list', title: '步骤', items: ['启动固定采集源', '等待任务完成', '检查最终产物'] }] }, { role: 'ending', kind: 'ending', title: '完成标准', content_blocks: [{ type: 'text', title: '边界', content: '测试输出只代表固定夹具下的流程完整。' }] }],
  };
  if (/fact-base|事实基座|事实抽取/i.test(text)) return {
    claims: [{ id: 'fixture-claim-1', claim: '固定资料展示了一条可核验的测试事实。', status: 'verified', sourceUrl: 'https://example.com/e2e-source', sourceTitle: 'E2E 固定来源', sourceType: 'fixture', evidence: '固定夹具正文' }],
    confirmedFacts: ['固定资料展示了一条可核验的测试事实。'], missingEvidence: [],
  };
  if (/visual-plan|图表|可视化/i.test(text)) return { summary: '固定测试不生成图表', placements: [], rejections: [] };
  if (/image-plan|配图|图片规划/i.test(text)) return { placements: [] };
  if (/planning|大纲|规划/i.test(text)) return {
    selectedTitle: 'E2E 主链路：固定事实如何变成可核验内容',
    titleCandidates: ['E2E 主链路：固定事实如何变成可核验内容'], coreKeywords: [],
    outlineMarkdown: '## 背景\n\n## 验证步骤\n\n## 完成标准', contentRole: 'analysis',
    expectedAction: ['核对固定来源'], practicalIncrement: '固定输入、可复算输出、失败可追踪', materialsMarkdown: '固定测试资料。',
  };
  if (/cover-title|封面标题/i.test(text)) return { lines: ['E2E 主链路测试', '固定输入与可追踪输出'] };
  if (/content-planner|内容规划/i.test(text)) return { operations: [] };
  return {
    claims: [{ id: 'fixture-claim-1', claim: '固定资料展示了一条可核验的测试事实。', status: 'verified', sourceUrl: 'https://example.com/e2e-source', sourceTitle: 'E2E 固定来源', sourceType: 'fixture', evidence: '固定夹具正文' }],
    confirmedFacts: ['固定资料展示了一条可核验的测试事实。'], missingEvidence: [],
    selectedTitle: 'E2E 主链路：固定事实如何变成可核验内容', titleCandidates: ['E2E 主链路：固定事实如何变成可核验内容'], coreKeywords: [],
    outlineMarkdown: '## 背景\n\n## 验证步骤\n\n## 完成标准', contentRole: 'analysis', expectedAction: ['核对固定来源'], practicalIncrement: '固定输入、可复算输出、失败可追踪', materialsMarkdown: '固定测试资料。',
    summary: '固定测试输出', placements: [], rejections: [], operations: [], lines: ['E2E 主链路测试'],
  };
}

function toolResponse(toolName) {
  if (/title_plan/i.test(toolName)) return { selectedTitle: 'E2E 主链路：固定事实如何变成可核验内容', titleCandidates: ['E2E 主链路：固定事实如何变成可核验内容'], coreKeywords: [] };
  if (/research_coverage/i.test(toolName)) return { status: 'pass', pass: true, issues: [], missing: [] };
  return { pass: true, issues: [], missing: [], status: 'pass', reason: '固定测试门禁通过' };
}

function replayIdForRequest(payload) {
  const text = JSON.stringify(payload.messages || []);
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  const toolName = tools[0]?.function?.name || '';
  if (toolName) return `tool:${toolName}`;
  if (/hotspot-tagging|语义打标|preScores|eventParts/i.test(text)) return 'hotspot-tagging';
  if (/event-card|事件事实卡|classification_features/i.test(text)) return 'event-card';
  if (/脑暴输入规则|hotspot-brainstorm-explore/i.test(text)) return 'hotspot-brainstorm';
  if (/hotspot-synthesis-provisional|综合复排/i.test(text)) return 'hotspot-synthesis';
  if (/discussion-research|事件研判报告|事件内研判/i.test(text)) return payload.response_format ? 'discussion-research-json' : 'discussion-research-report';
  if (!payload.response_format && /social-card|social cards|hashtag|话题标签|小红书|公众号图文文案/i.test(text)) return 'social-card-copy';
  if (!payload.response_format) return 'article-markdown';
  if (/social-card-editorial|repository-card-storyboard|tool-cards|图文故事板/i.test(text)) return 'social-card-editorial';
  if (/fact-base|事实基座|事实抽取/i.test(text)) return 'fact-base';
  if (/visual-plan|图表|可视化/i.test(text)) return 'visual-plan';
  if (/image-plan|配图|图片规划/i.test(text)) return 'image-plan';
  if (/planning|大纲|规划/i.test(text)) return 'article-planning';
  if (/cover-title|封面标题/i.test(text)) return 'cover-title';
  if (/content-planner|内容规划/i.test(text)) return 'content-planner';
  return 'structured-default';
}

export async function startFakeRssHub({ status = 200, routeStatus = status } = {}) {
  const published = new Date('2026-09-12T00:00:00.000Z').toUTCString();
  const requests = [];
  const articleSummary = '固定来源文章正文，用于验证采集结果能进入文章链路。'.repeat(36);
  const repositorySummary = '固定来源仓库资料，用于验证采集结果能进入图文链路。'.repeat(12);
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>E2E 固定 RSSHub</title>
    <item><guid>e2e-article</guid><title>E2E 文章采集样本</title><link>https://example.com/e2e/article</link><pubDate>${published}</pubDate><description>${articleSummary}</description></item>
    <item><guid>e2e-repository</guid><title>E2E 图文工具样本</title><link>https://github.com/example/e2e-tool</link><pubDate>${published}</pubDate><description>${repositorySummary}</description></item>
  </channel></rss>`;
  const server = http.createServer((request, response) => {
    requests.push(request.url || '');
    if (request.url === '/' || request.url?.startsWith('/e2e/news')) {
      const responseStatus = request.url === '/' ? status : routeStatus;
      response.writeHead(responseStatus, { 'content-type': 'application/rss+xml; charset=utf-8' });
      response.end(responseStatus === 200 ? (request.url === '/' ? 'ok' : xml) : 'fixture rss failure');
      return;
    }
    response.writeHead(404); response.end();
  });
  const port = await listen(server);
  return { baseUrl: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

export async function startFakeModel({ mode = 'normal' } = {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404); response.end(); return; }
    const payload = await readJson(request);
    if (mode === 'http-error') {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { message: 'fixture model failure' } }));
      return;
    }
    requests.push({
      replayId: replayIdForRequest(payload),
      json: Boolean(payload.response_format),
      tools: (payload.tools || []).map((item) => item.function?.name),
      messages: (payload.messages || []).map((item) => String(item.content || '').slice(-160)),
    });
    const tools = Array.isArray(payload.tools) ? payload.tools : [];
    const toolName = tools[0]?.function?.name || '';
    const message = mode === 'invalid-json' && payload.response_format
      ? { role: 'assistant', content: '{invalid fixture json' }
      : toolName
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'fixture-call-1', type: 'function', function: { name: toolName, arguments: JSON.stringify(toolResponse(toolName)) } }] }
      : { role: 'assistant', content: payload.response_format ? JSON.stringify(jsonForRequest(payload)) : /social-card|social cards|hashtag|话题标签|小红书|公众号图文文案/i.test(JSON.stringify(payload.messages || [])) ? '固定测试图文文案。\n\n#E2E测试 #固定夹具 #主链路验证 #可追踪输出 #功能回归' : articleMarkdown() };
    if (payload.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
      const delta = toolName ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call-1', type: 'function', function: { name: toolName, arguments: JSON.stringify(toolResponse(toolName)) } }] } : { role: 'assistant', content: message.content };
      response.write(`data: ${JSON.stringify({ id: 'fixture-stream', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'fixture-stream', choices: [{ index: 0, delta: {}, finish_reason: toolName ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
      response.end('data: [DONE]\n\n');
      return;
    }
    sendJson(response, { id: 'fixture-response', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: toolName ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  const port = await listen(server);
  return { baseUrl: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}
