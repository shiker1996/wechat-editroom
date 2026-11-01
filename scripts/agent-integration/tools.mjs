const id = (name, description, required = true) => ({ type: 'integer', ...(required ? { minimum: 1 } : {}), description });
const string = (description, extra = {}) => ({ type: 'string', description, ...extra });

export const JIANZI_TOOLS = [
  { name: 'jianzi_doctor', description: '检查见字工作台连接、Node 运行时和核心功能是否可用。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_account_profile', description: '读取账号画像，用于选题定位、语气和受众判断。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_settings_summary', description: '读取非敏感设置与模型配置状态；不会返回 API Key、API 地址或调用日志。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_batches_list', description: '列出近期内容批次。', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } }, readOnlyHint: true },
  { name: 'jianzi_batch_create', description: '新建采集批次。', inputSchema: { type: 'object', properties: { date: string('批次日期 YYYY-MM-DD。'), title: string('批次标题。'), note: string('备注。') } }, readOnlyHint: false },
  { name: 'jianzi_batch_collect', description: '启动批次热点采集；返回后台任务 ID，随后用 jianzi_job_wait 查询。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), maxAgeHours: { type: 'integer', enum: [24, 48, 72, 120, 168] } }, required: ['batchId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_batch_auto_research', description: '调用见字内部模型完成批次打标、事件卡和研判自动流程；需要工作台已配置模型。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), provider: string('可选的工作台模型服务商 ID。') }, required: ['batchId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_batch_ranking', description: '查看采集批次的热点排名与候选状态，供 Agent 自行研判选题。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。') }, required: ['batchId'] }, readOnlyHint: true },
  { name: 'jianzi_batch_candidates', description: '列出批次文章或图文候选。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), track: { type: 'string', enum: ['article', 'social_cards'] }, kind: string('文章候选过滤：all、hotspot 或 independent。') }, required: ['batchId'] }, readOnlyHint: true },
  { name: 'jianzi_candidate_add', description: '把 Agent 已研判选择的热点加入文章池或图文池。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), hotspotIds: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 }, tracks: { type: 'array', items: { type: 'string', enum: ['article', 'social_cards'] } } }, required: ['batchId', 'hotspotIds'] }, readOnlyHint: false },
  { name: 'jianzi_candidate_get', description: '读取候选、来源事实、已有研判和编辑决策。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。') }, required: ['candidateId'] }, readOnlyHint: true },
  { name: 'jianzi_candidate_editorial_update', description: '保存 Agent 形成的文章编辑判断；建议先展示用户确认，再锁题。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。'), editorial: { type: 'object', description: '编辑决策字段，如 editor_question、confirmed_facts、author_opinions、rejected_angles、open_questions、forbidden_claims、next_action。' } }, required: ['candidateId', 'editorial'] }, readOnlyHint: false },
  { name: 'jianzi_candidate_lock', description: '锁定已完成编辑判断的文章候选，工作台会执行编辑简报门禁。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。') }, required: ['candidateId'] }, readOnlyHint: false },
  { name: 'jianzi_article_generate', description: '调用见字内部模型完成文章成稿、审稿和事实门禁；需要工作台已配置模型。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。'), provider: string('可选的工作台模型服务商 ID。'), skillId: string('可选的写作 Skill ID。') }, required: ['candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_article_documents', description: '读取批次文章文档或指定候选的草稿/终稿。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), candidateId: string('候选 ID；不填时列出批次文档。'), kind: { type: 'string', enum: ['draft', 'final', 'daily-final'] } }, required: ['batchId'] }, readOnlyHint: true },
  { name: 'jianzi_article_typeset', description: '调用见字内部模型与排版流程生成公众号 HTML；需要工作台已配置模型。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), candidateId: id('候选 ID。', true), imageDeliveryMode: { type: 'string', enum: ['auto', 'local', 'cdn'] } }, required: ['batchId', 'candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_cover_generate', description: '为已完成的文章终稿生成 AI 视觉封面；调用工作台内部模型。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。'), provider: string('可选的工作台模型服务商 ID。') }, required: ['candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_card_editorial_get', description: '读取图文故事板、图文事实基座和设计状态。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。') }, required: ['candidateId'] }, readOnlyHint: true },
  { name: 'jianzi_card_storyboard_generate', description: '调用见字内部模型生成图文故事板；需要工作台已配置模型。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。'), provider: string('可选的工作台模型服务商 ID。') }, required: ['candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_card_editorial_update', description: '保存 Agent 编排的图文故事板 card_plan；工作台在锁定时校验故事板。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。'), cardPlan: { type: 'array', minItems: 1, items: { type: 'object' } }, outputMode: string('可选发布渠道与内容类型。') }, required: ['candidateId', 'cardPlan'] }, readOnlyHint: false },
  { name: 'jianzi_card_lock', description: '锁定图文故事板并执行 CARD GATE。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。') }, required: ['candidateId'] }, readOnlyHint: false },
  { name: 'jianzi_card_generate', description: '调用见字内部模型生成 AI 视觉图文 HTML/PNG，并执行布局审计；需要工作台已配置模型。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。'), provider: string('可选的工作台模型服务商 ID。'), styleBrief: string('可选视觉方向说明。') }, required: ['candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_job_get', description: '读取后台任务状态、错误信息和进度。', inputSchema: { type: 'object', properties: { jobId: string('任务 ID。') }, required: ['jobId'] }, readOnlyHint: true },
  { name: 'jianzi_job_wait', description: '轮询后台任务直到结束或超时，返回最终产物索引。', inputSchema: { type: 'object', properties: { jobId: string('任务 ID。'), timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 } }, required: ['jobId'] }, readOnlyHint: true },
];

const terminalJobStatuses = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'stopped']);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function executeJianziTool(client, name, input = {}) {
  const batch = encodeURIComponent(String(input.batchId || ''));
  const candidate = encodeURIComponent(String(input.candidateId || ''));
  switch (name) {
    case 'jianzi_doctor': {
      const [health, batches] = await Promise.all([client.get('/api/system/health'), client.get('/api/batches?limit=1')]);
      return { connected: true, node: health.node, health, sampleBatchCount: Array.isArray(batches) ? batches.length : 0 };
    }
    case 'jianzi_account_profile': return client.get('/api/system/account-context');
    case 'jianzi_settings_summary': {
      const [settings, models] = await Promise.all([client.get('/api/system/settings'), client.get('/api/models')]);
      return {
        rsshub: (settings.rsshub || []).map(({ key, label, configured, secret }) => ({ key, label, configured: Boolean(configured), secret: Boolean(secret) })),
        articleLength: settings.articleLength || null,
        defaultProvider: models.defaultProvider || '',
        providers: (models.providers || []).map(({ name, label, model, configured, enabled }) => ({ name, label, model, configured: Boolean(configured), enabled: enabled !== false })),
      };
    }
    case 'jianzi_batches_list': return client.get(`/api/batches?limit=${Math.min(100, Math.max(1, Number(input.limit) || 30))}`);
    case 'jianzi_batch_create': return client.post('/api/batches', { date: input.date, title: input.title, note: input.note });
    case 'jianzi_batch_collect': return client.post(`/api/batches/${batch}/collect`, { maxAgeHours: input.maxAgeHours });
    case 'jianzi_batch_auto_research': return client.post(`/api/batches/${batch}/ai/auto`, { provider: input.provider });
    case 'jianzi_batch_ranking': return client.get(`/api/batches/${batch}/ranking`);
    case 'jianzi_batch_candidates': return client.get(`/api/batches/${batch}/candidates?track=${encodeURIComponent(input.track || 'article')}&kind=${encodeURIComponent(input.kind || 'all')}`);
    case 'jianzi_candidate_add': return client.post(`/api/batches/${batch}/candidates`, { hotspotIds: input.hotspotIds, tracks: input.tracks?.length ? input.tracks : ['article'] });
    case 'jianzi_candidate_get': return client.get(`/api/candidates/${candidate}`);
    case 'jianzi_candidate_editorial_update': return client.put(`/api/candidates/${candidate}/editorial`, input.editorial);
    case 'jianzi_candidate_lock': return client.post(`/api/candidates/${candidate}/lock`, {});
    case 'jianzi_article_generate': return client.post(`/api/candidates/${candidate}/ai/article`, { provider: input.provider, skillId: input.skillId });
    case 'jianzi_article_documents': {
      if (input.candidateId && input.kind) return client.get(`/api/batches/${batch}/documents?candidateId=${encodeURIComponent(input.candidateId)}&kind=${encodeURIComponent(input.kind)}`);
      return client.get(`/api/batches/${batch}/documents`);
    }
    case 'jianzi_article_typeset': return client.post(`/api/batches/${batch}/ai/typeset`, { candidateId: input.candidateId, imageDeliveryMode: input.imageDeliveryMode || 'auto' });
    case 'jianzi_cover_generate': return client.post(`/api/candidates/${candidate}/cover/generate`, { provider: input.provider, mode: 'ai-visual' });
    case 'jianzi_card_editorial_get': return client.get(`/api/candidates/${candidate}/card-editorial`);
    case 'jianzi_card_storyboard_generate': return client.post(`/api/candidates/${candidate}/ai/card-editorial`, { provider: input.provider });
    case 'jianzi_card_editorial_update': return client.put(`/api/candidates/${candidate}/card-editorial`, { card_plan_json: JSON.stringify(input.cardPlan), output_mode: input.outputMode });
    case 'jianzi_card_lock': return client.post(`/api/candidates/${candidate}/card-lock`, {});
    case 'jianzi_card_generate': return client.post(`/api/candidates/${candidate}/ai/social-card-beautify`, { provider: input.provider, styleBrief: input.styleBrief || '' });
    case 'jianzi_job_get': return client.get(`/api/jobs/${encodeURIComponent(String(input.jobId || ''))}`);
    case 'jianzi_job_wait': {
      const timeout = Math.min(300, Math.max(1, Number(input.timeoutSeconds) || 180));
      const deadline = Date.now() + timeout * 1000;
      let job;
      do {
        job = await client.get(`/api/jobs/${encodeURIComponent(String(input.jobId || ''))}`);
        if (terminalJobStatuses.has(String(job.status || '').toLowerCase())) return job;
        if (Date.now() >= deadline) return { ...job, waitTimedOut: true };
        await pause(1500);
      } while (Date.now() < deadline);
      return { ...job, waitTimedOut: true };
    }
    default: throw Object.assign(new Error(`未知的 jianzi 工具：${name}`), { code: 'UNKNOWN_TOOL' });
  }
}

export function findJianziTool(name) { return JIANZI_TOOLS.find((tool) => tool.name === name); }
