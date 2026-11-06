const id = (description, required = true) => ({ type: 'integer', ...(required ? { minimum: 1 } : {}), description });
const string = (description, extra = {}) => ({ type: 'string', description, ...extra });
const sensitiveField = /^(?:api[_-]?key|token|secret|password|authorization|cookie|credential|credentials)$/i;

function redactSensitive(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (typeof value === 'string' && /(?:url|uri)$/i.test(key)) {
    try {
      const parsed = new URL(value);
      parsed.username = '';
      parsed.password = '';
      for (const name of [...parsed.searchParams.keys()]) if (sensitiveField.test(name)) parsed.searchParams.delete(name);
      return parsed.toString();
    } catch { return value; }
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveField.test(key) && typeof item !== 'boolean' ? { configured: item !== '' && item != null } : redactSensitive(item, key),
  ]));
}

function safeSource(source) {
  if (!source || typeof source !== 'object') return source;
  const { source_key: _sourceKey, config_json: configJson, config, ...safe } = source;
  let sourceConfig = config;
  if (!sourceConfig && typeof configJson === 'string') {
    try { sourceConfig = JSON.parse(configJson); } catch { sourceConfig = undefined; }
  }
  return redactSensitive({ ...safe, ...(sourceConfig ? { config: sourceConfig } : {}) });
}

function safeImageResult(result) {
  if (Array.isArray(result)) return result.map(safeImageResult);
  if (!result || typeof result !== 'object') return result;
  return Object.fromEntries(Object.entries(result)
    .filter(([key]) => key !== 'localPath')
    .map(([key, value]) => [key, safeImageResult(value)]));
}

export const JIANZI_TOOLS = [
  { name: 'jianzi_doctor', description: '检查见字工作台连接、Node 运行时和核心功能是否可用。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_account_profile', description: '读取账号画像，用于选题定位、语气和受众判断。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_account_profile_update', description: '保存用户确认过的账号画像。至少包含公众号名称、简介、核心读者和一个内容支柱。', inputSchema: { type: 'object', properties: { context: { type: 'object', description: '符合 account-context.json 格式的账号画像字段。' } }, required: ['context'] }, readOnlyHint: false },
  { name: 'jianzi_settings_summary', description: '读取非敏感设置与模型配置状态；不会返回 API Key、API 地址或调用日志。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_collectors_list', description: '列出可用采集器及其配置状态；秘密字段只返回是否已配置。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_collection_capabilities', description: '读取采集能力状态，包含各来源组就绪情况和 RSSHub 状态。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_collector_configuration_catalog', description: '读取采集器配置目录和字段 schema；不返回凭据值。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_collector_configuration_get', description: '读取指定采集器的配置状态与 schema，不返回已保存的秘密值。', inputSchema: { type: 'object', properties: { collectorId: string('采集器 ID。') }, required: ['collectorId'] }, readOnlyHint: true },
  { name: 'jianzi_collector_configuration_save', description: '保存用户确认的采集器配置。先读取配置 schema；凭据只提交，不复述或写入输出。', inputSchema: { type: 'object', properties: { collectorId: string('采集器 ID。'), configuration: { type: 'object', description: '按配置 schema 提供的字段。' } }, required: ['collectorId', 'configuration'] }, readOnlyHint: false },
  { name: 'jianzi_collector_configuration_test', description: '检查采集器配置是否完整。', inputSchema: { type: 'object', properties: { collectorId: string('采集器 ID。') }, required: ['collectorId'] }, readOnlyHint: false },
  { name: 'jianzi_integration_configuration_catalog', description: '列出外部 Agent 可配置的集成：采集器和又拍云图片 CDN。只返回配置 schema 与秘密字段状态。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_integration_configuration_get', description: '读取采集器或又拍云图片 CDN 的配置状态和 schema；绝不返回已保存的凭据值。', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['collector','tool'], description: '配置类型。tool 仅支持 upyun-image-upload。' }, id: string('配置资源 ID；type=tool 时必须为 upyun-image-upload。') }, required: ['type','id'] }, readOnlyHint: true },
  { name: 'jianzi_integration_configuration_save', description: '保存用户明确提供并确认的采集器或又拍云图片 CDN 配置。保存前先读取 schema；秘密字段只提交给本机工作台，工具结果不会回显凭据。', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['collector','tool'], description: '配置类型。tool 仅支持 upyun-image-upload。' }, id: string('配置资源 ID；type=tool 时必须为 upyun-image-upload。'), configuration: { type: 'object', description: '按配置 schema 提供字段；不要从对话历史推断或复述秘密。' } }, required: ['type','id','configuration'] }, readOnlyHint: false },
  { name: 'jianzi_integration_configuration_test', description: '检查采集器或又拍云图片 CDN 当前配置是否完整。此检查验证 schema 完整性，不代表外部服务连通性。', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['collector','tool'], description: '配置类型。tool 仅支持 upyun-image-upload。' }, id: string('配置资源 ID；type=tool 时必须为 upyun-image-upload。') }, required: ['type','id'] }, readOnlyHint: true },
  { name: 'jianzi_collection_sources_list', description: '列出已配置采集源及启用状态。', inputSchema: { type: 'object', properties: {} }, readOnlyHint: true },
  { name: 'jianzi_collection_source_create', description: '创建采集源；创建前先向用户确认来源和配置。', inputSchema: { type: 'object', properties: { pluginId: string('采集器 ID。'), label: string('采集源显示名称。'), config: { type: 'object', description: '与采集器 schema 对应的来源配置。' }, enabled: { type: 'boolean', description: '是否立即启用，默认 true。' } }, required: ['pluginId', 'config'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_collection_source_update', description: '修改现有采集源的名称、配置或启用状态。', inputSchema: { type: 'object', properties: { sourceId: id('采集源 ID。'), label: string('采集源显示名称。'), config: { type: 'object', description: '需修改或补充的来源配置字段。' }, enabled: { type: 'boolean' } }, required: ['sourceId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_collection_source_test', description: '测试采集源是否可以读取内容。', inputSchema: { type: 'object', properties: { sourceId: id('采集源 ID。') }, required: ['sourceId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_batches_list', description: '列出近期内容批次。', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } }, readOnlyHint: true },
  { name: 'jianzi_batch_create', description: '新建采集批次。', inputSchema: { type: 'object', properties: { date: string('批次日期 YYYY-MM-DD。'), title: string('批次标题。'), note: string('备注。') } }, readOnlyHint: false },
  { name: 'jianzi_batch_collect', description: '启动批次热点采集；返回后台任务 ID，随后用 jianzi_job_wait 查询。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), maxAgeHours: { type: 'integer', enum: [24, 48, 72, 120, 168] } }, required: ['batchId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_batch_auto_research', description: '调用见字内部模型完成批次打标、事件卡和研判自动流程；需要工作台已配置模型。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), provider: string('可选的工作台模型服务商 ID。') }, required: ['batchId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_batch_ranking', description: '查看采集批次的热点排名与候选状态，供 Agent 自行研判选题。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。') }, required: ['batchId'] }, readOnlyHint: true },
  { name: 'jianzi_batch_social_ranking', description: '查看工具与事件图文的 G_social 评分、素材类型、入池资格和预选状态；据此选择图文候选。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。') }, required: ['batchId'] }, readOnlyHint: true },
  { name: 'jianzi_research_stage_prepare', description: '在外部 Agent 完成打标和事件卡后，运行原研判 pipeline，返回下一次模型调用的完整消息、工具、输出格式与任务 ID；完成时返回原研判结果。reset=true 会清除该批次此前提交的外部阶段响应并重新研判。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), reset: { type: 'boolean' } }, required: ['batchId'] }, readOnlyHint: false },
  { name: 'jianzi_research_stage_submit', description: '提交当前阶段的模型输出：jsonMode=true 时为 JSON 对象，否则为 Markdown 字符串。原研判 pipeline 将继续校验、评分并入池。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), taskId: string('prepare 返回的任务 ID。'), output: { oneOf: [{ type: 'object' }, { type: 'string' }], description: '按任务消息与 jsonMode 生成的原始输出。' } }, required: ['batchId','taskId','output'] }, readOnlyHint: false },
  { name: 'jianzi_batch_hotspots', description: '读取批次采集热点及来源摘要，供外部 Agent 执行打标和研判；不返回凭据。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。') }, required: ['batchId'] }, readOnlyHint: true },
  { name: 'jianzi_batch_tags_submit', description: '提交外部 Agent 对批次热点的语义标签。preScores 上限：conflict/audience=20、informationGain/emotion=15、timeliness/impact/sourceReliability=10。eventParts.who/what 用于系统生成事件归并键。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), items: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, category: string('分类。'), marketScope: string('市场范围。'), chinaRelevance: { type: 'number', minimum: 0, maximum: 12 }, relevanceReason: string('相关性判断依据。'), riskLevel: string('低|中|高。'), riskReason: string('风险说明。'), score: { type: 'number', minimum: 0, maximum: 100 }, globalException: { type: 'boolean' }, eventParts: { type: 'object', properties: { who: string('主体'), what: string('动作/事实'), where: string('影响地区'), when: string('粗粒度时间'), actionType: string('动作类型'), object: string('对象'), occasion: string('命名场合') }, required: ['who','what'] }, keywords: { type: 'array', items: { type: 'string' } }, preScores: { type: 'object', properties: { conflict: { type: 'number', minimum: 0, maximum: 20 }, audience: { type: 'number', minimum: 0, maximum: 20 }, informationGain: { type: 'number', minimum: 0, maximum: 15 }, emotion: { type: 'number', minimum: 0, maximum: 15 }, timeliness: { type: 'number', minimum: 0, maximum: 10 }, impact: { type: 'number', minimum: 0, maximum: 10 }, sourceReliability: { type: 'number', minimum: 0, maximum: 10 } }, required: ['conflict','audience','informationGain','emotion','timeliness','impact','sourceReliability'] }, credibleScoop: { type: 'number' }, saturationPenalty: { type: 'number' }, duplicatePenalty: { type: 'number' }, blackHorseSignals: { type: 'array', items: { type: 'string' } } }, required: ['id','category','marketScope','chinaRelevance','relevanceReason','riskLevel','eventParts','preScores'] } } }, required: ['batchId','items'] }, readOnlyHint: false },
  { name: 'jianzi_batch_events', description: '基于已保存标签读取并稳定化批次事件分组，供外部 Agent 形成事件卡和研判。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。') }, required: ['batchId'] }, readOnlyHint: false },
  { name: 'jianzi_batch_event_cards_submit', description: '分批提交外部 Agent 为稳定事件生成的事实卡，每次最多 200 张；重复调用会按 event_id 合并。返回 completed/total/remaining；remaining 为 0 后再提交研判。工作台校验事件 ID 并归档。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), items: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', properties: { event_id: string('jianzi_batch_events 返回的稳定事件 ID。'), conclusion: string('核心结论。'), background: string('背景。'), confirmed_facts: { type: 'array', items: { type: 'string' } }, source_increment: { type: 'array', items: { type: 'object' } }, disagreements: { type: 'array', items: { type: 'string' } }, timeline: { type: 'array', items: { type: 'object' } }, unverified: { type: 'array', items: { type: 'string' } }, angles: { type: 'array', items: { type: 'string' } } }, required: ['event_id','conclusion'] } } }, required: ['batchId','items'] }, readOnlyHint: false },
  { name: 'jianzi_batch_research_submit', description: '保存外部 Agent 的事件研判与选题建议；工作台校验稳定事件和热点归属并登记研判报告。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), summary: string('批次层面的研判摘要。'), items: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', properties: { eventId: string('稳定事件 ID。'), hotspotIds: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } }, title: string('建议选题标题。'), thesis: string('选题命题。'), angle: string('文章切入角度。'), readerBenefit: string('读者利益。'), riskLevel: string('风险等级。'), riskReason: string('风险说明。'), reason: string('采用或淘汰的研判理由。'), recommendedTrack: { type: 'string', enum: ['article','social_cards'] }, scoreInputs: { type: 'object', description: '提供公式输入维度；最终分由工作台计算。H/B/J 范围 0–100，竞争扣分为 0–15/0–20。', properties: { H: { type: 'number', minimum: 0, maximum: 100 }, B: { type: 'number', minimum: 0, maximum: 100 }, J: { type: 'number', minimum: 0, maximum: 100 }, saturationPenalty: { type: 'number', minimum: 0, maximum: 15 }, duplicatePenalty: { type: 'number', minimum: 0, maximum: 20 } }, required: ['H','B','J','saturationPenalty','duplicatePenalty'] } }, required: ['eventId','hotspotIds','thesis','reason','scoreInputs'] } } }, required: ['batchId','items'] }, readOnlyHint: false },
  { name: 'jianzi_batch_research_get', description: '读取已归档的外部 Agent 选题研判报告。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。') }, required: ['batchId'] }, readOnlyHint: true },
  { name: 'jianzi_batch_candidates', description: '列出批次文章或图文候选。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), track: { type: 'string', enum: ['article', 'social_cards'] }, kind: string('文章候选过滤：all、hotspot 或 independent。') }, required: ['batchId'] }, readOnlyHint: true },
  { name: 'jianzi_candidate_add', description: '把 Agent 已研判选择的热点加入文章池或图文池。图文候选可指定事件、项目或自定义类型；不指定时按事件图文处理。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), hotspotIds: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 }, tracks: { type: 'array', items: { type: 'string', enum: ['article', 'social_cards'] } }, socialMaterialType: { type: 'string', enum: ['event', 'repository', 'custom'], description: '图文类型。事件资讯选 event；软件项目介绍选 repository；其他自定义内容选 custom。' } }, required: ['batchId', 'hotspotIds'] }, readOnlyHint: false },
  { name: 'jianzi_independent_article_create', description: '为外部 Agent 创建教程或心得文章项目，写入自主写作事实基座并建立文章候选；不启动见字内部模型。创建后由外部 Agent 按事实基座成稿，再用 jianzi_article_document_save 保存。教程需提供运行环境和至少两个步骤；核心要点至少三条，并用【体验】/【素材】/【建议】标明来源。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), articleMode: { type: 'string', enum: ['tutorial', 'experience'], description: 'tutorial 为使用教程，experience 为心得经验；默认为 tutorial。' }, topic: string('文章主题。'), audience: string('目标读者。'), thesis: string('核心观点；心得经验必填。'), environment: string('教程适用的软件、系统或版本环境；教程必填。'), points: { type: 'array', minItems: 3, items: { type: 'string' }, description: '至少三条事实或要点，每条用【体验】、【素材】或【建议】标明来源等级；可在素材项中附来源 URL。' }, materialUrls: { type: 'array', items: { type: 'string', format: 'uri' }, description: '需要抓取并保存的公开素材 URL。' }, steps: { type: 'array', minItems: 2, items: { type: 'string' }, description: '教程步骤，至少两步。' }, prerequisites: string('教程前置条件，可用换行分隔。'), expected_results: string('预期结果，可用换行分隔。'), common_errors: string('常见问题，可用换行分隔。'), creationRequestId: string('可选幂等请求 ID。') }, required: ['batchId', 'topic', 'points'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_custom_social_create', description: '创建自定义公众号/小红书图文项目并保存事实基座；不调用见字内部模型。创建后读取图文事实与门禁，制定故事板，再按图文流程审核和提交。核心要点至少三条，至少一条标注【体验】或【素材】；每条来源等级可选【体验】、【素材】、【建议】。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), contentType: { type: 'string', enum: ['tutorial', 'list', 'opinion'], description: '内容类型：教程、清单或观点。' }, channel: { type: 'string', enum: ['wechat', 'xiaohongshu'], description: '发布渠道，默认为公众号。' }, topic: string('图文主题。'), audience: string('目标读者。'), scenario: string('使用场景。'), thesis: string('核心观点。'), points: { type: 'array', minItems: 3, items: { type: 'string' }, description: '至少三条要点，每条用【体验】、【素材】或【建议】标明来源等级。' }, materialUrls: { type: 'array', items: { type: 'string', format: 'uri' }, description: '需要抓取并保存的公开素材 URL。' }, steps: { type: 'array', items: { type: 'string' }, description: '教程步骤。' }, items: { type: 'array', items: { type: 'string' }, description: '清单条目。' }, limitations: string('限制或适用边界。'), expectedPages: { type: 'integer', minimum: 4, maximum: 10, description: '建议页数。' } }, required: ['batchId', 'contentType', 'topic', 'points'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_candidate_get', description: '读取候选关联原文、来源事实、已有研判和编辑决策。返回的候选字段、抓取状态、评分和编辑记录属于内部写作上下文，只供分析，不能作为文章中的来源归因或过程叙述（例如“工作台采集到的摘要”“候选摘要显示”）。正文引用须使用读者可访问的来源名称/作者和 URL；无法核实就说明证据边界。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。') }, required: ['candidateId'] }, readOnlyHint: true },
  { name: 'jianzi_candidate_source_fetch', description: '文章成稿或图文策划前必须调用：抓取并保存候选关联热点的原文。不能以外部搜索或候选摘要代替项目抓取；失败时先向用户报告原因和证据边界。默认抓取全部关联热点，可指定 hotspotId 或 eventId。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。'), hotspotId: id('只抓取该候选关联的热点 ID。', false), eventId: string('只抓取该候选关联的事件 ID。'), force: { type: 'boolean', description: '忽略已有缓存并重新抓取。' } }, required: ['candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_candidate_editorial_update', description: '保存 Agent 形成的文章编辑判断；建议先展示用户确认，再锁题。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。'), editorial: { type: 'object', description: '编辑决策字段；confirmed_facts、research_basis、open_questions 等文本字段使用字符串或字符串数组，不能使用对象数组。adopted_research_points 和 material_brief 使用各自的结构化格式。' } }, required: ['candidateId', 'editorial'] }, readOnlyHint: false },
  { name: 'jianzi_candidate_lock', description: '锁定已完成编辑判断的文章候选，工作台会执行编辑简报门禁。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。') }, required: ['candidateId'] }, readOnlyHint: false },
  { name: 'jianzi_article_local_audit', description: '使用文章成稿流程的确定性规则检查 Markdown 结构、字数范围、标题风险和常见内部流程措辞（仅提醒，不阻断）；不代表完成事实核验或审稿。传入 articleLength 时使用该范围，否则使用默认范围。', inputSchema: { type: 'object', properties: { article: string('完整 Markdown 文章。'), factBase: { type: 'object', description: '可选事实基座。' }, articleLength: { type: 'object', properties: { min: { type: 'integer', minimum: 0, maximum: 50000 }, max: { type: 'integer', minimum: 0, maximum: 50000 } }, required: ['min','max'], description: '可选的可见字数范围，通常取自 jianzi_settings_summary.articleLength。' } }, required: ['article'] }, readOnlyHint: true },
  { name: 'jianzi_article_generate', description: '调用见字内部模型运行文章成稿流程：建立事实基座、直接写作、审稿、按需调整长度并锁定标题；需要工作台已配置模型。外部 Agent 自行写作并保存文档时无需调用此工具。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。'), provider: string('可选的工作台模型服务商 ID。'), skillId: string('可选的写作 Skill ID。') }, required: ['candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_article_documents', description: '读取批次文章文档或指定候选的草稿/终稿。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), candidateId: string('候选 ID；不填时列出批次文档。'), kind: { type: 'string', enum: ['draft', 'final', 'daily-final'] } }, required: ['batchId'] }, readOnlyHint: true },
  { name: 'jianzi_article_document_save', description: '保存外部 Agent 已完成的文章草稿或终稿，不调用见字内部模型。写作应直接依据锁定简报和事实材料生成含标题的完整 Markdown；审稿只处理已核实的事实错误、错误归因、标题误导或明确发布风险，不因观点缺少直接因果证据而追加免责声明。编辑判断获确认只表示可以开始写作；先保存 draft 并让用户审阅，用户确认已生成的文章后才保存 final。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), candidateId: id('文章候选 ID。'), kind: { type: 'string', enum: ['draft', 'final'] }, title: string('文章标题。'), content: string('文章 Markdown 正文。'), status: { type: 'string', enum: ['draft', 'review', 'final'] }, reviewState: string('可选审稿状态。') }, required: ['batchId', 'candidateId', 'kind', 'content'] }, readOnlyHint: false },
  { name: 'jianzi_calendar_list', description: '读取内容日历条目，包括文章、已交付图文和写作计划。可用 month（YYYY-MM）筛选月份；省略时读取默认日历范围。只读，不修改日历。', inputSchema: { type: 'object', properties: { month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: '可选月份，格式 YYYY-MM。' } } }, readOnlyHint: true },
  { name: 'jianzi_article_images', description: '读取文章配图工作区、占位状态和 CDN 配置状态；不会返回本地文件内容或凭据。', inputSchema: { type: 'object', properties: { candidateId: id('文章候选 ID。') }, required: ['candidateId'] }, readOnlyHint: true },
  { name: 'jianzi_article_images_plan', description: '根据已保存的文章终稿规划配图占位，并更新终稿与配图资产清单。', inputSchema: { type: 'object', properties: { candidateId: id('文章候选 ID。'), provider: string('可选的工作台模型服务商 ID。') }, required: ['candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_article_image_generate', description: '为指定的可生成配图占位生成图片并保存到本地工作区。', inputSchema: { type: 'object', properties: { candidateId: id('文章候选 ID。'), imageId: string('jianzi_article_images 返回的配图占位 ID。') }, required: ['candidateId','imageId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_article_image_upload', description: '将指定配图上传到已配置的 CDN 并返回公开地址；这是外部写入操作，只在用户明确要求上传时调用。', inputSchema: { type: 'object', properties: { candidateId: id('文章候选 ID。'), imageId: string('jianzi_article_images 返回的配图占位 ID。') }, required: ['candidateId','imageId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_article_typeset', description: '调用见字内部模型与排版流程生成公众号 HTML；需要工作台已配置模型。成功后返回文章预览入口；在最终回复中附上该链接。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), candidateId: id('候选 ID。', true), imageDeliveryMode: { type: 'string', enum: ['auto', 'local', 'cdn'] } }, required: ['batchId', 'candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_article_typeset_submit', description: '提交外部 Agent 生成的文章 HTML。仅在 jianzi_article_documents 已确认存在 final 后调用；若只有 draft，应先让用户审阅确认，不要提交。工作台负责结构保真、公众号规范化、确定性门禁和产物归档；不调用工作台模型。成功后返回文章预览入口；在最终回复中附上该链接。', inputSchema: { type: 'object', properties: { batchId: string('批次 ID。'), candidateId: id('文章候选 ID。'), html: { type: 'string', minLength: 1, maxLength: 8000000, description: '基于终稿和排版设计方案生成的完整 HTML。' }, designScheme: { type: 'object', description: '本次文章排版设计方案，用于随 HTML 归档。' } }, required: ['batchId','candidateId','html'] }, readOnlyHint: false },
  { name: 'jianzi_cover_generate', description: '为已完成的文章终稿生成 AI 视觉封面；调用工作台内部模型。成功后返回封面入口；在最终回复中附上该链接。', inputSchema: { type: 'object', properties: { candidateId: id('候选 ID。'), provider: string('可选的工作台模型服务商 ID。') }, required: ['candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_cover_submit', description: '提交外部 Agent 生成的 900×383 封面 HTML。工作台执行内容门禁、浏览器截图和产物归档；不调用工作台模型。成功后返回封面入口；在最终回复中附上该链接。', inputSchema: { type: 'object', properties: { candidateId: id('文章候选 ID。'), html: { type: 'string', minLength: 1, maxLength: 2000000 }, designScheme: { type: 'object', description: '本篇封面设计方案与约束说明，用于随产物归档。' } }, required: ['candidateId','html'] }, readOnlyHint: false },
  { name: 'jianzi_card_editorial_get', description: '读取图文故事板、图文事实基座和设计状态。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。') }, required: ['candidateId'] }, readOnlyHint: true },
  { name: 'jianzi_card_storyboard_generate', description: '调用见字内部模型生成图文故事板；需要工作台已配置模型。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。'), provider: string('可选的工作台模型服务商 ID。') }, required: ['candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_card_editorial_update', description: '保存外部 Agent 的图文编辑方案和故事板。读者、痛点、来源披露与禁止表达字段用于通过工作台门禁；工作台在锁定时校验故事板。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。'), cardPlan: { type: 'array', minItems: 1, items: { type: 'object' } }, outputMode: string('可选发布渠道与内容类型。'), targetReader: string('目标读者。'), painPoint: string('读者的核心问题或传播问题。'), toolPositioning: string('内容定位；仓库或工具图文适用。'), mustHighlight: string('必须突出说明的事实或能力。'), mustDisclose: string('未核实内容、来源边界、限制或安装边界。'), gettingStarted: string('必要的上手说明。'), forbiddenClaims: string('不得出现的表达或未经证实的主张。'), recommendedPages: { type: 'integer', minimum: 4, maximum: 10, description: '建议故事板页数。' }, compositionMode: string('可选构图模式。'), layoutStyle: string('可选整体版式。') }, required: ['candidateId', 'cardPlan'] }, readOnlyHint: false },
  { name: 'jianzi_card_lock', description: '锁定图文故事板并执行 CARD GATE。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。') }, required: ['candidateId'] }, readOnlyHint: false },
  { name: 'jianzi_card_visual_audit', description: '在图文生成过程中对草稿 HTML 执行浏览器布局审计，可指定单页或审计整组；不保存产物。按报告修正后再提交。', inputSchema: { type: 'object', properties: { candidateId: id('已锁定故事板的图文候选 ID。'), html: { type: 'string', minLength: 1, maxLength: 10000000 }, page: { type: 'integer', minimum: 1, description: '可选：仅审计该页；省略则审计全部页面。' } }, required: ['candidateId','html'] }, readOnlyHint: true },
  { name: 'jianzi_card_generate', description: '调用见字内部模型生成 AI 视觉图文 HTML/PNG，并执行布局审计；需要工作台已配置模型。成功后返回事件图文入口；在最终回复中附上该链接。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。'), provider: string('可选的工作台模型服务商 ID。'), styleBrief: string('可选视觉方向说明。') }, required: ['candidateId'] }, readOnlyHint: false, openWorldHint: true },
  { name: 'jianzi_card_visual_submit', description: '提交外部 Agent 生成的图文 HTML 与配套文案。工作台执行故事板页数校验、浏览器溢出审计、截图和产物归档；不调用工作台模型。成功后返回事件图文入口；在最终回复中附上该链接。', inputSchema: { type: 'object', properties: { candidateId: id('图文候选 ID。'), html: { type: 'string', minLength: 1, maxLength: 10000000 }, publishTitle: string('发布标题。',{maxLength:120}), copy: string('配套文案，最长 50 KB，末尾需有至少三个话题标签。',{maxLength:50000}), designScheme: { type: 'object', description: '本次图文设计方案，JSON 大小不得超过 250 KB，用于随 HTML/PNG 归档。' } }, required: ['candidateId','html','copy'] }, readOnlyHint: false },
  { name: 'jianzi_job_get', description: '读取后台任务状态、错误信息和进度。', inputSchema: { type: 'object', properties: { jobId: string('任务 ID。') }, required: ['jobId'] }, readOnlyHint: true },
  { name: 'jianzi_job_wait', description: '轮询后台任务直到结束或超时，返回最终产物索引。', inputSchema: { type: 'object', properties: { jobId: string('任务 ID。'), timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 } }, required: ['jobId'] }, readOnlyHint: true },
];

const terminalJobStatuses = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'stopped']);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withArtifactEntry(client, result, type, candidateId = null) {
  const entries = {
    articlePreview: { label: '文章预览', path: '/#preview' },
    cover: { label: '文章封面', path: '/#cover' },
  };
  let entry = entries[type];
  if (type === 'socialCards') {
    const resolvedCandidateId = result?.candidateId || candidateId;
    if (resolvedCandidateId) {
      try {
        const editorial = await client.get(`/api/candidates/${encodeURIComponent(String(resolvedCandidateId))}/card-editorial`);
        const contentType = String(editorial?.contentType || '');
        entry = ({
          repository: { label: '工具图文', path: '/#social-editor' },
          event: { label: '事件图文', path: '/#social-event' },
          custom: { label: '自定义图文', path: '/#social-custom' },
        })[contentType];
      } catch {}
    }
  }
  if (!entry || !result || typeof result !== 'object' || result.status === 'failed') return result;
  const baseUrl = String(client.baseUrl || 'http://127.0.0.1:4317').replace(/\/$/, '');
  return { ...result, artifactEntries: [{ type, label: entry.label, url: `${baseUrl}${entry.path}` }] };
}

function artifactTypeForJob(job) {
  return ({ typeset: 'articlePreview', 'cover-image': 'cover', 'social-card-beautify': 'socialCards' })[String(job?.type || '')] || '';
}

export async function executeJianziTool(client, name, input = {}) {
  const batch = encodeURIComponent(String(input.batchId || ''));
  const candidate = encodeURIComponent(String(input.candidateId || ''));
  switch (name) {
    case 'jianzi_doctor': {
      const [health, batches] = await Promise.all([client.get('/api/system/health'), client.get('/api/batches?limit=1')]);
      return { connected: true, node: health.node, health, sampleBatchCount: Array.isArray(batches) ? batches.length : 0 };
    }
    case 'jianzi_account_profile': return client.get('/api/system/account-context');
    case 'jianzi_account_profile_update': return client.put('/api/system/account-context', input.context || {});
    case 'jianzi_settings_summary': {
      const [settings, models] = await Promise.all([client.get('/api/system/settings'), client.get('/api/models')]);
      return {
        rsshub: (settings.rsshub || []).map(({ key, label, configured, secret }) => ({ key, label, configured: Boolean(configured), secret: Boolean(secret) })),
        articleLength: settings.articleLength || null,
        defaultProvider: models.defaultProvider || '',
        providers: (models.providers || []).map(({ name, label, model, configured, enabled }) => ({ name, label, model, configured: Boolean(configured), enabled: enabled !== false })),
      };
    }
    case 'jianzi_collectors_list': {
      const data = await client.get('/api/collector-plugins');
      return { items: (data.items || []).map((item) => redactSensitive({
        id: item.id,
        name: item.name,
        enabled: item.enabled,
        available: item.available,
        executionStatus: item.executionStatus,
        sourceCount: item.sourceCount,
        sourceTypes: item.collector?.sourceTypes || [],
        sourceConfigSchema: item.collector?.sourceConfigSchema || item.inputSchema || null,
        configurationState: item.configurationState || null,
      })) };
    }
    case 'jianzi_collection_capabilities': return client.get('/api/collection-capabilities');
    case 'jianzi_collector_configuration_catalog': {
      const data = await client.get('/api/system/configuration/catalog');
      return { items: (data.items || []).filter((item) => item.type === 'collector').map(redactSensitive) };
    }
    case 'jianzi_collector_configuration_get': return redactSensitive(await client.get(`/api/system/configuration/collector/${encodeURIComponent(String(input.collectorId || ''))}`));
    case 'jianzi_collector_configuration_save': return redactSensitive(await client.put(`/api/system/configuration/collector/${encodeURIComponent(String(input.collectorId || ''))}`, input.configuration || {}));
    case 'jianzi_collector_configuration_test': return redactSensitive(await client.post(`/api/system/configuration/collector/${encodeURIComponent(String(input.collectorId || ''))}/test`, {}));
    case 'jianzi_integration_configuration_catalog': {
      const data = await client.get('/api/system/configuration/catalog');
      return { items: (data.items || []).filter((item) => item.type === 'collector' || (item.type === 'tool' && item.id === 'upyun-image-upload')) };
    }
    case 'jianzi_integration_configuration_get':
    case 'jianzi_integration_configuration_save':
    case 'jianzi_integration_configuration_test': {
      const type = String(input.type || '');
      const resourceId = String(input.id || '');
      if (!['collector','tool'].includes(type) || (type === 'tool' && resourceId !== 'upyun-image-upload')) throw new Error('仅支持采集器和 upyun-image-upload 图片上传配置');
      if (type === 'collector') {
        const data = await client.get('/api/system/configuration/catalog');
        if (!(data.items || []).some((item) => item.type === 'collector' && item.id === resourceId)) throw new Error('采集器配置资源不存在或不允许通过 MCP 配置');
      }
      const resourcePath = `/api/system/configuration/${encodeURIComponent(type)}/${encodeURIComponent(resourceId)}`;
      if (name === 'jianzi_integration_configuration_get') return client.get(resourcePath);
      if (name === 'jianzi_integration_configuration_save') return client.put(resourcePath, input.configuration || {});
      return client.post(`${resourcePath}/test`, {});
    }
    case 'jianzi_collection_sources_list': {
      const data = await client.get('/api/collection-sources');
      return { ...data, items: (data.items || []).map(safeSource) };
    }
    case 'jianzi_collection_source_create': return safeSource(await client.post('/api/collection-sources', { pluginId: input.pluginId, label: input.label, config: input.config || {}, enabled: input.enabled !== false }));
    case 'jianzi_collection_source_update': return safeSource(await client.patch(`/api/collection-sources/${encodeURIComponent(String(input.sourceId || ''))}`, { label: input.label, config: input.config, enabled: input.enabled }));
    case 'jianzi_collection_source_test': return client.post(`/api/collection-sources/${encodeURIComponent(String(input.sourceId || ''))}/test`, {});
    case 'jianzi_batches_list': return client.get(`/api/batches?limit=${Math.min(100, Math.max(1, Number(input.limit) || 30))}`);
    case 'jianzi_batch_create': return client.post('/api/batches', { date: input.date, title: input.title, note: input.note });
    case 'jianzi_batch_collect': return client.post(`/api/batches/${batch}/collect`, { maxAgeHours: input.maxAgeHours });
    case 'jianzi_batch_auto_research': return client.post(`/api/batches/${batch}/ai/auto`, { provider: input.provider });
    case 'jianzi_batch_ranking': return client.get(`/api/batches/${batch}/ranking`);
    case 'jianzi_batch_social_ranking': return client.get(`/api/batches/${batch}/social-ranking`);
    case 'jianzi_research_stage_prepare': return client.post(`/api/batches/${batch}/external/research-stage/prepare`, { reset: input.reset === true });
    case 'jianzi_research_stage_submit': return client.post(`/api/batches/${batch}/external/research-stage/submit`, { taskId: input.taskId, output: input.output });
    case 'jianzi_batch_hotspots': {
      const data = await client.get(`/api/batches/${batch}`);
      return { batchId: data.id, hotspots: (data.hotspots || []).map((item) => { let raw = {}; try { raw = JSON.parse(item.raw_json || '{}'); } catch {} return { id: item.id, title: item.title, url: item.url, source: item.source, sourceGroup: item.source_group, sourceType: item.source_type, sourceName: item.source_name, publishedAt: item.published_at, researchEligible: item.research_eligible !== 0, summary: String(raw.summary || raw.description || '').slice(0, 4000), content: String(raw.content || raw.text || '').slice(0, 8000), repository: raw.repository || '', language: raw.language || '', stars: raw.stars ?? null, topics: (raw.topics || []).slice(0, 30), projectType: raw.projectType || '', scenarioIds: (raw.scenarioIds || []).slice(0, 30), directUseCase: raw.directUseCase || '', agentDependency: raw.agentDependency || '', agentSignals: (raw.agentSignals || []).slice(0, 12), discoveryContexts: (raw.discoveryContexts || []).slice(0, 12) }; }) };
    }
    case 'jianzi_batch_tags_submit': return client.post(`/api/batches/${batch}/external/tags`, { items: input.items || [] });
    case 'jianzi_batch_events': return client.get(`/api/batches/${batch}/external/events`);
    case 'jianzi_batch_event_cards_submit': return client.post(`/api/batches/${batch}/external/event-cards`, { items: input.items || [] });
    case 'jianzi_batch_research_submit': return client.post(`/api/batches/${batch}/external/research`, { summary: input.summary || '', items: input.items || [] });
    case 'jianzi_batch_research_get': return client.get(`/api/batches/${batch}/external/research`);
    case 'jianzi_batch_candidates': return client.get(`/api/batches/${batch}/candidates?track=${encodeURIComponent(input.track || 'article')}&kind=${encodeURIComponent(input.kind || 'all')}`);
    case 'jianzi_candidate_add': {
      const tracks = input.tracks?.length ? input.tracks : ['article'];
      const socialMaterialType = input.socialMaterialType || (tracks.includes('social_cards') ? 'event' : undefined);
      return client.post(`/api/batches/${batch}/candidates`, { hotspotIds: input.hotspotIds, tracks, ...(socialMaterialType ? { socialMaterialType } : {}) });
    }
    case 'jianzi_independent_article_create': {
      const { batchId: _batchId, ...payload } = input;
      return redactSensitive(await client.post(`/api/batches/${batch}/tutorials`, { ...payload, deferGeneration: true }));
    }
    case 'jianzi_custom_social_create': {
      const { batchId: _batchId, contentType, expectedPages, ...payload } = input;
      return redactSensitive(await client.post(`/api/batches/${batch}/custom-social-candidates`, {
        ...payload,
        content_type: contentType,
        expected_pages: expectedPages,
        channel: payload.channel === 'xiaohongshu' ? 'xiaohongshu' : 'wechat',
      }));
    }
    case 'jianzi_candidate_get': {
      const result = await client.get(`/api/candidates/${candidate}`);
      if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
      return {
        ...result,
        agent_guidance: {
          sourceRecords: ['source_document', 'events[].hotspots[].sourceDoc', 'materials'],
          sourceRule: 'Only attribute claims to a reader-accessible source record after checking its title, publisher, URL, and content. A candidate summary or editorial note is not itself a source.',
          internalContextOnly: ['hotspot_raw_json', 'editorial', 'events[].card', 'tracks', 'scores', 'candidate/batch IDs', 'fetch status and quality metadata'],
          writingRule: 'Do not narrate internal workflow in reader-facing copy (for example, "工作台采集到的摘要" or "候选摘要显示"). Explain uncertainty in terms of what the public source does or does not establish.',
        },
      };
    }
    case 'jianzi_candidate_source_fetch': return client.post(`/api/candidates/${candidate}/source`, { hotspotId: input.hotspotId, eventId: input.eventId, force: input.force === true });
    case 'jianzi_candidate_editorial_update': return client.put(`/api/candidates/${candidate}/editorial`, input.editorial);
    case 'jianzi_candidate_lock': return client.post(`/api/candidates/${candidate}/lock`, {});
    case 'jianzi_article_local_audit': return client.post('/api/external/article/local-audit', { article: input.article, factBase: input.factBase, articleLength: input.articleLength });
    case 'jianzi_article_generate': return client.post(`/api/candidates/${candidate}/ai/article`, { provider: input.provider, skillId: input.skillId });
    case 'jianzi_article_documents': {
      if (input.candidateId && input.kind) return client.get(`/api/batches/${batch}/documents?candidateId=${encodeURIComponent(input.candidateId)}&kind=${encodeURIComponent(input.kind)}`);
      return client.get(`/api/batches/${batch}/documents`);
    }
    case 'jianzi_calendar_list': {
      const month = String(input.month || '').trim();
      return client.get(`/api/calendar${month ? `?month=${encodeURIComponent(month)}` : ''}`);
    }
    case 'jianzi_article_document_save': return client.put(`/api/batches/${batch}/documents`, { candidateId: input.candidateId, kind: input.kind, title: input.title || '', content: input.content || '', status: input.status || (input.kind === 'final' ? 'review' : 'draft'), reviewState: input.reviewState || null });
    case 'jianzi_article_images': return safeImageResult(await client.get(`/api/candidates/${candidate}/images`));
    case 'jianzi_article_images_plan': return safeImageResult(await client.post(`/api/candidates/${candidate}/images/plan`, { provider: input.provider }));
    case 'jianzi_article_image_generate': return safeImageResult(await client.post(`/api/candidates/${candidate}/images/${encodeURIComponent(String(input.imageId || ''))}/generate`, {}));
    case 'jianzi_article_image_upload': return safeImageResult(await client.post(`/api/candidates/${candidate}/images/${encodeURIComponent(String(input.imageId || ''))}/cdn`, {}));
    case 'jianzi_article_typeset': return withArtifactEntry(client, await client.post(`/api/batches/${batch}/ai/typeset`, { candidateId: input.candidateId, imageDeliveryMode: input.imageDeliveryMode || 'auto' }), 'articlePreview');
    case 'jianzi_article_typeset_submit': return withArtifactEntry(client, await client.post(`/api/batches/${batch}/external/typeset`, { candidateId: input.candidateId, html: input.html || '', designScheme: input.designScheme || null }), 'articlePreview');
    case 'jianzi_cover_generate': return withArtifactEntry(client, await client.post(`/api/candidates/${candidate}/cover/generate`, { provider: input.provider, mode: 'ai-visual' }), 'cover');
    case 'jianzi_cover_submit': return withArtifactEntry(client, await client.post(`/api/candidates/${candidate}/cover/external`, { html: input.html || '', designScheme: input.designScheme || null }), 'cover');
    case 'jianzi_card_editorial_get': return client.get(`/api/candidates/${candidate}/card-editorial`);
    case 'jianzi_card_storyboard_generate': return client.post(`/api/candidates/${candidate}/ai/card-editorial`, { provider: input.provider });
    case 'jianzi_card_editorial_update': {
      const fields = { output_mode: input.outputMode, target_reader: input.targetReader, pain_point: input.painPoint, tool_positioning: input.toolPositioning, must_highlight: input.mustHighlight, must_disclose: input.mustDisclose, getting_started: input.gettingStarted, forbidden_claims: input.forbiddenClaims, recommended_pages: input.recommendedPages, composition_mode: input.compositionMode, layout_style: input.layoutStyle };
      return client.put(`/api/candidates/${candidate}/card-editorial`, { card_plan_json: JSON.stringify(input.cardPlan), ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) });
    }
    case 'jianzi_card_lock': return client.post(`/api/candidates/${candidate}/card-lock`, {});
    case 'jianzi_card_visual_audit': return client.post(`/api/candidates/${candidate}/social-cards/external/audit`, { html: input.html || '', page: input.page ?? null });
    case 'jianzi_card_generate': return withArtifactEntry(client, await client.post(`/api/candidates/${candidate}/ai/social-card-beautify`, { provider: input.provider, styleBrief: input.styleBrief || '' }), 'socialCards', candidate);
    case 'jianzi_card_visual_submit': return withArtifactEntry(client, await client.post(`/api/candidates/${candidate}/social-cards/external`, { html: input.html || '', publishTitle: input.publishTitle || '', copy: input.copy || '', designScheme: input.designScheme || null }), 'socialCards', candidate);
    case 'jianzi_job_get': {
      const job = await client.get(`/api/jobs/${encodeURIComponent(String(input.jobId || ''))}`);
      return withArtifactEntry(client, job, artifactTypeForJob(job), job.candidateId);
    }
    case 'jianzi_job_wait': {
      const timeout = Math.min(300, Math.max(1, Number(input.timeoutSeconds) || 180));
      const deadline = Date.now() + timeout * 1000;
      let job;
      do {
        job = await client.get(`/api/jobs/${encodeURIComponent(String(input.jobId || ''))}`);
        if (terminalJobStatuses.has(String(job.status || '').toLowerCase())) return withArtifactEntry(client, job, artifactTypeForJob(job), job.candidateId);
        if (Date.now() >= deadline) return withArtifactEntry(client, { ...job, waitTimedOut: true }, artifactTypeForJob(job), job.candidateId);
        await pause(1500);
      } while (Date.now() < deadline);
      return withArtifactEntry(client, { ...job, waitTimedOut: true }, artifactTypeForJob(job), job?.candidateId);
    }
    default: throw Object.assign(new Error(`未知的 jianzi 工具：${name}`), { code: 'UNKNOWN_TOOL' });
  }
}

export function findJianziTool(name) { return JIANZI_TOOLS.find((tool) => tool.name === name); }
