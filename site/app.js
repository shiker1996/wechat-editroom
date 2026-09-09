const state = { data: null, view: 'overview', query: '', category: 'all' };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatDate = (value) => {
  if (!value) return '未标注时间';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value).slice(0, 10) : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

const carouselSlides = [
  { image: './assets/ui-demo.gif', kicker: '01 / FULL WORKFLOW', title: '完整工作流 GIF', description: '从总览到热点、选题、编辑和公众号排版，21 秒看完一条真实链路' },
  { image: './assets/ui-dashboard.png', kicker: '02 / WORKSPACE', title: '总览 Dashboard', description: '批次、任务与产物一眼回到工作现场' },
  { image: './assets/ui-atlas.png', kicker: '03 / HOTSPOT ATLAS', title: '热点全景', description: '从信息源进入事件与候选选题' },
  { image: './assets/ui-editorial.png', kicker: '04 / EDITORIAL ROOM', title: 'AI 编辑会', description: '把角度、事实和风险放在同一张桌上' },
  { image: './assets/ui-editor.png', kicker: '05 / DRAFTING', title: '文章编辑器', description: '成稿、审阅和版本修订' },
  { image: './assets/ui-preview.png', kicker: '06 / DELIVERY', title: '公众号预览', description: '把文章推进到可交付 HTML' },
  { image: './assets/ui-cover.png', kicker: '07 / VISUALS', title: '视觉交付', description: '封面、配图和社交图文' }
];

function initCarousel() {
  const root = $('[data-carousel]');
  if (!root) return;
  const image = $('#carousel-image');
  const kicker = $('#carousel-kicker');
  const title = $('#carousel-title');
  const description = $('#carousel-description');
  const current = $('#carousel-current');
  const total = $('#carousel-total');
  const dots = $('.carousel-dots');
  const thumbs = $('.carousel-thumbs');
  let index = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : 0;

  total.textContent = String(carouselSlides.length).padStart(2, '0');
  carouselSlides.forEach((slide, slideIndex) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'carousel-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `查看第 ${slideIndex + 1} 项内容：${slide.title}`);
    dot.addEventListener('click', () => show(slideIndex));
    dots.append(dot);

    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'carousel-thumb';
    thumb.setAttribute('role', 'tab');
    thumb.setAttribute('aria-label', `查看${slide.title}`);
    thumb.innerHTML = `<img src="${slide.image}" alt=""><span>${String(slideIndex + 1).padStart(2, '0')} ${slide.title}</span>`;
    thumb.addEventListener('click', () => show(slideIndex));
    thumbs.append(thumb);
  });

  function show(nextIndex) {
    index = (nextIndex + carouselSlides.length) % carouselSlides.length;
    const slide = carouselSlides[index];
    root.classList.add('is-switching');
    window.setTimeout(() => {
      image.src = slide.image;
      image.alt = `${slide.title}界面`;
      kicker.textContent = slide.kicker;
      title.textContent = slide.title;
      description.textContent = slide.description;
      current.textContent = String(index + 1).padStart(2, '0');
      dots.querySelectorAll('button').forEach((button, buttonIndex) => {
        const active = buttonIndex === index;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      thumbs.querySelectorAll('button').forEach((button, buttonIndex) => {
        const active = buttonIndex === index;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      root.classList.remove('is-switching');
    }, 120);
  }

  document.querySelectorAll('[data-carousel-target]').forEach((button) => button.addEventListener('click', () => show(Number(button.dataset.carouselTarget) || 0)));
  $('.carousel-prev').addEventListener('click', () => show(index - 1));
  $('.carousel-next').addEventListener('click', () => show(index + 1));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
  });
  root.tabIndex = 0;
  show(index);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('clipboard unavailable');
}

function initCopyCommands() {
  document.querySelectorAll('[data-copy-command]').forEach((button) => {
    const originalLabel = button.textContent;
    button.addEventListener('click', async () => {
      try {
        await copyText(button.dataset.copyCommand || '');
        button.textContent = '已复制';
        button.classList.add('copied');
      } catch {
        button.textContent = '请手动复制';
      }
      window.setTimeout(() => {
        button.textContent = originalLabel;
        button.classList.remove('copied');
      }, 1600);
    });
  });
}

function setMeta() {
  const { source, counts } = state.data;
  $('#snapshot-label').textContent = `生产快照 · ${source.date} · 只读`;
  $('#batch-date').textContent = `${source.date} / ${source.stage || 'review'}`;
  $('#side-hotspot-count').textContent = counts.hotspots;
  $('#side-event-count').textContent = counts.events;
  $('#side-candidate-count').textContent = counts.candidates;
}

function metric(label, value, foot) { return `<div class="metric"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><span class="metric-foot">${foot}</span></div>`; }

function renderOverview() {
  const { counts, categoryCounts, candidates, hotspots, source } = state.data;
  const max = Math.max(...categoryCounts.map((item) => item.value), 1);
  const bars = categoryCounts.slice(0, 5).map((item) => `<div class="bar-line"><span>${escapeHtml(item.label)}</span><div class="bar"><i style="width:${Math.round(item.value / max * 100)}%"></i></div><strong>${item.value}</strong></div>`).join('');
  const sourceCounts = hotspots.reduce((map, item) => { const key = item.source || '未标注来源'; map[key] = (map[key] || 0) + 1; return map; }, {});
  const sources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => `<div class="source-line"><i></i><span><b>${escapeHtml(name)}</b><small>${source.date} 更新</small></span><strong>${count}</strong></div>`).join('');
  const attention = [
    ['采集状态', `${counts.hotspots} 条`, '已进入研判池', 'attention-warm'],
    ['当前流程', '审稿', `${counts.candidates} 个候选等待编辑判断`, 'attention-mint'],
    ['待确认选题', counts.candidates, '进入文章候选池', 'attention-yellow'],
    ['成稿产物', counts.documents, '可继续排版与交付', 'attention-red'],
    ['失败任务', '0', '当前快照未记录失败', 'attention-green']
  ].map(([label, value, note, accent]) => `<div class="attention-card ${accent}"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
  const shortlist = candidates.slice(0, 4).map((item) => `<div class="mini-row"><i>${String(item.rank).padStart(2, '0')}</i><span title="${escapeHtml(item.angle || item.thesis)}">${escapeHtml(item.angle || item.thesis || item.hotspotTitle || '待补充角度')}</span><strong>${item.score || '—'}</strong></div>`).join('');
  return `<div class="tour-section-intro"><div><span class="kicker">DAILY DISPATCH</span><h2>今天，<em>推进哪一步？</em></h2></div><p>${escapeHtml(source.title)} 已进入${source.stage === 'review' ? '审稿' : '生产'}阶段；下方数据来自已审核的只读快照。</p></div><div class="dispatch-grid"><section class="dispatch-card"><div class="dispatch-top"><span>ACTIVE EDITION</span><b>${escapeHtml(source.date)}</b></div><h3>${escapeHtml(source.title)}</h3><p>热点 → 事件 → 选题 → 文章 / 图文，所有摘要和计数都停留在本地快照。</p><div class="dispatch-actions"><span class="read-only-badge">只读批次</span><span>${counts.hotspots} 热点 · ${counts.events} 事件</span></div></section><div class="metric-grid">${metric('可用热点', counts.hotspots, '当前生产批次')}${metric('已归并事件', counts.events, '去重后的事件')}${metric('候选选题', counts.candidates, '进入编辑池')}${metric('文稿产物', counts.documents, '可继续交付')}</div></div><section class="attention-board"><div class="tour-panel-head"><div><span class="kicker">TODAY'S DESK</span><h3>今日值班信号</h3></div><small>只读展示 · 不可操作</small></div><div class="attention-grid">${attention}</div></section><section class="efficiency-board"><div class="tour-panel-head"><div><span class="kicker">PRODUCTION FEEDBACK</span><h3>内部生产效率</h3></div><small>基于当前批次摘要</small></div><div class="efficiency-grid">${metric('研判覆盖', `${counts.events} / ${counts.hotspots}`, '热点已归并为事件')}${metric('选题转化', `${Math.round(counts.candidates / Math.max(counts.events, 1) * 100)}%`, '事件进入候选池')}${metric('产物输出', counts.documents, '已登记文稿产物')}${metric('数据状态', '只读', '生产快照已锁定')}</div></section><div class="desk-grid"><section class="panel"><div class="panel-head"><div><span class="kicker">ARTICLE SHORTLIST</span><b>编辑池切片</b></div><small>F SCORE</small></div><div class="mini-list">${shortlist || '<div class="empty-state">暂无候选</div>'}</div></section><section class="panel source-panel"><div class="panel-head"><div><span class="kicker">SOURCE DESK</span><b>采集席位</b></div><small>最近状态</small></div><div class="source-list">${sources || '<div class="empty-state">暂无来源</div>'}</div></section></div>`;
}

function renderHotspots() {
  const categories = [...new Set(state.data.hotspots.map((item) => item.category))];
  const filtered = state.data.hotspots.filter((item) => (state.category === 'all' || item.category === state.category) && (!state.query || `${item.title} ${item.source}`.toLowerCase().includes(state.query.toLowerCase())));
  const topEvents = state.data.events.slice(0, 4).map((item, index) => `<div class="graph-node graph-node-${index + 1}"><b>${String(item.rank).padStart(2, '0')}</b><span>${escapeHtml(item.title || '未命名事件')}</span><small>${item.hotspotCount} 条关联报道</small></div>`).join('');
  const marketCounts = state.data.hotspots.reduce((map, item) => { const key = item.market || '未标注'; map[key] = (map[key] || 0) + 1; return map; }, {});
  const coverageMax = Math.max(...Object.values(marketCounts), 1);
  const coverage = Object.entries(marketCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label, value]) => `<div class="coverage-line"><span>${escapeHtml(label)}</span><strong>${value}</strong><i style="width:${Math.round(value / coverageMax * 100)}%"></i></div>`).join('');
  const rows = filtered.slice(0, 12).map((item) => `<article class="atlas-event-row"><div class="atlas-event-rank"><strong>${String(item.rank).padStart(2, '0')}</strong><small>${item.rank <= 4 ? '新上榜' : '持续追踪'}</small></div><div class="atlas-event-copy"><div><span class="event-chip">${escapeHtml(item.category)}</span><span class="event-chip muted-chip">${escapeHtml(item.market)}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.source)} · ${formatDate(item.publishedAt)} · 当前批次已收录</p></div><div class="atlas-event-score"><strong>${item.score || '—'}</strong><small>HOTSPOT SCORE</small></div></article>`).join('');
  return `<div class="atlas-intro"><div><span class="kicker">HOTSPOT ATLAS · SEMANTIC EDITION</span></div><p>用打标后的事件语义观察媒体覆盖结构、国内关联和议题集中度；来源数与报道数分开计算。</p></div><div class="atlas-notice"><b>覆盖结构 ≠ 舆情热度</b><span>当前快照：${state.data.counts.events} 个事件 · ${state.data.counts.hotspots} 条热点</span></div><div class="atlas-controls"><div class="scope-tabs"><button class="active" type="button">全部</button><button type="button">国内</button><button type="button">全球性</button><button type="button">国外</button></div><label class="atlas-multi"><input type="checkbox" disabled> 只看多源报道</label><label class="atlas-search"><span>⌕</span><input id="demo-search" type="search" placeholder="搜索事件、关键词或来源" value="${escapeHtml(state.query)}"></label><select id="demo-category" aria-label="热点分类"><option value="all">全部分类</option>${categories.map((item) => `<option value="${escapeHtml(item)}" ${state.category === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></div><div class="atlas-mode-tabs"><span class="active">事件热榜 <small>RANKING</small></span><span>事件全景 <small>ATLAS</small></span></div><section class="atlas-board panel"><div class="atlas-board-head"><div><span class="kicker">EVENT VALUE BOARDS</span><h3>事件热榜</h3><div class="content-class-tabs"><span class="active">普通事件</span><span>开源技术</span><span>开源趋势</span><span>项目图文</span></div></div><div class="atlas-legend"><span>各类型独立评分</span><span>T 不跨类型比较</span></div></div><div class="atlas-secondary-grid"><section class="panel coverage-panel"><div class="panel-head"><div><span class="kicker">COVERAGE LEDGER</span><b>地区与来源覆盖</b></div><small>${filtered.length} 条当前筛选</small></div><div class="coverage-list">${coverage}</div></section><section class="panel graph-panel"><div class="panel-head"><div><span class="kicker">EVENT GRAPH</span><b>事件关系图</b></div><small>主体 · 动作 · 场合</small></div><div class="event-graph-preview"><span class="graph-line graph-line-one"></span><span class="graph-line graph-line-two"></span>${topEvents}</div></section></div><div class="atlas-table-head"><span>T_news 独立排序 · 默认展示前 12 条</span><strong>${filtered.length} / ${state.data.counts.hotspots}</strong></div><div class="atlas-event-list">${rows || '<div class="empty-state">没有匹配的热点</div>'}</div></section>`;
}

function renderEvents() {
  const { candidates, events } = state.data;
  const selected = candidates[0] || {};
  const strip = candidates.slice(0, 4).map((item, index) => `<div class="editorial-candidate ${index === 0 ? 'active' : ''}"><span>S${String(index + 1).padStart(2, '0')} · ${index === 0 ? '讨论中' : '待确认'}</span><b>${escapeHtml(item.angle || item.thesis || '候选命题')}</b></div>`).join('');
  const checks = ['已确认事实', '明确观点', '写作角度', '锁定命题', '证据边界', '读者后果'].map((label, index) => `<span class="gate-check ${index < 4 ? 'done' : ''}"><i>${index < 4 ? '●' : '○'}</i>${label}</span>`).join('');
  const accordions = [['FACTS & SOURCES', '关联事件', `${selected.hotspotTitle || events[0]?.title || '事件素材'} · ${events[0]?.hotspotCount || 0} 条报道`], ['DISCUSSION RESEARCH', '研判依据', '候选命题与事件关系等待编辑确认'], ['DECISION BRIEF', '决策底稿', 'AI 编辑会只读摘要；完整字段仍留在本地工作台']].map(([kicker, title, note]) => `<section class="editorial-fold"><div><span class="kicker">${kicker}</span><b>${title}</b><small>${escapeHtml(note)}</small></div><span>按需查看 ↓</span></section>`).join('');
  return `<div class="editorial-intro"><div><span class="kicker">HOTSPOT EDITORIAL ROOM</span></div><p>只处理热点事件候选：逐项确认事实、观点与实践边界，通过门禁后启动成稿链。</p></div><div class="editorial-strip"><span class="strip-arrow">‹</span>${strip}<span class="strip-arrow">›</span></div><div class="editorial-title"><span class="kicker">S001 · 综合选题</span><h2>${escapeHtml(selected.angle || selected.thesis || events[0]?.title || '当前没有可展示命题')}</h2><span class="distribution-tag">推荐池</span></div><div class="editorial-grid"><section class="editorial-chat"><div class="editorial-chat-head"><div><span class="kicker">AI EDITORIAL MEETING</span><h3>一次只对话一个关键词问题</h3></div><span class="model-pill">只读摘要 · 不调用模型</span></div><div class="editorial-note">本选题已有 ${events[0]?.hotspotCount || 0} 个来源相关原文。演示仅展示编辑会结构，不执行提问、补料或写入。</div><div class="editorial-chat-empty">尚未开始编辑会<br><small>真实工作台会在这里逐轮确认事实、观点、读者后果与实践边界。</small></div><div class="editorial-input-placeholder">备料完成后即可开始对话 <span>发送回答 / 让 AI 提问</span></div></section><aside class="editorial-aside"><section class="editorial-focus"><span class="kicker">EDITORIAL FOCUS</span><h3>本篇焦点</h3><p>${escapeHtml(selected.thesis || selected.angle || '从事件事实出发，确认值得写的角度。')}</p><div class="focus-placeholder">等待编辑室 Agent 自动选择研判拓展点</div><span class="read-only-action">查看 / 调整研判底稿</span></section><section class="drafting-gate"><div class="gate-head"><span class="kicker">DRAFTING GATE</span><strong>4 / 9</strong></div><h3>尚未达到成稿条件</h3><div class="gate-grid">${checks}</div><small>演示保留门禁形状，实际门禁由工作台根据事实与决策底稿计算。</small></section></aside></div><div class="editorial-folds">${accordions}</div>`;
}

function renderTopics() {
  const rows = state.data.candidates.map((item) => `<article class="topic-row"><div class="topic-rank"><strong>${String(item.rank).padStart(2, '0')}</strong><small>${item.rank <= 4 ? '核心候选' : '备选'}</small></div><div class="topic-copy"><div><span class="event-chip">${escapeHtml(item.poolRole || '文章候选')}</span><span class="event-chip muted-chip">${escapeHtml(item.contentClass || 'news_event')}</span></div><h4>${escapeHtml(item.angle || item.thesis || item.hotspotTitle || '待补充选题角度')}</h4><p>${escapeHtml(item.thesis || '综合事件事实与读者收益形成可写命题。')}</p></div><div class="topic-score"><strong>${item.score || '—'}</strong><small>FINAL F</small></div><span class="read-only-action">只读</span></article>`).join('');
  return `<div class="topic-intro"><div><span class="kicker">ARTICLE PITCH DESK</span></div><p>综合事件热度、模型研判、文章化质量与竞争情况，选择值得进入编辑会的文章方向。</p></div><div class="topic-workspace"><section class="candidate-board"><div class="workspace-head"><div><span class="kicker">ARTICLE SHORTLIST</span><h3>文章候选</h3></div><span class="panel-count">${state.data.candidates.length} 条</span></div><div class="scope-tabs topic-tabs"><button class="active" type="button">全部</button><button type="button">热点事件</button><button type="button">自主写作</button></div><div class="topic-pool-hint">选题请在“热点全景”中形成；只读导览保留候选评分和进入编辑会前的结构。</div><details class="score-guide"><summary>评分怎么看？</summary><div><span><b>事件热度 T</b>热度、进展、来源扩散和时效</span><span><b>研判价值 J</b>事件内外的关系与可写角度</span><span><b>文章化质量 A</b>能否写成有信息增量的文章</span><span><b>最终选题分 F</b>综合排序依据</span></div></details><div class="topic-list">${rows || '<div class="empty-state">暂无候选选题</div>'}</div></section></div>`;
}

function render() {
  if (!state.data) return;
  const titles = { overview: '生产批次总览', hotspots: '热点全景', events: '热点事件', topics: '文章选题池' };
  $('#view-title').textContent = titles[state.view];
  document.querySelectorAll('.side-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  $('#demo-content').innerHTML = state.view === 'overview' ? renderOverview() : state.view === 'hotspots' ? renderHotspots() : state.view === 'events' ? renderEvents() : renderTopics();
  $('#demo-search')?.addEventListener('input', (event) => { state.query = event.target.value; render(); const input = $('#demo-search'); input?.focus(); input?.setSelectionRange(state.query.length, state.query.length); });
  $('#demo-category')?.addEventListener('change', (event) => { state.category = event.target.value; render(); });
}

document.querySelectorAll('.side-tab').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; state.query = ''; state.category = 'all'; render(); }));
initCarousel();
initCopyCommands();

fetch('./demo-data.json', { cache: 'no-cache' }).then((response) => { if (!response.ok) throw new Error('demo-data.json not found'); return response.json(); }).then((data) => { state.data = data; setMeta(); render(); }).catch((error) => { $('#snapshot-label').textContent = '数据快照暂未生成'; $('#demo-content').innerHTML = `<div class="empty-state">无法读取演示数据。请先运行 <code>node scripts/demo/export-vercel-demo.mjs</code>。<br><small>${escapeHtml(error.message)}</small></div>`; });
