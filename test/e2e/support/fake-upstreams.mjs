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

function sendGitHubJson(response, payload, status = 200) {
  sendJson(response, payload, status);
}

function articleMarkdown() {
  const paragraph = '这是一段来自固定测试模型的文章正文。它只验证采集、事实、规划、写作、审查、搜索优化和发布安全门禁能够依次完成，不代表真实项目效果，也不替代人工核验来源。';
  return `# E2E 文章采集样本：固定事实如何进入最终内容\n\n${Array.from({ length: 10 }, (_, index) => `## 第 ${index + 1} 节：验证一条完整内容链路\n\n${paragraph}${paragraph}`).join('\n\n')}\n`;
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
      category: project ? '开源项目与开发者生态' : '产品与技术动态',
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
    topic_candidates: [{ candidate_title: '从固定采集到最终产物：如何验证主链路没有断', event_ids: eventIds.length ? [eventIds[0]] : [eventId], core_question: '改动后如何确认采集结果仍然进入最终内容产物？', angle: '用可复现夹具验证真实业务链路', thesis_seed: '端到端测试必须沿着真实数据流检查最终交付。', research_status: 'needs_review', evidence_source_ids: sourceId ? [sourceId] : [], target_reader: '维护内容流水线的开发者', click_reason: '想确认采集结果是否真的进入最终文章', title_hook: '采集到了，为什么文章候选却没出现？', reader_payoff: '可以沿这条固定链路快速定位交付断点', reader_entry_score: 16 }],
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

function aiVisualAgentJson(payload, state) {
  const requestId = `tr_fixture_${(payload.messages || []).length}`;
  const request = (capability, args, reason) => ({
    type: 'tool_requests',
    assistant_note: '执行固定 E2E 的 AI 视觉生成步骤',
    requests: [{ requestId, capability, arguments: args, reason }],
  });
  // Keep explicit fixture state: chat history may be compacted between tool
  // turns, so inferring the recovery phase from assistant messages is brittle.
  switch (state.phase) {
    case 'start':
      state.phase = 'written-invalid';
      return fixtureVisualAppend(request);
    case 'written-invalid':
      state.phase = 'audited-invalid';
      return request('cap_social_card_visual_audit', { auditAttempt: 1 }, '检查固定视觉页面的纵向容量');
    case 'audited-invalid':
      state.phase = 'aborted';
      return request('cap_filesystem_project_document_write', { operation: 'abort' }, '中止未通过视觉审计的文档');
    case 'aborted':
      state.phase = 'rewritten';
      return fixtureVisualAppend(request, { includePageInner: true });
    case 'rewritten':
      state.phase = 'audited-valid';
      return request('cap_social_card_visual_audit', { auditAttempt: 2 }, '复审重写后的固定视觉页面');
    case 'audited-valid':
      state.phase = 'finished';
      return request('cap_filesystem_project_document_write', { operation: 'finish' }, '完成通过复审的视觉 HTML 写入');
    default:
      return { type: 'final', assistantReply: '已完成 AI 视觉 HTML 生成' };
  }
}

function fixtureVisualAppend(request, { includePageInner = false } = {}) {
  const pages = [
    ['page-cover', 'E2E 主链路测试', '固定输入与可追踪输出'],
    ['page-content', '为什么需要', '每次改动都应确认采集、文章与图文产物保持连通。'],
    ['page-content', '验证步骤', '使用固定来源检查事实、故事板和最终页面。'],
    ['page-ending', '完成标准', '页面结构完整，事实边界清晰，交付可以复核。'],
  ];
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#102018;color:#f4f0e5;font-family:Arial,"Microsoft YaHei",sans-serif}.page{position:relative;width:375px;height:667px;overflow:hidden;padding:28px;background:#102018;display:flex;flex-direction:column;gap:20px}.page-cover{background:linear-gradient(145deg,#102018,#1a2b23)}.page-inner{display:flex;flex:1;min-height:0;flex-direction:column;gap:20px;overflow:hidden}.page-body{height:520px;min-height:0;overflow:hidden}.page-content-stack{height:100%;overflow:hidden;display:flex;flex-direction:column;gap:18px}.eyebrow{color:#39c98a;font-size:12px;letter-spacing:.16em}.page h1{font-size:34px;line-height:1.2;margin:0}.page h2{font-size:25px;line-height:1.25;margin:0}.page p{font-size:14px;line-height:1.55;margin:0;color:#f4f0e5}.bottom-strip{margin-top:auto;border-top:1px solid #496052;padding-top:12px;color:#b0c0b5;font-size:12px}
</style></head><body>${pages.map(([kind,title,body],index)=>{
    const eyebrow = `<div class="eyebrow">${String(index+1).padStart(2,'0')} · E2E FIXTURE</div>`;
    const pageBody = `<div class="page-body"><div class="page-content-stack"><h${index===0?'1':'2'}>${title}</h${index===0?'1':'2'}><p>${body}</p></div></div>`;
    const footer = `<footer class="bottom-strip">固定测试 · ${index+1} / ${pages.length}</footer>`;
    return `<!-- CARD-PAGE:${index + 1}:START -->\n<section class="page ${kind}" data-page="${index + 1}">${includePageInner ? `<div class="page-inner">${eyebrow}${pageBody}${footer}</div>` : `${eyebrow}${pageBody}${footer}`}</section>\n<!-- CARD-PAGE:${index + 1}:END -->`;
  }).join('')}</body></html>`;
  return request('cap_filesystem_project_document_write', { operation: 'append', content: html }, '写入四页固定测试视觉 HTML');
}

function jsonForRequest(payload, visualState) {
  const text = JSON.stringify(payload.messages || []);
  if (/当前 Agent 阶段：单一 AI 视觉生成/.test(text)) return aiVisualAgentJson(payload, visualState);
  if (/你是公众号与小红书图文设计师/.test(text)) {
    const input = parseEmbeddedJson(userContent(payload)) || {};
    const pages = Array.isArray(input.pages) ? input.pages : [];
    return { designScheme: {
      visualDirection: '以清晰的信息层级和克制的绿色强调呈现固定测试内容',
      palette: { background: '#102018', surface: '#1A2B23', text: '#F4F0E5', muted: '#B0C0B5', accent: '#39C98A', accentSecondary: '#D98253' },
      typography: { family: 'sans', titlePx: 34, bodyPx: 14, captionPx: 12, lineHeight: 1.55 },
      composition: { grid: '单列信息网格', density: '中等', rhythm: '标题后接短段和重点块', motif: '细线与绿色节点' },
      pages: pages.map((page, index) => ({ page: index + 1, role: page.role, layout: page.role === 'cover' ? 'poster' : page.role === 'ending' ? 'minimal' : 'editorial', focus: `突出第 ${index + 1} 页的核心信息`, treatment: '保留清晰标题、正文和页脚边界' })),
    } };
  }
  if (/为这篇公众号文章生成\s*5 个发布标题|生成 5 个发布标题|唯一推荐标题/.test(text)) return {
    selectedTitle: 'E2E 文章采集样本：固定事实如何进入最终内容',
    titleCandidates: [{ title: 'E2E 文章采集样本：固定事实如何进入最终内容', reason: '固定主链路标题夹具' }],
    hotspotAnchor: 'E2E 文章采集样本',
    coreKeywords: [],
  };
  if (/请审核文章中的事实与论证|审阅文章，判断是否存在事实错误/.test(text)) return { pass: true, issues: [], evidence_checks: [] };
  if (/请判断这篇文章是否存在明显、影响阅读体验的模板化\/AI 腔/.test(text)) return { pass: true, issues: [] };
  if (/文章简报和事实基座整理成一份文章大纲/.test(text)) return { outlineMarkdown: '## 背景\n\n## 验证步骤\n\n## 完成标准' };
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
  if (/fact-base|事实基座|事实抽取|整理可追溯的事实记录/i.test(text)) return {
    claims: [{ id: 'fixture-claim-1', claim: '固定资料展示了一条可核验的测试事实。', status: 'verified', sourceUrl: 'https://example.com/e2e-source', sourceTitle: 'E2E 固定来源', sourceType: 'fixture', evidence: '固定夹具正文' }],
    confirmedFacts: ['固定资料展示了一条可核验的测试事实。'], missingEvidence: [],
  };
  if (/visual-plan|图表|可视化/i.test(text)) return { summary: '固定测试不生成图表', placements: [], rejections: [] };
  if (/image-plan|配图|图片规划/i.test(text)) return { placements: [] };
  if (/hotspotAnchorRule|title_lock|SELECTED_TITLE|生成 5 个发布标题/.test(text)) return {
    selectedTitle: 'E2E 文章采集样本：固定事实如何进入最终内容',
    titleCandidates: [{ title: 'E2E 文章采集样本：固定事实如何进入最终内容', reason: '固定主链路标题夹具' }],
    hotspotAnchor: 'E2E 文章采集样本',
    coreKeywords: [],
  };
  if (/planning|大纲|规划/i.test(text)) return {
    selectedTitle: 'E2E 文章采集样本：固定事实如何进入最终内容',
    titleCandidates: ['E2E 文章采集样本：固定事实如何进入最终内容'], hotspotAnchor: 'E2E 文章采集样本', coreKeywords: [],
    outlineMarkdown: '## 背景\n\n## 验证步骤\n\n## 完成标准', contentRole: 'analysis',
    expectedAction: ['核对固定来源'], practicalIncrement: '固定输入、可复算输出、失败可追踪', materialsMarkdown: '固定测试资料。',
  };
  if (/cover-title|封面标题/i.test(text)) return { lines: ['E2E 主链路测试', '固定输入与可追踪输出'] };
  if (/content-planner|内容规划/i.test(text)) return { operations: [] };
  return {
    claims: [{ id: 'fixture-claim-1', claim: '固定资料展示了一条可核验的测试事实。', status: 'verified', sourceUrl: 'https://example.com/e2e-source', sourceTitle: 'E2E 固定来源', sourceType: 'fixture', evidence: '固定夹具正文' }],
    confirmedFacts: ['固定资料展示了一条可核验的测试事实。'], missingEvidence: [],
    selectedTitle: 'E2E 文章采集样本：固定事实如何进入最终内容', titleCandidates: ['E2E 文章采集样本：固定事实如何进入最终内容'], hotspotAnchor: 'E2E 文章采集样本', coreKeywords: [],
    outlineMarkdown: '## 背景\n\n## 验证步骤\n\n## 完成标准', contentRole: 'analysis', expectedAction: ['核对固定来源'], practicalIncrement: '固定输入、可复算输出、失败可追踪', materialsMarkdown: '固定测试资料。',
    summary: '固定测试输出', placements: [], rejections: [], operations: [], lines: ['E2E 主链路测试'],
  };
}

function toolResponse(toolName, payload = {}) {
  const requestText = JSON.stringify(payload.messages || []);
  if (/article_review_gate/i.test(toolName)) return { pass: true, issues: [], evidence_checks: [] };
  if (/article_quality_gate/i.test(toolName)) return { pass: true, issues: [], evidence_checks: [] };
  if (/title_plan|hotspotAnchorRule|title_lock|SELECTED_TITLE/i.test(`${toolName} ${requestText}`)) return { selectedTitle: 'E2E 文章采集样本：固定事实如何进入最终内容', titleCandidates: [{ title: 'E2E 文章采集样本：固定事实如何进入最终内容', reason: '固定主链路标题夹具' }], hotspotAnchor: 'E2E 文章采集样本', coreKeywords: [] };
  if (/research_coverage/i.test(toolName)) {
    const pointId = JSON.stringify(payload.messages || []).match(/"point_id"\s*:\s*"([^"]+)"/)?.[1] || 'e2e-research-1';
    return { status: 'pass', summary: '固定文章完整回应已采用的研判点。', items: [{ point_id: pointId, status: 'full', coverage: '文章说明采集结果如何进入最终产物。', explanation: '正文覆盖了固定夹具检查的完整链路。', article_excerpt: '检查任务状态和最终文件。' }], omitted_points: [], contradicted_points: [], rejected_point_leakage: [], repair_suggestions: [] };
  }
  return { pass: true, issues: [], missing: [], status: 'pass', reason: '固定测试门禁通过' };
}

function replayIdForRequest(payload) {
  const text = JSON.stringify(payload.messages || []);
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  const toolName = tools[0]?.function?.name || '';
  if (toolName) return `tool:${toolName}`;
  if (/当前 Agent 阶段：单一 AI 视觉生成/.test(text)) return 'social-card-ai-visual-generation';
  if (/你是公众号与小红书图文设计师/.test(text)) return 'social-card-design-scheme';
  if (/为这篇公众号文章生成\s*5 个发布标题|生成 5 个发布标题|唯一推荐标题/.test(text)) return 'article-title-plan';
  if (/请审核文章中的事实与论证|审阅文章，判断是否存在事实错误/.test(text)) return 'article-review';
  if (/请判断这篇文章是否存在明显、影响阅读体验的模板化\/AI 腔/.test(text)) return 'article-voice-quality-gate';
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

export async function startFakeRssHub({ status = 200, routeStatus = status, publishedAt = '2026-09-12T00:00:00.000Z' } = {}) {
  const published = new Date(publishedAt).toUTCString();
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

export async function startFakeGitHub() {
  const requests = [];
  const readme = '# E2E Fixture Tool\n\n固定仓库资料，用于验证真实仓库分析接口能够驱动图文事实基座。\n\n## Features\n\n- 通过固定接口返回可核验的项目能力。\n- 生成可追踪的事实清单和图文故事板。\n\n## Installation\n\n    npm install e2e-fixture-tool\n';
  const encodedReadme = Buffer.from(readme, 'utf8').toString('base64');
  const server = http.createServer((request, response) => {
    requests.push(request.url || '');
    const url = request.url || '';
    if (url === '/repos/example/e2e-tool') return sendGitHubJson(response, {
      full_name: 'example/e2e-tool', html_url: 'https://github.com/example/e2e-tool',
      description: '固定仓库分析 Fixture 工具', homepage: '', stargazers_count: 42, forks_count: 7,
      default_branch: 'main', language: 'JavaScript', topics: ['e2e', 'fixture', 'web'], archived: false,
      license: { spdx_id: 'MIT' },
    });
    if (url === '/repos/example/e2e-tool/readme') return sendGitHubJson(response, {
      html_url: 'https://github.com/example/e2e-tool#readme', content: encodedReadme,
    });
    if (url === '/repos/example/e2e-tool/license') return sendGitHubJson(response, {
      html_url: 'https://github.com/example/e2e-tool/blob/main/LICENSE', license: { spdx_id: 'MIT' },
    });
    if (url === '/repos/example/e2e-tool/releases/latest') return sendGitHubJson(response, {
      html_url: 'https://github.com/example/e2e-tool/releases/tag/v1.2.3', tag_name: 'v1.2.3', published_at: '2026-09-10T00:00:00.000Z', prerelease: false,
    });
    return sendGitHubJson(response, { message: 'fixture github route not found' }, 404);
  });
  const port = await listen(server);
  return { baseUrl: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

export async function startFakeModel({ mode = 'normal' } = {}) {
  const requests = [];
  const visualState = { phase: 'start' };
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
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'fixture-call-1', type: 'function', function: { name: toolName, arguments: JSON.stringify(toolResponse(toolName, payload)) } }] }
      : { role: 'assistant', content: payload.response_format ? JSON.stringify(jsonForRequest(payload, visualState)) : /social-card|social cards|hashtag|话题标签|小红书|公众号图文文案/i.test(JSON.stringify(payload.messages || [])) ? '公众号发布标题：E2E 固定图文测试：验证内容如何交付\n\n固定测试图文文案。\n\n#E2E测试 #固定夹具 #主链路验证 #可追踪输出 #功能回归' : articleMarkdown() };
    if (payload.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
      const delta = toolName ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call-1', type: 'function', function: { name: toolName, arguments: JSON.stringify(toolResponse(toolName, payload)) } }] } : { role: 'assistant', content: message.content };
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
