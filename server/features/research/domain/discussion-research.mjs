import { dimensionPartsOf } from './hotspot-dimensions.mjs';

export const DISCUSSION_RESEARCH_SCHEMA_VERSION = 3;
// 讨论研判只处理 T 榜前若干个非项目事件；其余事件保留在热榜和普通流程中。
export const DISCUSSION_RESEARCH_TOP_K_OPTIONS = Object.freeze([5, 8, 10]);
export const DISCUSSION_RESEARCH_TOP_K = 8;

export function resolveDiscussionResearchTopK(value) {
  const normalized = Number(value);
  return DISCUSSION_RESEARCH_TOP_K_OPTIONS.includes(normalized) ? normalized : DISCUSSION_RESEARCH_TOP_K;
}
export const DISCUSSION_RESEARCH_EXCLUDED_CONTENT_CLASSES = Object.freeze(['github_project']);

const text = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : [];
const idOf = (event) => String(event?.event_id || event?.eventId || '').trim();
const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function contentClassOf(event, heat) {
  return String(
    heat?.contentClass || heat?.content_class
      || event?.contentClass || event?.content_class
      || event?.classification?.contentClass || event?.classification?.content_class || '',
  ).trim();
}

function eventDate(event) {
  const timestamp = Date.parse(String(event?.latest_time || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalized(value) {
  return text(value, 100).toLocaleLowerCase().replace(/[\s“”‘’'"`·、，。！？：；（）()【】\[\]{}<>《》]/g, '');
}

function dedupeSemanticSignals(items, limit = 8) {
  const grouped = new Map();
  for (const item of list(items)) {
    const key = [item?.kind, item?.statement, item?.question].map(normalized).join('|');
    if (!key.replace(/\|/g, '')) continue;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...item,
        basis: [...new Set(list(item?.basis).map((value) => text(value, 180)).filter(Boolean))].slice(0, 8),
        evidence_items: item?.evidence ? [item.evidence] : [],
      });
      continue;
    }
    existing.basis = [...new Set([
      ...list(existing.basis),
      ...list(item?.basis).map((value) => text(value, 180)).filter(Boolean),
    ])].slice(0, 8);
    const evidenceKey = new Set(list(existing.evidence_items).map((value) => JSON.stringify(value)));
    if (item?.evidence && !evidenceKey.has(JSON.stringify(item.evidence))) existing.evidence_items.push(item.evidence);
    if (item?.status === 'needs_review') existing.status = 'needs_review';
  }
  return [...grouped.values()].map((item) => ({
    ...item,
    evidence_items: item.evidence_items.slice(0, 8),
    evidence_count: item.evidence_items.length,
  })).slice(0, limit);
}

function sourceEvidenceLevel(article = {}) {
  if (text(article?.content) || text(article?.full_text) || text(article?.fullText)) return 'full_text';
  if (text(article?.summary) || text(article?.description)) return 'summary_only';
  if (article?.repositoryMeta || article?.repository_meta) return 'repository_meta';
  return 'title_only';
}

function sourceRefs(event) {
  return list(event?.articles).slice(0, 8).map((article, index) => ({
    source_id: text(article?.source_id || (article?.hotspot_id != null ? `hotspot:${article.hotspot_id}` : article?.category_id || `source:${index + 1}`), 80),
    title: text(article?.title, 140),
    source: text(article?.source, 60),
    url: text(article?.url, 300) || null,
    evidence_level: sourceEvidenceLevel(article),
  }));
}

function eventScope(event, heat, rank, reason) {
  const sources = sourceRefs(event);
  return {
    event_id: idOf(event),
    rank,
    t: finite(heat?.t ?? heat?.eventValue ?? event?.t),
    event_value: finite(heat?.eventValue ?? event?.eventValue ?? event?.t),
    event_heat_score: finite(heat?.heatScore ?? event?.eventHeatScore),
    event_heat_state: text(heat?.state || event?.eventHeatState, 40) || null,
    title: text(event?.representative_title, 180),
    latest_time: text(event?.latest_time, 50) || null,
    source_count: finite(event?.source_count, 0),
    report_count: finite(event?.report_count, 0),
    source_ids: sources.map((source) => source.source_id),
    source_evidence_levels: Object.fromEntries(sources.map((source) => [source.source_id, source.evidence_level])),
    source_refs: sources,
    included_reason: reason,
  };
}

function internalSignalsFor(event) {
  const card = event?.card || {};
  const anomalies = [];
  const conflicts = [];
  const divergences = [];
  const anomalyPoints = [];
  const interestConflicts = [];
  const divergenceDirections = [];
  const timeline = list(card.timeline).filter((item) => text(item?.fact));
  const increments = list(card.source_increment).filter((item) => text(item?.adds) || text(item?.source));
  const disagreements = list(card.disagreements).map((item) => text(item)).filter(Boolean);
  const unverified = list(card.unverified).map((item) => text(item)).filter(Boolean);

  if (timeline.length > 1) {
    anomalies.push({
      kind: 'timeline_change',
      statement: `事件卡记录了 ${timeline.length} 个时间节点，存在前后变化待解释`,
      evidence: { field: 'card.timeline', items: timeline.slice(0, 5) },
    });
    anomalyPoints.push({
      kind: 'anomaly',
      label: '反常',
      statement: `这不是一个单点事件：事件卡记录了 ${timeline.length} 个时间节点，前后状态或动作发生了变化。`,
      expected: '如果只是一次性动作，后续不应出现新的动作或状态变化。',
      observation: timeline.slice(0, 4).map((item) => `${text(item.time, 40)}：${text(item.fact, 120)}`).join('；'),
      why_it_matters: '变化本身可能比最初那条新闻更值得解释。',
      evidence: { field: 'card.timeline', items: timeline.slice(0, 5) },
    });
    divergenceDirections.push({
      kind: 'divergence', label: '可发散方向',
      question: '这次前后变化，是策略调整、执行问题，还是外部压力导致的？',
      statement: '围绕时间线变化追问原因，而不是重复描述发生了什么。',
      basis: timeline.slice(0, 3).map((item) => text(item.fact, 120)),
      evidence: { field: 'card.timeline', items: timeline.slice(0, 5) },
    });
  }
  for (const item of increments) {
    anomalies.push({
      kind: 'new_source_evidence',
      statement: `来源${item.source ? `「${item.source}」` : ''}补充了：${text(item.adds)}`,
      evidence: { field: 'card.source_increment', item: { source: text(item.source, 60), adds: text(item.adds) } },
    });
    divergenceDirections.push({
      kind: 'divergence', label: '可发散方向',
      question: '新增信息是否改变了事件原先的解释？谁因此获得了更多信息或承担了更多成本？',
      statement: `从新增信息追问事件影响，而不是把来源增量当作另一条新闻。`,
      basis: [text(item.adds, 150)],
      evidence: { field: 'card.source_increment', item: { source: text(item.source, 60), adds: text(item.adds) } },
    });
  }
  for (const statement of disagreements) {
    conflicts.push({ kind: 'source_disagreement', statement, evidence: { field: 'card.disagreements', statement } });
    const parties = [...new Set((statement.match(/官方|公司|平台|开发者|用户|员工|消费者|投资者|监管|创作者|客户/g) || []))];
    if (parties.length >= 2) {
      interestConflicts.push({
        kind: 'interest_conflict', label: '利益冲突', parties,
        object: '事件的收益、成本、责任或解释权', difference: statement,
        statement: `可能存在${parties.join('与')}之间的利益或立场冲突：${statement}`,
        confidence: 'needs_review', evidence: { field: 'card.disagreements', statement },
      });
    }
    divergenceDirections.push({
      kind: 'divergence', label: '可发散方向',
      question: '不同说法背后，是事实范围不同、立场不同，还是利益不同？',
      statement: '先区分信息分歧与利益冲突，不能把来源分歧直接写成冲突结论。',
      basis: [statement], evidence: { field: 'card.disagreements', statement }, status: 'needs_review',
    });
  }
  for (const statement of unverified) {
    divergences.push({ kind: 'unverified_boundary', statement, evidence: { field: 'card.unverified', statement } });
    divergenceDirections.push({
      kind: 'divergence', label: '可发散方向',
      question: `“${text(statement, 120)}”如果得到确认，会改变谁的判断或利益？`,
      statement: '把未确认信息转成待验证的问题，不把它当成事实使用。',
      basis: [statement], evidence: { field: 'card.unverified', statement }, status: 'needs_review',
    });
  }

  const explicitConflicts = list(card.interest_conflicts || card.conflicts || card.tradeoffs);
  for (const item of explicitConflicts) {
    const statement = typeof item === 'string' ? text(item) : text(item?.statement || item?.difference || item?.tradeoff);
    if (!statement) continue;
    interestConflicts.push({
      kind: 'interest_conflict', label: '利益冲突',
      parties: list(typeof item === 'object' ? item.parties || item.stakeholders : []).map((value) => text(value, 80)).filter(Boolean),
      object: text(typeof item === 'object' ? item.object || item.issue : '') || '事件中的资源、责任或收益分配',
      difference: statement, statement, confidence: 'needs_review',
      evidence: { field: 'card.interest_conflicts', item },
    });
  }

  return {
    event_id: idOf(event),
    title: text(event?.representative_title, 180),
    status: 'observation_only',
    anomalies: anomalies.slice(0, 8),
    conflicts: conflicts.slice(0, 8),
    divergences: divergences.slice(0, 8),
    // 旧数组保留给已有评分和接口；以下三组才是面向编辑的语义研判。
    anomaly_points: anomalyPoints.slice(0, 6),
    interest_conflicts: interestConflicts.slice(0, 6),
    divergence_directions: dedupeSemanticSignals(divergenceDirections),
    internal_research: {
      anomalies: anomalyPoints.slice(0, 6),
      interest_conflicts: interestConflicts.slice(0, 6),
      divergence_directions: dedupeSemanticSignals(divergenceDirections),
      conflict_note: explicitConflicts.length ? '' : '事件卡没有提供可确认的参与方利益冲突；来源分歧仅作为待核信息，不直接等同于利益冲突。',
    },
    signal_count: anomalies.length + conflicts.length + divergences.length,
    evidence_boundary: {
      confirmed_facts: list(card.confirmed_facts).map((item) => text(item)).filter(Boolean).slice(0, 5),
      unverified: unverified.slice(0, 4),
    },
  };
}

function relationParts(event) {
  const parts = dimensionPartsOf(event);
  return {
    who: normalized(parts.who),
    object: normalized(parts.object),
    action: normalized(parts.actionType),
    occasion: normalized(parts.occasion),
    labels: parts.labels || {},
  };
}

function relationFor(left, right) {
  const a = relationParts(left);
  const b = relationParts(right);
  const shared = [];
  if (a.who && a.who === b.who) shared.push('who');
  if (a.object && a.object === b.object) shared.push('object');
  if (a.action && a.action === b.action) shared.push('action');
  if (a.occasion && a.occasion === b.occasion) shared.push('occasion');
  const leftTime = eventDate(left);
  const rightTime = eventDate(right);
  const daysApart = leftTime == null || rightTime == null ? null : Math.abs(leftTime - rightTime) / 86400000;
  const closeInTime = daysApart != null && daysApart <= 14;
  if (!shared.length || (!closeInTime && shared.length === 1 && shared[0] !== 'who')) return null;
  // 只有共同动作词、且没有共同主体/对象时，通常只是关键词撞车，不进入选题研判。
  if (shared.length === 1 && shared[0] === 'action') return null;

  let relationType = 'shared_dimension';
  if (shared.includes('who')) relationType = 'same_subject_sequence';
  else if (shared.includes('object') && shared.includes('action')) relationType = 'shared_object_comparison';
  else if (shared.includes('action')) relationType = 'action_comparison';
  else if (shared.includes('occasion')) relationType = 'context_comparison';
  else if (shared.includes('object')) relationType = 'shared_object_comparison';

  const confidence = shared.length >= 2 || (shared.includes('who') && shared.includes('object'))
    ? 'high'
    : shared.length === 1 && closeInTime ? 'medium' : 'low';
  const temporalOrder = leftTime == null || rightTime == null || leftTime === rightTime
    ? 'same_or_unknown'
    : leftTime < rightTime ? `${idOf(left)}_before_${idOf(right)}` : `${idOf(right)}_before_${idOf(left)}`;
  const leftAction = text(dimensionPartsOf(left).actionType, 80);
  const rightAction = text(dimensionPartsOf(right).actionType, 80);
  const leftObject = normalized(dimensionPartsOf(left).object);
  const rightObject = normalized(dimensionPartsOf(right).object);
  if (shared.includes('who') && leftAction && leftAction === rightAction && leftObject && leftObject === rightObject) return null;
  const responsePattern = /(回应|反驳|澄清|回复|跟进|反击|回应|质疑|道歉|解释)/;
  const relationKind = shared.includes('who') && (responsePattern.test(leftAction) || responsePattern.test(rightAction))
    ? 'response'
    : shared.includes('who') ? 'sequence'
      : shared.includes('object') ? 'comparison' : 'sequence';
  const relationLabel = { sequence: '前后变化', response: '回应关系', comparison: '对比关系', trend: '趋势关系' }[relationKind];
  const leftTitle = text(left?.representative_title, 120);
  const rightTitle = text(right?.representative_title, 120);
  const statement = relationKind === 'response'
    ? `「${leftTitle}」与「${rightTitle}」围绕同一主体形成回应链，重点是回应改变了什么。`
    : relationKind === 'sequence'
      ? `「${leftTitle}」先发生，「${rightTitle}」后发生，重点是判断这次前后变化意味着什么。`
      : `「${leftTitle}」与「${rightTitle}」围绕同一对象形成对比，重点是比较双方的动作、收益或代价。`;
  return {
    relation_id: `R-${[idOf(left), idOf(right)].sort().join('-')}`,
    relation_type: relationType,
    relation_kind: relationKind,
    relation_label: relationLabel,
    relationship_statement: statement,
    confidence,
    shared_dimensions: shared,
    temporal_order: temporalOrder,
    days_apart: daysApart == null ? null : Math.round(daysApart * 10) / 10,
    event_ids: [idOf(left), idOf(right)],
    evidence: [left, right].map((event) => ({
      event_id: idOf(event), title: text(event?.representative_title, 180), latest_time: text(event?.latest_time, 50) || null,
      event_parts: dimensionPartsOf(event), sources: sourceRefs(event),
    })),
    status: 'candidate_relation',
  };
}

function trendRelations(selected) {
  const groups = new Map();
  for (const event of selected) {
    const parts = relationParts(event);
    const key = parts.object || parts.action;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return [...groups.entries()].filter(([, items]) => {
    const actions = new Set(items.map((item) => relationParts(item).action).filter(Boolean));
    const genericOnly = actions.size > 0 && [...actions].every((action) => ['发布', '更新', '开源', '提交', '推出'].includes(action));
    return items.length >= 3 && !genericOnly && new Set(items.map((item) => relationParts(item).who).filter(Boolean)).size >= 2;
  }).map(([key, items]) => {
    const ordered = [...items].sort((a, b) => (eventDate(a) || 0) - (eventDate(b) || 0) || idOf(a).localeCompare(idOf(b)));
    const titles = ordered.map((item) => text(item.representative_title, 100));
    return {
      relation_id: `R-TREND-${normalized(key).slice(0, 40)}`,
      relation_type: 'trend_sequence', relation_kind: 'trend', relation_label: '趋势关系', confidence: 'medium',
      shared_dimensions: ['object'], temporal_order: 'ordered_by_event_time', days_apart: null,
      event_ids: ordered.map(idOf), relationship_statement: `围绕「${key}」已有 ${ordered.length} 个高热事件连续出现，值得判断这是偶发新闻，还是正在形成的趋势。`,
      trend_basis: { key, event_count: ordered.length, titles },
      evidence: ordered.map((event) => ({ event_id: idOf(event), title: text(event.representative_title, 180), latest_time: text(event.latest_time, 50) || null, event_parts: dimensionPartsOf(event), sources: sourceRefs(event) })),
      status: 'candidate_relation',
    };
  });
}

export function buildDiscussionResearch({ events = [], eventHeatRanking = {}, topK = DISCUSSION_RESEARCH_TOP_K, batchId = '', generatedAt = new Date().toISOString() } = {}) {
  const heatByEvent = new Map(list(eventHeatRanking.items).map((item) => [String(item.eventId || item.event_id), item]));
  const heatEligible = events.map((event) => ({ event, heat: heatByEvent.get(idOf(event)) })).filter(({ event, heat }) => idOf(event) && heat && finite(heat.rank) != null && heat.state !== 'stale');
  const ranked = heatEligible.filter(({ event, heat }) =>
    !DISCUSSION_RESEARCH_EXCLUDED_CONTENT_CLASSES.includes(contentClassOf(event, heat)))
    .sort((a, b) => (finite(a.heat?.rank, 999999) - finite(b.heat?.rank, 999999))
      || (finite(b.heat?.t ?? b.event?.t, 0) - finite(a.heat?.t ?? a.event?.t, 0))
      || idOf(a.event).localeCompare(idOf(b.event)));
  const selected = ranked.slice(0, Math.max(0, Number(topK) || DISCUSSION_RESEARCH_TOP_K));
  const scope = selected.map(({ event, heat }, index) => eventScope(event, heat, finite(heat?.rank, index + 1), 'T 榜前 K 事件，进入阶段 0 研判范围'));
  // 阶段 0 只负责冻结研判范围。不要在这里根据关键词、维度或时间
  // 直接生成反常、利益冲突、发散方向或事件关系；这些都由阶段 1 的
  // 单事件模型联网交互完成。
  return {
    schema_version: DISCUSSION_RESEARCH_SCHEMA_VERSION,
    generated_at: generatedAt,
    batch_id: String(batchId || ''),
    mode: 'phase0_scope',
    policy: {
      top_k: Number(topK) || DISCUSSION_RESEARCH_TOP_K,
      excluded_content_classes: [...DISCUSSION_RESEARCH_EXCLUDED_CONTENT_CLASSES],
      t_unchanged: true, f_unchanged: true, pool_unchanged: true,
      semantic_judgement: 'model_only',
      phase0_outputs: ['scope', 'source_refs'],
    },
    scope: {
      eligible_count: ranked.length,
      excluded_count: heatEligible.length - ranked.length,
      selected_count: selected.length,
      items: scope,
    },
    internal_signals: [],
    relations: [],
    topic_candidates: [],
    topic_coverage: [],
  };
}

export function discussionResearchMarkdown(report) {
  const scope = report?.scope?.items || [];
  const signals = report?.internal_signals || [];
  const relations = report?.relations || [];
  const materials = report?.verified_research_materials || [];
  const rawReports = report?.research_reports || [];
  const lines = [
    '# 高热事件讨论研判报告',
    '',
    `模式：${report?.mode || 'phase0_observation'}；范围：T 榜前 ${report?.policy?.top_k || DISCUSSION_RESEARCH_TOP_K}；本次纳入 ${scope.length} 个事件。`,
    '',
    report?.research_source === 'model'
      ? '本报告由模型按事件逐个联网研判并直接返回 Markdown；程序只负责范围裁剪、调用审计、来源整理、结构索引和去重，研判价值 J 在候选评分阶段计算。'
      : report?.mode === 'phase0_scope'
        ? '阶段 0 只冻结 T 榜前 K 的非项目事件和来源指针；尚未进行事件内或事件间语义研判，页面不会在此阶段展示程序猜出的关系。'
        : '本报告只整理已有事件卡、事件维度和时间关系，不改变 T、F、候选池，也不把观察信号直接当作选题命题。',
    '',
    '## Top-K 研判范围',
    '',
    ...scope.map((item) => `- #${item.rank} · T ${item.t ?? '—'} · ${item.title}（${item.event_id}）`),
    '',
    '## 事件内研判',
    '',
    ...signals.flatMap((item) => {
      const research = item.internal_research || {};
      return [`### ${item.title}（${item.event_id}）`,
        '#### 反常点', ...(research.anomalies?.length ? research.anomalies.map((signal) => `- ${signal.statement} 预期：${signal.expected}`) : ['- 暂无可确认的反常点']),
        '#### 利益冲突', ...(research.interest_conflicts?.length ? research.interest_conflicts.map((signal) => `- ${signal.statement}`) : ['- 暂无可确认的参与方利益冲突']),
        '#### 可发散方向', ...(research.divergence_directions?.length ? research.divergence_directions.map((signal) => `- ${signal.question}`) : ['- 暂无可发散方向']), ''];
    }),
    '## 事件间研判',
    '',
    ...(relations.length ? relations.map((item) => `- ${item.relation_label || item.relation_kind}：${item.relationship_statement || item.event_ids.join(' ↔ ')}`) : ['- 暂无模型能够用来源证据支持的前后、回应、对比或趋势关系']),
    '',
    '## 模型研判原始报告',
    '',
    ...(rawReports.length ? rawReports.flatMap((item) => [`### ${item.title || item.event_id || '事件研判'}`, '', item.report_markdown || '（模型未返回报告）', '']) : ['- 暂无模型研判报告']),
    '## 写作研判素材',
    '',
    ...(materials.length ? materials.map((item) => `- ${item.material_type}（${item.status}）：${item.statement || item.interpretation || '暂无说明'}${item.writing_angles?.length ? `；可写角度：${item.writing_angles.join('、')}` : ''}${item.thesis_seeds?.length ? `；观点种子：${item.thesis_seeds.join('、')}` : ''}`) : ['- 暂无模型研判素材']),
    '',
    '## 候选选题事件覆盖',
    '',
    ...(list(report?.topic_coverage).length
      ? list(report.topic_coverage).map((item) => `- ${item.status === 'covered' ? '✅ 已覆盖' : item.status === 'uncovered' ? '⚠️ 未形成候选' : '❔ 未说明'} · ${item.title || item.event_id}${item.candidate_ids?.length ? ` → ${item.candidate_ids.join('、')}` : ''}${item.reason ? `：${item.reason}` : ''}`)
      : ['- 暂无候选覆盖清单']),
    '',
    '## 下一阶段',
    '',
    '- 由编辑确认哪些模型研判可以发展成讨论命题。',
    '- 候选选题已由模型从事件内信号或事件间关系生成，编辑仍需确认事实、角度和命题边界。',
  ];
  return lines.join('\n');
}
