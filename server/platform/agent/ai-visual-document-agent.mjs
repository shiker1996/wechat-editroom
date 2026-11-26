import { runSkill } from './harness.mjs';
import { AgentContractError, normalizeAgentEnvelope, normalizeToolRequest, validateAgentEnvelope } from './tool-protocol.mjs';
import { parseModelJsonWithRepair } from '../llm/model-json.mjs';
import { buildNativeToolDefinitions, capabilityForToolName, providerSupportsNativeTools, providerSupportsToolCallStreaming } from './tool-catalog.mjs';

export const AI_VISUAL_PROJECT_READ = 'cap_filesystem_project_read';
export const AI_VISUAL_DOCUMENT_WRITE = 'cap_filesystem_project_document_write';
export const AI_VISUAL_DOCUMENT_AUDIT = 'cap_social_card_visual_audit';
export const AI_VISUAL_DOCUMENT_CHUNK_MAX_CHARS = 8_000;
export const AI_VISUAL_AGENT_OUTPUT_MAX_TOKENS = 5_000;
export const AI_VISUAL_PAGE_REPAIR_ISSUE_CODES = new Set([
  'CONTENT_OVERFLOW', 'CONTENT_NOT_CENTERED', 'CONTENT_DENSITY_LOW',
  'LIST_ITEMS_UNMEASURED', 'LIST_ITEMS_TOO_DENSE', 'PAGE_STYLE_DEGRADED',
  'DECORATION_PLAN_NOT_RENDERED', 'DECORATION_PLACEMENT_MISMATCH', 'DECORATION_TEXT_OVERLAP',
  'DESIGN_PAGE_MISSING', 'DESIGN_PAGE_MARKER_MISMATCH', 'SHARED_ANCHOR_MISSING',
]);

function nativeRequestId(call, index = 0) {
  const value = String(call?.id || `call_${index + 1}`).replace(/[^A-Za-z0-9_-]/g, '_');
  return `tr_native_${value}_${index + 1}`.slice(0, 63);
}

function compactAuditDetail(value) {
  if (typeof value === 'string') return value.slice(0, 120);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 3).map(compactAuditDetail).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const allowed = ['kind', 'placement', 'x', 'y', 'width', 'height', 'pageCount', 'pageOrder', 'pageAnchors', 'pageOrderValid', 'pageAnchorsValid', 'candidateCount', 'candidates', 'ornamentsOnPage', 'tag', 'className', 'visible', 'hasVisualTreatment', 'ancestorsVisible', 'display', 'visibility', 'opacity', 'rect', 'clippedRect', 'contentRegion', 'body', 'stack', 'textBounds', 'textRunCount', 'spaceOptions', 'contentRect', 'obstacleRect', 'intersectionRect', 'gapPx', 'options', 'left', 'right', 'above', 'below', 'overlapCount', 'overlaps', 'ornament'];
  const compact = Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key))
    .map(([key, item]) => [key, compactAuditDetail(item)])
    .filter(([, item]) => item !== undefined));
  return Object.keys(compact).length ? compact : undefined;
}

function countAiVisualPages(html) {
  return [...String(html || '').matchAll(/\bclass\s*=\s*(["'])(.*?)\1/gi)]
    .filter(([, , classNames]) => classNames.split(/\s+/).includes('page')).length;
}

function readRequest(requestId, workspaceFiles, reason = '读取 AI 视觉生成资料') {
  return {
    type: 'tool_requests',
    assistant_note: '先读取候选视觉生成资料',
    requests: [{
      requestId,
      capability: AI_VISUAL_PROJECT_READ,
      arguments: {
        resourceId: 'project:current',
        options: { includePaths: workspaceFiles, maxFiles: workspaceFiles.length, maxCharsPerFile: 100_000, maxTotalChars: 140_000 },
      },
      reason,
    }],
  };
}

function visualAuditInstruction(auditCapability, report) {
  if (!auditCapability) return '';
  const resultSemantics = `注意：${auditCapability} 返回工具 status=ok 只表示检查已执行；必须读取 valid、groupAuditPassed、checkedPages、exhaustedPages 和 issues。valid=false 是正常检查结果，不是工具调用失败。auditAttempt 每次递增。省略 page 的整组审计只查文档页数、页序和锚点，不做浏览器测量或逐页方案检查；组级结构问题不得按页 replace-page，应修正/重建整份文档。整组通过后按序逐页做浏览器测量/方案兑现审计；每页最多成功 replace-page 3 次，第三次修复后复审仍失败则封存该页的审计结果，禁止继续修该页，直接转下一页。所有页面通过或已封存审计失败后，直接 finish 并生成 PNG；封存页的问题保留在交付报告中，不阻断图文流程。`;
  const nextAttempt = Number(report?.auditAttempt || 0) + 1;
  const pageArgument = (page) => Number.isInteger(Number(page)) && Number(page) > 0 ? `,"page":${Number(page)}` : '';
  const completedPages = new Set([...(report?.checkedPages || []).map(Number), ...(report?.exhaustedPages || []).map(Number)]);
  const nextUnprocessedPage = () => Array.from({ length: Number(report?.pageCount) || 0 }, (_, index) => index + 1).find((page) => !completedPages.has(page));
  if (!report) return `完整 HTML 草稿写完后，先调用 ${auditCapability} 做整组审计，参数为 {"auditAttempt":1}（省略 page）。整组审计通过后，再调用 {"auditAttempt":2,"page":1} 开始逐页浏览器测量和方案兑现检查。${resultSemantics}`;
  if (report.stale) return `HTML 在最近一次审计后又有修改；当前阶段审计已失效。${report.groupAuditPassed ? `重新审计刚修改的第 ${Number(report.scopePage) || 1} 页` : '重新执行不带 page 的整组审计'}，调用参数为 {"auditAttempt":${nextAttempt}${pageArgument(report.groupAuditPassed ? report.scopePage : null)}}。${resultSemantics}`;
  if (report.groupAuditPassed && Number(report.scopePage) > 0 && !report.valid && (report.exhaustedPages || []).map(Number).includes(Number(report.scopePage))) {
    const nextPage = nextUnprocessedPage();
    if (nextPage) return `第 ${Number(report.scopePage)} 页已成功修复 ${Number(report.repairAttempts) || 0} 次，仍未通过；最终 issues 已保存。不要再审计或修复该页，继续审计第 ${nextPage} 页，调用 ${auditCapability}，参数为 {"auditAttempt":${nextAttempt},"page":${nextPage}}。${resultSemantics}`;
    return `第 ${Number(report.scopePage)} 页已成功修复 ${Number(report.repairAttempts) || 0} 次仍未通过，最终 issues 已保存；其余页面也都已通过或封存。现在直接 finish 文档，不要 abort 或重建。${resultSemantics}`;
  }
  if (report.groupAuditPassed && Number(report.scopePage) > 0 && report.valid) {
    const nextPage = nextUnprocessedPage();
    if (nextPage) return `第 ${Number(report.scopePage)} 页审计通过。继续只审计第 ${nextPage} 页，调用 ${auditCapability}，参数为 {"auditAttempt":${nextAttempt},"page":${nextPage}}。${resultSemantics}`;
    return `整组审计已通过，全部 ${Number(report.pageCount) || 0} 页均已通过或已封存失败审计结果。现在直接调用 cap_filesystem_project_document_write 的 finish；不要再做整组审计。${resultSemantics}`;
  }
  if (report.groupAuditPassed && report.valid && !Number(report.scopePage)) {
    const firstUnchecked = nextUnprocessedPage() || 1;
    return `整组审计已通过。现在只对第 ${firstUnchecked} 页做浏览器测量和方案兑现检查，调用 ${auditCapability}，参数为 {"auditAttempt":${nextAttempt},"page":${firstUnchecked}}。${resultSemantics}`;
  }
  const issues = (report.issues || []).map((issue) => {
    const details = [
      compactAuditDetail(issue.expected) !== undefined ? `期望=${JSON.stringify(compactAuditDetail(issue.expected))}` : '',
      compactAuditDetail(issue.actual) !== undefined ? `实测=${JSON.stringify(compactAuditDetail(issue.actual))}` : '',
    ].filter(Boolean).join('，');
    return [[issue.code, issue.message].filter(Boolean).join('：'), details].filter(Boolean).join('（') + (details ? '）' : '');
  }).filter(Boolean).join('；') || '页面尺寸检查未通过';
  const hasUnrenderedOrnament = (report.issues || []).some((issue) => issue.code === 'DECORATION_PLAN_NOT_RENDERED');
  const ornamentRepairHint = hasUnrenderedOrnament
    ? '装饰未呈现时，先读 actual.candidates：没有候选就添加正确标记；placement 不同就修正标记和位置；候选 visible=false 时按 display、visibility、opacity、hasVisualTreatment、ancestorsVisible 和 clippedRect 修复实际原因。仅有 data-ornament 属性不算通过；页面外 CSS 不可改时，使用已有样式类或在本页元素上写可见的行内样式，不能添加无样式的新 class 或空占位元素。'
    : '';
  const hasDecorationSpaceConflict = (report.issues || []).some((issue) => issue.code === 'DECORATION_TEXT_OVERLAP'
    || (issue.code === 'DECORATION_PLACEMENT_MISMATCH' && issue.actual?.spaceOptions));
  const decorationSpaceRepairHint = hasDecorationSpaceConflict
    ? '装饰占用正文版心时，不能只移动或缩小装饰。先读取 actual.contentRegion 与 actual.spaceOptions.options 的实测坐标/宽高；同步收窄或偏移 page-content-stack/正文容器，把文字重排进可用区域，并为装饰保留间隔。若左右/上下可用区域都容不下正文，再移动或缩小装饰；不要把横条或方框盖在仍保持原宽度的内容上。'
    : '';
  const repeatedRepairHint = Number(report.repeatedRepairPage) > 0
    ? `第 ${Number(report.repeatedRepairPage)} 页刚提交过完全相同的替换内容，服务端已拒绝重复写入；本次必须改变实现，或先处理其他失败页。`
    : '';
  const allIssuesScoped = (report.issues || []).length > 0 && (report.issues || []).every((issue) => AI_VISUAL_PAGE_REPAIR_ISSUE_CODES.has(issue.code) && Number.isInteger(Number(issue.page)) && Number(issue.page) > 0);
  const pages = [...new Set((report.issues || []).map((issue) => Number(issue.page)).filter((page) => Number.isInteger(page) && page > 0))];
  if (Number(report.scopePage) > 0 && allIssuesScoped && pages.includes(Number(report.scopePage))) return `第 ${Number(report.scopePage)} 页审计未通过：${issues}。${ornamentRepairHint}${decorationSpaceRepairHint}${repeatedRepairHint}该页已成功修复 ${Number(report.repairAttempts) || 0}/${Number(report.maxRepairAttemptsPerPage) || 3} 次。只用 operation=replace-page 替换第 ${Number(report.scopePage)} 页，content 只包含该页完整根元素 <section class="page" data-page="${Number(report.scopePage)}">…</section>；保留该页全部事实、原角色和顺序，并保留页面外 CSS、主题和其他页原样不动。修改实际问题后，用 {"auditAttempt":${nextAttempt},"page":${Number(report.scopePage)}} 重审同一页。${resultSemantics}`;
  if (Number(report.scopePage) > 0 && allIssuesScoped && pages.length) {
    const page = pages[0];
    return `审计未通过：${issues}。先按报告中的页码和实测值修复第 ${page} 页，然后调用 ${auditCapability} 重新审计当前阶段。${resultSemantics}`;
  }
  return `最近一次 ${auditCapability} 审计未通过：${issues}。报告没有可定位页码，无法安全局部修复；先 abort 当前文档，再 begin 并完整重写修正版，保留所有事实，之后用 {"auditAttempt":${Number(report.auditAttempt || 1) + 1}} 重新调用 ${auditCapability} 审计，审计通过前不要 finish。${resultSemantics}`;
}

function isVisualAuditFinishReady(report, pageCount) {
  if (report?.groupAuditPassed !== true || Number(report.pageCount) !== Number(pageCount)) return false;
  const completed = new Set([...(report.checkedPages || []).map(Number), ...(report.exhaustedPages || []).map(Number)]);
  return Number(pageCount) > 0 && Array.from({ length: Number(pageCount) }, (_, index) => completed.has(index + 1)).every(Boolean);
}

function generationInstruction({ sourceRead, documentStarted, documentFinished, pageCount, targetPageCount, minPages, maxPages, outputPath, documentLabel, auditCapability = '', auditReport = null }) {
  const auditInstruction = visualAuditInstruction(auditCapability, auditReport);
  if (!sourceRead) return '先读取 workspace.files 中的全部本次运行输入；技能内置参考已经随系统提示注入，并据此完成视觉解释；不要先写页面。';
  if (!documentStarted) return `资料已读取。现在开始一次完整的单 Agent ${documentLabel}生成会话：先用 cap_filesystem_project_document_write 的 begin 操作建立文档。不要返回 final。${auditInstruction}`;
  if (documentFinished) return `文档 ${outputPath} 已完成 finish。现在只返回严格合法的 {"type":"final","assistantReply":"已完成 AI 视觉 HTML 生成"}，不要调用工具，不要输出 HTML/CSS。`;
  if (pageCount < minPages) return `当前检测到 ${pageCount} 页，至少需要 ${minPages} 页（故事板基准 ${targetPageCount} 页，允许范围 ${minPages}–${maxPages} 页）。继续用 cap_filesystem_project_document_write 的 append 原样追加下一段完整 HTML/CSS，单个 content 不超过 ${AI_VISUAL_DOCUMENT_CHUNK_MAX_CHARS} 字符。当前仍未完成 ${documentLabel}，不要返回 final。每个 append 使用新的 requestId，并根据上一次工具结果填写 expectedRevision。服务端会自动注入固定的 resourceId、path 和 sessionId。${auditInstruction}`;
  if (pageCount >= maxPages) return `当前检测到 ${pageCount} 页，已经达到允许上限 ${maxPages} 页（故事板基准 ${targetPageCount} 页）。禁止继续追加新的 .page 页面、重复文案或空白页；只在确有必要时补全非页面闭合标签，然后${auditCapability ? `先调用 ${auditCapability} 审计` : '立即'}，通过后才能用 cap_filesystem_project_document_write 的 finish 结束会话。${auditInstruction}`;
  return `当前检测到 ${pageCount} 页，已落在允许范围 ${minPages}–${maxPages} 页（故事板基准 ${targetPageCount} 页）。检查 ${outputPath} 是否已经包含完整主题 CSS、所有页面结构、闭合标签和可见主题装饰；如果还没写完，只能继续 append 尚未完成的内容，并确保不会让页面数超过 ${maxPages}。${auditInstruction}不要为了凑页数添加空白页、重复文案或虚构事实。`;
}

function generationStageOverride({ requiredPageCount, pageCountTolerance, canvas, outputPath, documentLabel, nativeTools = false, auditCapability = '' }) {
  const width = Number(canvas?.width) || 375;
  const height = Number(canvas?.height) || 667;
  const targetPageCount = Math.max(1, Number(requiredPageCount) || 1);
  const tolerance = Math.max(0, Number(pageCountTolerance) || 0);
  const minPages = Math.max(1, targetPageCount - tolerance);
  const maxPages = targetPageCount + tolerance;
  return `
## 当前 Agent 阶段：单一 AI 视觉生成

你是 ${documentLabel}的唯一视觉设计师、HTML/CSS 执行者和文件写入者。故事板基准为 ${targetPageCount} 页，实际允许生成 ${minPages}–${maxPages} 页；只有确实需要拆分或合并内容时才调整页数，不得添加空白页、重复文案或虚构事实。画布基准为 ${width}×${height}。不要把任务拆给 CSS Agent、页面 Agent 或任何后续程序。先完整读取 workspace.files 中的全部本次运行输入；布局、结构和组件参考已随技能提示注入；再在同一个会话中完成视觉解释、主题系统、组件 CSS、全部页面和 HTML 闭合。

- 当前只允许调用 cap_filesystem_project_read、cap_filesystem_project_document_write${auditCapability ? ` 和 ${auditCapability}` : ''}。
- 只使用 cap_filesystem_project_document_write 写入文件；不要输出完整 HTML/CSS 到 final 或普通回答。
- 写入目标固定为 project:current 下的 ${outputPath}；resourceId、path 和 sessionId 由服务端自动注入。
- 第一次写入必须是 operation=begin；之后使用 operation=append 原样追加 HTML/CSS 分块。${auditCapability ? '每页必须按 DOM 顺序从 1 开始编号，并使用唯一边界注释 <!-- CARD-PAGE:N:START --> 与 <!-- CARD-PAGE:N:END --> 包住唯一根元素 <section class="page" data-page="N">…</section>。完整 HTML 草稿写完后、finish 前先省略 page 做整组审计；整组未通过时按整组 issue 的实测结果修正或重建整份文档，再重做整组审计；该阶段不产生可局部修复的页码，不能用 replace-page 逐页修。整组通过后，按页序从第 1 页开始逐页做浏览器测量和方案兑现检查；当前页未通过时只修该页，再递增 auditAttempt 重审同一页，通过后再检查下一页。所有页面通过后直接 finish，不再做末尾整组审计。装饰未呈现时，按 audit actual.candidates 和可见状态字段诊断：标记存在不等于可见；不得用无样式新 class 或空占位元素代替真实可见装饰。replace-page 不能修改页面外 CSS，因此应使用已有样式类或本页行内样式修复。仅无法定位到具体页或页面锚点/根结构损坏时，才 abort 后完整重建。装饰清单是可选意图，不得为满足装饰数量而重写页面。' : '所有内容写完后使用 operation=finish。'} finish 成功后才能返回 final。
- append 的 content 是原始 HTML/CSS，不要让程序替你拼接、改写、补 CSS、补结构或插入主题装饰。每块不超过 ${AI_VISUAL_DOCUMENT_CHUNK_MAX_CHARS} 字符，并为每块使用唯一 requestId；能填写时使用上一次结果中的 expectedRevision。
- 不要假设程序会保留预置页面壳，最终文件必须由你的分块内容本身构成完整 HTML。
- 页面排版前先按方案确定装饰的画布位置和占用矩形，再把 .page-content-stack 的宽度、偏移和内容流限制在装饰之外的可用版心内。横条、边框、方框等会占用空间的元素不能覆盖仍按整幅正文宽度排版的内容；装饰在侧边时收窄或偏移内容容器，在顶部/底部时为其预留对应高度。应保留可读性和至少 8px 间隔，不用遮挡、裁切或透明占位处理冲突。审计若报告正文区域、装饰区域及 spaceOptions，按实测矩形同步调整内容容器并重排文字，而不是只移动装饰。
- 写入前逐页估算正文、标题和页脚的垂直容量；如果内容放不进固定画布，优先在允许范围内拆成新页（最多比故事板多 ${tolerance} 页），完整保留事实、限制和观察点。不得靠删事实、压成不可读小字、遮挡或裁切来满足页数。
- 生成阶段不得调用旧的 cap_filesystem_project_write，不返回程序化补丁。
- 只有在 ${minPages}–${maxPages} 页、主题 CSS、页面正文、闭合标签和主题装饰全部写完并成功 finish${auditCapability ? ` 且 ${auditCapability} 审计通过` : ''} 后，才返回严格的 {"type":"final","assistantReply":"简短说明"}；assistantReply 必须是字符串。达到 ${maxPages} 页后禁止再创建 .page。
${nativeTools ? '- 工具调用必须使用 API 提供的原生 function tool；不要在普通文本中伪造 tool_requests JSON。' : '- 所有工具请求必须是完整合法 JSON；HTML/CSS 放在 JSON 字符串 content 中，正确转义引号、反斜杠和换行。'}
`;
}

export function filterAiVisualGenerationCatalog(catalog = [], documentWriteCapability = AI_VISUAL_DOCUMENT_WRITE, auditCapability = '') {
  return (Array.isArray(catalog) ? catalog : []).filter((item) => [AI_VISUAL_PROJECT_READ, documentWriteCapability, auditCapability].filter(Boolean).includes(item.capability));
}

export function shouldUseAiVisualPlanningThinking({ sourceRead = false, documentStarted = false, planningThinkingUsed = false } = {}) {
  return Boolean(sourceRead && documentStarted && !planningThinkingUsed);
}

export async function runAiVisualDocumentAgent({
  gateway,
  store,
  batchId,
  candidateId,
  provider,
  registry,
  catalog,
  agentSystem = '',
  renderRequest = {},
  workspaceFiles = [],
  requiredPageCount = 1,
  canvas = { width: 375, height: 667 },
  outputPath = 'ai-visual.html',
  documentLabel = 'AI 视觉文档',
  pageCountTolerance = 0,
  entryPoint = 'ai-visual-document-generation',
  skillId = 'ai-visual-document-generator',
  purpose = 'ai-visual-document-generation-agent',
  documentWriteCapability = AI_VISUAL_DOCUMENT_WRITE,
  auditCapability = '',
  getVisualAuditResult = () => null,
  getPageCount,
  documentWriteSessionId,
  markSourceRead = () => {},
  onPhaseChange = () => {},
  resolveArguments,
  sanitizeToolResult,
  toolContext = {},
  maxOutputTokens = AI_VISUAL_AGENT_OUTPUT_MAX_TOKENS,
  budget = {},
  resumeFrom = '',
  onProgress = () => {},
  onEvent = () => {},
} = {}) {
  if (typeof getPageCount !== 'function') throw new TypeError('AI 视觉文档 Agent 缺少 getPageCount');
  if (!documentWriteSessionId) throw new TypeError('AI 视觉文档 Agent 缺少 documentWriteSessionId');
  const pageFiles = [...new Set(Array.isArray(workspaceFiles) ? workspaceFiles : [])];
  const targetPageCount = Math.max(1, Number(requiredPageCount) || 1);
  const tolerance = Math.max(0, Number(pageCountTolerance) || 0);
  const minPages = Math.max(1, targetPageCount - tolerance);
  const maxPages = targetPageCount + tolerance;
  const generationCatalog = filterAiVisualGenerationCatalog(catalog, documentWriteCapability, auditCapability);
  const nativeTools = providerSupportsNativeTools(gateway, provider);
  const nativeToolDefinitions = nativeTools ? buildNativeToolDefinitions(generationCatalog) : [];
  const nativeToolStreaming = nativeTools && providerSupportsToolCallStreaming(gateway, provider);
  const allowedCapabilities = [AI_VISUAL_PROJECT_READ, documentWriteCapability, auditCapability].filter(Boolean);
  const baseMessages = [{ role: 'user', protected: true, content: JSON.stringify({ render_request: renderRequest }) }];
  let sourceRead = false;
  let documentStarted = false;
  let documentFinished = false;
  let pageRepairAttempted = false;
  let pendingOperation = null;
  let pendingOperationDetail = '';
  let repeatedRepairRecovery = null;
  let repeatedRepairRejections = 0;
  let lastModelResult = null;
  let planningThinkingUsed = false;

  const describePendingOperation = (operation, args = {}) => {
    if (operation === 'replace-page') {
      const page = Number(args.page);
      return Number.isInteger(page) && page > 0 ? `第 ${page} 页` : '指定页面';
    }
    if (operation === 'append') {
      const current = Number(getPageCount()) || 0;
      const added = countAiVisualPages(args.content);
      if (added > 0) return added === 1
        ? `第 ${current + 1} 页`
        : `第 ${current + 1}–${current + added} 页`;
      return `页面 HTML/CSS（当前 ${current} 页）`;
    }
    if (operation === 'audit') {
      const page = Number(args.page);
      return Number.isInteger(page) && page > 0 ? `第 ${page} 页` : '全部页面';
    }
    return '';
  };
  const setPendingOperation = (operation, args = {}) => {
    pendingOperation = operation;
    pendingOperationDetail = describePendingOperation(operation, args);
    if (operation === 'append') onProgress(`AI 视觉 Agent 开始生成 ${pendingOperationDetail}…`);
    else if (operation === 'replace-page') onProgress(`AI 视觉 Agent 开始修复 ${pendingOperationDetail}…`);
    else if (operation === 'audit') onProgress(`AI 视觉 Agent 开始审计 ${pendingOperationDetail}…`);
  };
  let modelGateway = gateway;
  const complete = async ({ history, step, signal, instruction, outputMaxTokens = AI_VISUAL_AGENT_OUTPUT_MAX_TOKENS, thinking = false, emit = () => {}, native = false }) => {
    const input = {
      provider,
      purpose,
      batchId,
      candidateId,
      thinking,
      temperature: step ? 0.35 : 0.25,
      maxOutputTokens: Math.min(outputMaxTokens, maxOutputTokens),
      adaptiveOutput: false,
      jsonMode: !native,
      tools: native ? nativeToolDefinitions : [],
      nativeTools: native,
      signal,
      messages: [...history, { role: 'user', protected: true, content: instruction }],
    };
    if (native && nativeToolStreaming && typeof gateway.streamComplete === 'function') {
      return modelGateway.streamComplete(input, () => {}, (text) => emit('assistant.thinking', { text }));
    }
    return modelGateway.complete(input);
  };

  const describeModelResponseError = (error) => {
    const issueText = Array.isArray(error?.issues) && error.issues.length
      ? `；字段问题：${error.issues.map((issue) => `${issue.path || '未知字段'}（${issue.code || 'INVALID'}）`).join('、')}`
      : '';
    return `${error?.code || 'MODEL_RESPONSE_INVALID'}：${error?.message || '响应不符合要求'}${issueText}`.slice(0, 900);
  };

  const jsonRecoveryInstruction = (error, attempt, maxAttempts) => `上一条模型响应无法安全解析为完整 JSON。第 ${attempt}/${maxAttempts} 次恢复。具体问题：${describeModelResponseError(error)}。只返回一个完整合法的 cap_filesystem_project_document_write append 工具请求；content 只放尚未写入的更短 HTML/CSS 分块，不超过 ${AI_VISUAL_DOCUMENT_CHUNK_MAX_CHARS} 字符；不要返回解释，不要返回完整 HTML。服务端会补齐 resourceId、path、sessionId、assistant_note 和 reason。`;

  const protocolRecoveryInstruction = (parsed, error) => {
    const detail = describeModelResponseError(error);
    if (parsed?.type === 'final') return `上一条响应 JSON 语法正确，但 final 信封不符合协议。具体问题：${detail}。只返回完整合法的 {"type":"final","assistantReply":"阶段已完成"}，不要调用工具，不要输出解释。`;
    return `上一条响应 JSON 语法正确，但工具请求信封不符合协议。具体问题：${detail}。只返回一个完整合法的 cap_filesystem_project_document_write append 工具请求；必须保留外层 requestId、capability、arguments.operation 和 append 的 content。assistant_note、reason、resourceId、path、sessionId 可以省略，服务端会自动补齐；不要返回解释。`;
  };

  const parseAndValidateVisualEnvelope = async ({ result, history, step, signal, label }) => {
    const parsed = await parseModelJsonWithRepair(result, {
      store,
      label,
      allowMissingToolRequestReason: true,
      allowMissingToolRequestAssistantNote: true,
      maxRepairAttempts: 2,
      repair: async (error, { attempt, maxAttempts }) => {
        onProgress(`AI 视觉 Agent 输出结构异常，第 ${attempt} 次反馈具体错误并缩短分块…`);
        const recoveryResult = await complete({ history, step, signal, instruction: jsonRecoveryInstruction(error, attempt, maxAttempts) });
        lastModelResult = recoveryResult;
        return recoveryResult;
      },
    });
    try {
      return validateAgentEnvelope(normalizeAgentEnvelope(parsed), { maxRequests: 1 });
    } catch (error) {
      onProgress('AI 视觉 Agent 输出字段不符合协议，反馈具体字段问题…');
      const corrected = await complete({ history, step, signal, instruction: protocolRecoveryInstruction(parsed, error) });
      lastModelResult = corrected;
      const correctedParsed = await parseModelJsonWithRepair(corrected, {
        store,
        label: `${label}协议反馈结果`,
        allowMissingToolRequestReason: true,
        allowMissingToolRequestAssistantNote: true,
        maxRepairAttempts: 1,
        repair: async (jsonError, { attempt, maxAttempts }) => {
          const recoveryResult = await complete({ history, step, signal, instruction: jsonRecoveryInstruction(jsonError, attempt, maxAttempts) });
          lastModelResult = recoveryResult;
          return recoveryResult;
        },
      });
      return validateAgentEnvelope(normalizeAgentEnvelope(correctedParsed), { maxRequests: 1 });
    }
  };

  const recoverToolRequest = async ({ parsed, history, step, signal, instruction, label }) => {
    const recoveryHistory = [...history, { role: 'assistant', content: JSON.stringify(parsed), protected: true }];
    const corrected = await complete({ history: recoveryHistory, step, signal, instruction });
    lastModelResult = corrected;
    return parseAndValidateVisualEnvelope({ result: corrected, history: recoveryHistory, step, signal, label });
  };

  onPhaseChange('generation');
  const agent = await runSkill({
    gateway,
    gateHandlers: { 'visual-document-finished': { version: '1', phase: 'output', check: () => documentFinished } },
    entryPoint,
    registry,
    catalog: generationCatalog,
    messages: [{ role: 'system', protected: true, content: `${agentSystem}${generationStageOverride({ requiredPageCount: targetPageCount, pageCountTolerance: tolerance, canvas, outputPath, documentLabel, nativeTools, auditCapability })}` }, ...baseMessages],
    store,
    ...(resumeFrom ? { resumeFrom: String(resumeFrom) } : {}),
    budget: {
      // 视觉文档按分块写入：读取、begin、多个 append、审计及必要的修复都各占 Agent step；
      // 社交卡路径不按步数/调用数截断，仍受运行超时与结果/历史字符预算约束。
      maxModelSteps: Number(budget.maxModelSteps) || Math.max(auditCapability ? 28 : 18, maxPages + (auditCapability ? 18 : 12)),
      maxToolCalls: Number(budget.maxToolCalls) || Math.max(auditCapability ? 28 : 18, maxPages + (auditCapability ? 18 : 12)),
      maxParallelToolCalls: 1,
      maxToolResultChars: Number(budget.maxToolResultChars) || 80_000,
      maxTotalToolResultChars: Number(budget.maxTotalToolResultChars) || 320_000,
      maxHistoryChars: Number(budget.maxHistoryChars) || 300_000,
      timeoutMs: Number(budget.timeoutMs) || 300_000,
    },
    toolContext: { ...toolContext, skillId, generationPhase: 'generation', allowedCapabilities },
    resolveArguments,
    sanitizeToolResult,
    onEvent: (event) => {
      if (event?.type === 'tool.completed' && event?.capability === AI_VISUAL_PROJECT_READ) {
        sourceRead = true;
        markSourceRead();
      }
      if (event?.type === 'tool.completed' && event?.capability === documentWriteCapability) {
        if (pendingOperation === 'begin') documentStarted = true;
        if (pendingOperation === 'abort') { documentStarted = false; documentFinished = false; }
        if (pendingOperation === 'finish') documentFinished = true;
        if (pendingOperation === 'replace-page') repeatedRepairRejections = 0;
        if (pendingOperation === 'replace-page') onProgress(`AI 视觉 Agent 已提交 ${pendingOperationDetail} 局部修复，准备复审该页…`);
        else if (pendingOperation === 'append') onProgress(`AI 视觉 Agent 已生成 ${pendingOperationDetail}…`);
        else if (pendingOperation === 'finish') onProgress('AI 视觉 Agent 已完成文档写入…');
        else if (pendingOperation === 'abort') onProgress('AI 视觉 Agent 已重置文档，准备重新生成…');
        else if (pendingOperation === 'begin') onProgress('AI 视觉 Agent 已开始文档写入…');
        pendingOperation = null;
        pendingOperationDetail = '';
      }
      if (event?.type === 'tool.completed' && event?.capability === auditCapability) {
        const audit = getVisualAuditResult();
        const scope = Number(audit?.scopePage) > 0 ? `第 ${Number(audit.scopePage)} 页` : '全部页面';
        const exhausted = Number(audit?.scopePage) > 0 && (audit?.exhaustedPages || []).map(Number).includes(Number(audit.scopePage));
        onProgress(audit?.valid === true
          ? `AI 视觉 Agent 已完成 ${scope}审计，通过${scope === '全部页面' ? '，可以结束文档' : ''}…`
          : exhausted
            ? `AI 视觉 Agent 第 ${Number(audit.scopePage)} 页修复 ${Number(audit.repairAttempts) || 0} 次后仍未通过，已保存审计结果，继续下一页…`
            : `AI 视觉 Agent 已完成 ${scope}审计，发现问题，准备按页修复…`);
        pendingOperation = null;
        pendingOperationDetail = '';
      }
      if (event?.type === 'tool.failed' && [documentWriteCapability, auditCapability].includes(event?.capability)) {
        const failureMessage = String(event?.error?.message || '');
        if (event?.capability === documentWriteCapability && pendingOperation === 'replace-page' && /刚提交过完全相同的替换内容/.test(failureMessage)) {
          const page = Number(failureMessage.match(/第\s*(\d+)\s*页/)?.[1]) || Number(pendingOperationDetail.match(/第\s*(\d+)\s*页/)?.[1]) || 0;
          repeatedRepairRejections += 1;
          repeatedRepairRecovery = { page, count: repeatedRepairRejections };
          if (repeatedRepairRejections === 1) onProgress(`AI 视觉 Agent 检测到第 ${page} 页重复提交；下一轮切换为结构化修复请求，并按最新审计坐标修改元素…`);
          else onProgress(`AI 视觉 Agent 第 ${page} 页再次提交相同内容（${repeatedRepairRejections}/2）；将停止该页重复调用…`);
        }
        if (pendingOperationDetail) onProgress(`AI 视觉 Agent ${pendingOperation === 'replace-page' ? '修复' : pendingOperation === 'append' ? '生成' : pendingOperation === 'audit' ? '审计' : '操作'} ${pendingOperationDetail}失败：${event?.error?.message || '工具调用失败'}`);
        pendingOperation = null;
        pendingOperationDetail = '';
      }
      onEvent(event);
    },
    modelStep: async ({ gateway: preparedGateway, messages: history, step, signal, emit }) => {
      modelGateway = preparedGateway || gateway;
      if (!sourceRead) return validateAgentEnvelope(readRequest(`tr_visual_read_${step + 1}`, pageFiles), { maxRequests: 1 });
      if (!documentStarted) {
        pendingOperation = 'begin';
        return validateAgentEnvelope({
          type: 'tool_requests',
          assistant_note: `建立 AI 视觉 ${documentLabel}写入会话`,
          requests: [{
            requestId: `tr_visual_begin_${step + 1}`,
            capability: documentWriteCapability,
            arguments: { resourceId: 'project:current', path: outputPath, operation: 'begin', sessionId: documentWriteSessionId },
            reason: `开始由同一个视觉 Agent 分块写入完整${documentLabel} HTML/CSS`,
          }],
        }, { maxRequests: 1 });
      }

      const usePlanningThinking = shouldUseAiVisualPlanningThinking({ sourceRead, documentStarted, planningThinkingUsed });
      planningThinkingUsed = true;
      const repeatedRepair = repeatedRepairRecovery;
      repeatedRepairRecovery = null;
      if (repeatedRepair?.count >= 2) {
        const audit = getVisualAuditResult();
        const auditIssues = (audit?.issues || []).filter((issue) => Number(issue.page) === Number(repeatedRepair.page)).map((issue) => issue.message).filter(Boolean).join('；');
        const message = `第 ${repeatedRepair.page} 页连续两次提交完全相同的修复内容，已停止重复调用；当前审计问题：${auditIssues || '请检查该页最新审计结果'}`;
        onProgress(`AI 视觉 Agent ${message}`);
        throw new AgentContractError('AGENT_BUDGET_EXCEEDED', message);
      }
      const instruction = generationInstruction({ sourceRead, documentStarted, documentFinished, pageCount: Number(getPageCount()) || 0, targetPageCount, minPages, maxPages, outputPath, documentLabel, auditCapability, auditReport: getVisualAuditResult() });
      const repairRecoveryInstruction = repeatedRepair
        ? `服务端拒绝了第 ${repeatedRepair.page} 页上一条完全相同的 replace-page。本轮禁止原生工具调用。请读取对话里的最新浏览器审计报告，针对报告中的实际坐标或可见性原因实质修改被指出的元素；不能只改空格、注释、requestId 或无关样式。只返回一个严格合法的 tool_requests JSON，调用 ${documentWriteCapability} 的 replace-page，page=${repeatedRepair.page}，content 为该页完整根元素；使用新的 requestId。不要 append、abort、修改其他页或重复已拒绝的页面内容。`
        : '';
      if (repeatedRepair) onProgress(`AI 视觉 Agent 正在用结构化请求重写第 ${repeatedRepair.page} 页，依据审计结果修正实际元素…`);
      const nativeCallEnabled = nativeTools && !repeatedRepair;
      let result = await complete({ history, step, signal, emit, native: nativeCallEnabled, thinking: usePlanningThinking, instruction: `${instruction}${repairRecoveryInstruction ? `\n\n${repairRecoveryInstruction}` : ''}` });
      lastModelResult = result;
      if (nativeCallEnabled && result?.toolCalls?.length) {
        const call = result.toolCalls[0];
        const capability = capabilityForToolName(call.name, generationCatalog);
        const operation = String(call.input?.operation || '');
        if (capability === documentWriteCapability && ['begin', 'append', 'replace-page', 'finish', 'abort'].includes(operation)) {
          // Native tool calls bypass the JSON-envelope normalization below.
          // Pin document identity here so a model-supplied sessionId cannot
          // abort another session while local state treats this one as aborted.
          call.input = {
            ...(call.input || {}),
            resourceId: 'project:current',
            path: outputPath,
            sessionId: documentWriteSessionId,
            requestId: nativeRequestId(call, 0),
          };
          setPendingOperation(operation, call.input);
        }
        if (capability === auditCapability) setPendingOperation('audit', call.input);
        return { nativeTools: true, content: result.content || '', toolCalls: result.toolCalls };
      }
      let parsed = await parseAndValidateVisualEnvelope({ result, history, step, signal, label: 'AI 视觉 Agent' });
      let recoveryAttempts = 0;
      while (true) {
        if (parsed?.type === 'final') {
          const currentPageCount = Number(getPageCount()) || 0;
          const latestAudit = getVisualAuditResult();
          const visualAuditPassed = !auditCapability || isVisualAuditFinishReady(latestAudit, currentPageCount);
          if (documentFinished && currentPageCount >= minPages && currentPageCount <= maxPages && visualAuditPassed) return validateAgentEnvelope(parsed, { maxRequests: 1 });
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续过早返回 final，文档尚未完成，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 完成前恢复', instruction: `${generationInstruction({ sourceRead, documentStarted, documentFinished, pageCount: currentPageCount, targetPageCount, minPages, maxPages, outputPath, documentLabel, auditCapability, auditReport: getVisualAuditResult() })} 你刚才过早返回了 final。${!visualAuditPassed ? '必须先完成浏览器审计并根据反馈修正。' : ''}若当前页数已在允许范围内，请按要求完成审计后再 finish；若不足最小页数，必须继续写入，不能结束。` });
          continue;
        }
        if (parsed?.type !== 'tool_requests') return validateAgentEnvelope({ type: 'final', assistantReply: 'AI 视觉生成阶段结束' }, { maxRequests: 1 });

        const request = normalizeToolRequest(parsed.requests?.[0], { fallbackReason: `执行 AI 视觉${documentLabel}分块写入` });
        if (!request || ![AI_VISUAL_PROJECT_READ, documentWriteCapability, auditCapability].filter(Boolean).includes(request.capability)) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续返回不可用的工具能力，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 工具能力恢复', instruction: `上一条工具请求未执行，原因：只能使用 cap_filesystem_project_read、cap_filesystem_project_document_write${auditCapability ? ` 和 ${auditCapability}` : ''}。请保留尚未写入的 HTML/CSS 内容，只返回一个完整合法、能力正确的工具请求；不要输出空 append、解释或完整 HTML。服务端会补齐资源参数。` });
          continue;
        }
        if (request.capability === AI_VISUAL_PROJECT_READ) {
          sourceRead = true;
          markSourceRead();
          return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
        }
        if (request.capability === auditCapability && auditCapability) {
          const currentAudit = getVisualAuditResult();
          const requestedPage = Number.isInteger(Number(request.arguments?.page)) && Number(request.arguments?.page) > 0
            ? Number(request.arguments.page)
            : null;
          const sameAuditScope = (Number(currentAudit?.scopePage) || null) === requestedPage;
          if (currentAudit?.valid === false && !currentAudit?.stale && sameAuditScope) {
            if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 未修正审计问题便重复调用审计工具');
            recoveryAttempts += 1;
            parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 重复审计恢复', instruction: `${visualAuditInstruction(auditCapability, currentAudit)} 不要重复审计未修改的同一页面。` });
            continue;
          }
          if (documentFinished) {
            if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 在文档完成后尝试审计；审计必须在 finish 前执行');
            recoveryAttempts += 1;
            parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 审计时机恢复', instruction: `审计必须在文档 finish 前执行。当前文档已 finish；请按文档级恢复流程重新开始生成，再调用 ${auditCapability} 审计，审计通过后才 finish。` });
            continue;
          }
          setPendingOperation('audit', request.arguments);
          return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
        }
        const operation = String(request.arguments?.operation || '');
        const currentAudit = getVisualAuditResult();
        const allIssuesScoped = (currentAudit?.issues || []).length > 0 && (currentAudit?.issues || []).every((issue) => AI_VISUAL_PAGE_REPAIR_ISSUE_CODES.has(issue.code) && Number.isInteger(Number(issue.page)) && Number(issue.page) > 0);
        const failedPages = allIssuesScoped ? [...new Set((currentAudit?.issues || []).map((issue) => Number(issue.page)))] : [];
        const exhaustedPages = new Set((currentAudit?.exhaustedPages || []).map(Number));
        const requestedRepairPage = Number(request.arguments?.page);
        const pageRepairAllowed = operation === 'replace-page'
          && Number(currentAudit?.scopePage) > 0
          && failedPages.includes(requestedRepairPage)
          && !exhaustedPages.has(requestedRepairPage)
          && Number(currentAudit?.repairAttempts || 0) < Number(currentAudit?.maxRepairAttemptsPerPage || 3);
        if (pageRepairAllowed) pageRepairAttempted = true;
        const currentPageExhausted = exhaustedPages.has(Number(currentAudit?.scopePage));
        const currentPageHasScopedFailure = Number(currentAudit?.scopePage) > 0 && failedPages.includes(Number(currentAudit.scopePage));
        const documentRebuildAllowed = operation === 'abort' && !currentPageExhausted && !currentPageHasScopedFailure && (failedPages.length === 0 || pageRepairAttempted);
        const finishAfterAuditCompletionAllowed = operation === 'finish' && isVisualAuditFinishReady(currentAudit, Number(getPageCount()));
        if (operation === 'replace-page' && !pageRepairAllowed) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'replace-page 没有对应的当前审计失败页码');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 页码修复校验', instruction: `replace-page 只能用于最近一次未通过审计明确指出的页码。${visualAuditInstruction(auditCapability, currentAudit)} 当前写入请求未执行。` });
          continue;
        }
        if (auditCapability && currentAudit?.valid === false && !currentAudit?.stale && request.capability === documentWriteCapability && !pageRepairAllowed && !documentRebuildAllowed && !finishAfterAuditCompletionAllowed) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 未按审计页码执行局部修复');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 视觉修正恢复', instruction: `${visualAuditInstruction(auditCapability, currentAudit)} 当前写入请求未执行。` });
          continue;
        }
        if (!['begin', 'append', 'replace-page', 'finish', 'abort'].includes(operation)) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续返回不可用的写入操作，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 写入操作恢复', instruction: '上一条文档写入请求未执行，原因：operation 必须是 begin、append、replace-page、finish 或 abort。请只返回一个完整合法的文档写入请求，不要返回空 append、解释或完整 HTML。服务端会补齐资源参数。' });
          continue;
        }
        const latestAudit = getVisualAuditResult();
        if (operation === 'finish' && auditCapability && !isVisualAuditFinishReady(latestAudit, Number(getPageCount()))) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 未通过浏览器审计就尝试 finish');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent finish 前审计恢复', instruction: `${visualAuditInstruction(auditCapability, getVisualAuditResult())} 当前 finish 请求未执行；先调用审计工具或按审计反馈修正，审计通过前禁止 finish。` });
          continue;
        }
        const content = String(request.arguments?.content ?? '');
        if (['append', 'replace-page'].includes(operation) && !content) {
          if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', 'AI 视觉 Agent 连续返回空 append，未执行空写入');
          recoveryAttempts += 1;
          parsed = await recoverToolRequest({ parsed, history, step, signal, label: 'AI 视觉 Agent 写入内容恢复', instruction: '上一条写入请求未执行，因为 content 为空。请按当前阶段返回非空的 append 分块，或返回符合页码锚点协议的完整 replace-page 页面内容；不要返回解释或完整 HTML。服务端会补齐资源参数。' });
          continue;
        }
        if (operation === 'append') {
          const appendedPageCount = countAiVisualPages(content);
          const currentPageCount = Number(getPageCount()) || 0;
          if (currentPageCount + appendedPageCount > maxPages) {
            if (recoveryAttempts >= 2) throw new AgentContractError('INVALID_AGENT_ENVELOPE', `AI 视觉 Agent 追加后将超过 ${maxPages} 页上限`);
            recoveryAttempts += 1;
            parsed = await recoverToolRequest({
              parsed,
              history,
              step,
              signal,
              label: 'AI 视觉 Agent 页面数恢复',
              instruction: `上一条 append 会让文档超过 ${maxPages} 页上限（当前 ${currentPageCount} 页，新增 ${appendedPageCount} 页）。不要追加新的 .page；只返回一个完整合法的文档写入请求，优先 finish，或只补全非页面的闭合标签和样式。不要返回解释或空 append。`,
            });
            continue;
          }
        }
        request.arguments = { ...(request.arguments || {}), resourceId: 'project:current', path: outputPath, sessionId: documentWriteSessionId };
        setPendingOperation(operation, request.arguments);
        return validateAgentEnvelope({ ...parsed, requests: [request] }, { maxRequests: 1 });
      }
    },
  });
  onPhaseChange('idle');
  return { ...agent, sourceRead, lastModelResult, cssChunkCount: 0, pageCount: Number(getPageCount()) || 0, documentStarted, documentFinished, visualAudit: getVisualAuditResult(), allowedCapabilities, catalog: generationCatalog, outputPath, pageCountTolerance: tolerance, canvas: { width: Number(canvas?.width) || 375, height: Number(canvas?.height) || 667 } };
}
