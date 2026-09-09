const state = { data: null, view: 'overview', query: '', category: 'all' };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatDate = (value) => {
  if (!value) return '未标注时间';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value).slice(0, 10) : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

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
  const { counts, categoryCounts, candidates, source } = state.data;
  const max = Math.max(...categoryCounts.map((item) => item.value), 1);
  const bars = categoryCounts.slice(0, 5).map((item) => `<div class="bar-line"><span>${escapeHtml(item.label)}</span><div class="bar"><i style="width:${Math.round(item.value / max * 100)}%"></i></div><strong>${item.value}</strong></div>`).join('');
  const shortlist = candidates.slice(0, 5).map((item) => `<div class="mini-row"><i>${String(item.rank).padStart(2, '0')}</i><span title="${escapeHtml(item.angle || item.thesis)}">${escapeHtml(item.angle || item.thesis || item.hotspotTitle || '待补充角度')}</span><strong>${item.score || '—'}</strong></div>`).join('');
  return `<div class="metric-grid">${metric('可用热点', counts.hotspots, '当前生产批次')}${metric('已归并事件', counts.events, '去重后的事件')}${metric('候选选题', counts.candidates, '进入编辑池')}${metric('文稿产物', counts.documents, '可继续交付')}</div><div class="overview-grid"><div class="panel"><div class="panel-head"><b>热点来源分布</b><small>${escapeHtml(source.title)}</small></div><div class="bar-list">${bars || '<div class="empty-state">暂无分类数据</div>'}</div></div><div class="panel"><div class="panel-head"><b>编辑池切片</b><small>F SCORE</small></div><div class="mini-list">${shortlist || '<div class="empty-state">暂无候选</div>'}</div></div></div>`;
}

function renderHotspots() {
  const categories = [...new Set(state.data.hotspots.map((item) => item.category))];
  const filtered = state.data.hotspots.filter((item) => (state.category === 'all' || item.category === state.category) && (!state.query || `${item.title} ${item.source}`.toLowerCase().includes(state.query.toLowerCase())));
  return `<div class="list-toolbar"><input id="demo-search" type="search" placeholder="搜索热点标题或来源…" value="${escapeHtml(state.query)}"><select id="demo-category"><option value="all">全部分类</option>${categories.map((item) => `<option value="${escapeHtml(item)}" ${state.category === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select><span class="result-count">${filtered.length} / ${state.data.counts.hotspots}</span></div><div class="data-list">${filtered.slice(0, 18).map((item) => `<article class="data-row"><span class="data-rank">${String(item.rank).padStart(2, '0')}</span><div class="data-title"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.source)} · ${escapeHtml(item.market)} · ${formatDate(item.publishedAt)}</small></div><span class="data-meta">${escapeHtml(item.category)}</span><strong class="data-score">${item.score || '—'}</strong></article>`).join('') || '<div class="empty-state">没有匹配的热点</div>'}</div>`;
}

function renderEvents() {
  return `<div class="list-toolbar"><span class="result-count">${state.data.events.length} 个事件 · 已按关联热点排序</span></div><div class="data-list">${state.data.events.map((item) => `<article class="data-row event-row"><span class="data-rank">${String(item.rank).padStart(2, '0')}</span><div class="data-title"><b>${escapeHtml(item.title || '未命名事件')}</b><small>${escapeHtml(item.who || '主体待确认')} · ${escapeHtml(item.action)} · 关联 ${item.hotspotCount} 条热点</small></div><div class="event-badges"><span class="event-badge">${escapeHtml(item.confidence)}</span><span class="event-badge">${item.articleEligible ? '可成稿' : '待确认'}</span></div></article>`).join('') || '<div class="empty-state">暂无事件研判数据</div>'}</div>`;
}

function renderTopics() {
  return `<div class="list-toolbar"><span class="result-count">${state.data.candidates.length} 个候选 · 只读展示</span></div><div class="data-list">${state.data.candidates.map((item) => `<article class="data-row candidate-row"><span class="data-rank">${String(item.rank).padStart(2, '0')}</span><div class="data-title"><b>${escapeHtml(item.angle || item.thesis || item.hotspotTitle || '待补充选题角度')}</b><span class="candidate-chip">${escapeHtml(item.poolRole)} · ${escapeHtml(item.status)}</span></div><strong class="data-score">${item.score || '—'}</strong></article>`).join('') || '<div class="empty-state">暂无候选选题</div>'}</div>`;
}

function render() {
  if (!state.data) return;
  const titles = { overview: '生产批次总览', hotspots: '热点全景', events: '事件研判', topics: '选题池' };
  $('#view-title').textContent = titles[state.view];
  document.querySelectorAll('.side-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  $('#demo-content').innerHTML = state.view === 'overview' ? renderOverview() : state.view === 'hotspots' ? renderHotspots() : state.view === 'events' ? renderEvents() : renderTopics();
  $('#demo-search')?.addEventListener('input', (event) => { state.query = event.target.value; render(); const input = $('#demo-search'); input?.focus(); input?.setSelectionRange(state.query.length, state.query.length); });
  $('#demo-category')?.addEventListener('change', (event) => { state.category = event.target.value; render(); });
}

document.querySelectorAll('.side-tab').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; state.query = ''; state.category = 'all'; render(); }));

fetch('./demo-data.json', { cache: 'no-cache' }).then((response) => { if (!response.ok) throw new Error('demo-data.json not found'); return response.json(); }).then((data) => { state.data = data; setMeta(); render(); }).catch((error) => { $('#snapshot-label').textContent = '数据快照暂未生成'; $('#demo-content').innerHTML = `<div class="empty-state">无法读取演示数据。请先运行 <code>node scripts/demo/export-vercel-demo.mjs</code>。<br><small>${escapeHtml(error.message)}</small></div>`; });
