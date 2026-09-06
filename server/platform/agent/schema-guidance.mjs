// Agent 面向的工具字段说明补充层。
// 插件 Manifest 需要同时服务确定性调用和 Agent 调用，历史上字段 description 不完整；
// 这里只在 Agent 目录组装时补齐缺失说明，不修改插件原始 Manifest。

const GUIDANCE = Object.freeze({
  cap_content_url_fetch: {
    resourceId: '已授权资源目录中的网页资源 ID。', targetUrl: '要读取的公开网页地址（由服务端从授权资源解析）。',
    title: '网页标题提示，仅用于来源标注。', root: '服务端使用的授权工作区根目录，不由模型填写。', sourceFetch: '来源抓取上下文，仅使用系统提供的对象。',
  },
  cap_content_web_search: { query: '要检索的公开网页主题或具体问题。', maxResults: '最多返回的结果数；只在工具允许时填写。', timeRange: '结果时间范围：day、week、month 或 year。' },
  cap_content_news_search: { query: '要检索的新闻主题、主体或具体问题。', maxResults: '最多返回的新闻结果数；只在工具允许时填写。', timeRange: '结果时间范围：day、week、month 或 year。' },
  cap_content_research_search: { query: '用于发现研判关系证据的搜索问题。', maxResults: '最多返回的研判素材数。', sourceType: '搜索来源类型：web 或 news。' },
  cap_content_document_search: { resourceId: '已授权文档目录的资源 ID。', root: '服务端授权的文档目录，不由模型填写。', query: '要在文档中检索的关键词或问题。', maxResults: '最多返回的文档结果数。' },
  cap_content_repository_inspect: { resourceId: '已授权 GitHub 仓库资源 ID。', sourceUrl: '要分析的公开 GitHub 仓库地址（由服务端从授权资源解析）。', cacheDir: '服务端使用的缓存目录，不由模型填写。' },
  cap_content_passage_retrieve: {
    resourceIds: '要检索的已授权正文资源 ID 列表。', documents: { id: '正文资源 ID。', content: '已抓取的正文内容。' },
    query: '从正文中查找的关键词或问题。', k: '返回的相关段落数量。', headChars: '保留文档开头的字符数。', chunkChars: '段落切分的目标字符数。', maxCharsPerDoc: '每篇文档最多处理的字符数。',
  },
  cap_filesystem_project_read: {
    resourceId: '已授权本地项目资源 ID。', path: '服务端解析后的项目路径，不由模型填写。',
    options: { includePaths: '只读取的相对路径列表。', maxFiles: '最多读取的文件数。', maxFileBytes: '单个文件的最大读取字节数。', maxCharsPerFile: '单个文件最多返回的字符数。', maxTotalChars: '本次最多返回的总字符数。' },
  },
  cap_filesystem_project_document_write: {
    operation: '写入操作：begin、append、finish 或 abort。', sessionId: '当前文档写入会话 ID。', requestId: '本次 append 请求的幂等 ID。',
    path: '服务端授权的目标文档路径。', content: '要追加的 HTML/CSS 分块内容。', expectedRevision: '执行前预期的文档版本号。',
  },
  cap_diagram_mermaid_render: { inputPath: '授权工作区内的 Mermaid 输入文件路径。', outputPath: '渲染图片输出路径。', imageDir: '图片资源输出目录。', tokensPath: '可选的设计 token 文件路径。' },
  cap_diagram_echarts_render: { inputPath: '授权工作区内的 ECharts 输入文件路径。', outputPath: '渲染图片输出路径。', imageDir: '图片资源输出目录。', tokensPath: '可选的设计 token 文件路径。' },
  cap_image_cdn_upload: { localPath: '要上传的授权工作区内本地图片路径。' },
  cap_content_social_card_layout_audit: { patch: '待审计的社交卡 HTML/布局补丁数据。', page: '要审计的页码，从 1 开始。' },
  cap_content_social_card_browser_audit: { patch: '待审计的社交卡 HTML/布局补丁数据。', page: '要审计的页码，从 1 开始。' },
  cap_collect_direct: { url: 'RSS 或 Atom 订阅地址。' },
  cap_collect_rsshub: { route: 'RSSHub 路由，例如 /某平台/某账号。' },
  cap_collect_twitter: { route: 'X 账号对应的 RSSHub 路由。' },
  cap_collect_reddit: { subreddit: 'Reddit 分区名，不含 r/ 前缀。', sort: '排序方式：hot、new 或 top。', limit: '最多采集的帖子数。' },
  cap_collect_github: { createdWithinDays: '只看最近多少天创建的项目。', minStars: '项目最低 Star 数。', limit: '最多返回的项目数。' },
  cap_collect_web_page: { url: '要采集的公开静态网页地址。', itemSelector: '条目 CSS 选择器。', titleSelector: '标题 CSS 选择器。', linkSelector: '链接 CSS 选择器。', linkAttribute: '链接所在属性名，默认通常为 href。', summarySelector: '摘要 CSS 选择器。', authorSelector: '作者 CSS 选择器。', dateSelector: '日期 CSS 选择器。', dateAttribute: '日期所在属性名。', nextPageSelector: '下一页 CSS 选择器。', maxPages: '最多采集的页数。', limit: '最多返回的条目数。' },
  cap_collect_browser_page: { url: '要采集的公开网页地址。', profileId: '已配置的浏览器 Profile ID。', waitForSelector: '等待出现的 CSS 选择器。', clickSelector: '要点击的 CSS 选择器。', typeSelector: '要输入文字的 CSS 选择器。', typeValue: '要输入的文字。', waitMilliseconds: '动作后的等待毫秒数。', loginSelector: '登录完成标记 CSS 选择器。', itemSelector: '条目 CSS 选择器。', titleSelector: '标题 CSS 选择器。', linkSelector: '链接 CSS 选择器。', linkAttribute: '链接所在属性名。', summarySelector: '摘要 CSS 选择器。', authorSelector: '作者 CSS 选择器。', dateSelector: '日期 CSS 选择器。', dateAttribute: '日期所在属性名。', limit: '最多返回的条目数。' },
});

function decorateSchema(schema, guidance) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const next = { ...schema };
  if (next.properties && typeof next.properties === 'object') {
    next.properties = Object.fromEntries(Object.entries(next.properties).map(([key, child]) => {
      const hint = guidance?.[key];
      const childGuidance = hint && typeof hint === 'object' ? hint : undefined;
      const decorated = decorateSchema(child, childGuidance);
      if (hint && typeof hint === 'string' && !decorated.description) decorated.description = hint;
      return [key, decorated];
    }));
  }
  if (next.items) next.items = decorateSchema(next.items, guidance?.items);
  return next;
}

export function decorateInputSchema(capability, schema = {}) {
  return decorateSchema(structuredClone(schema), GUIDANCE[capability] || {});
}
