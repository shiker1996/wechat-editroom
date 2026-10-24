import fs from 'node:fs';
import path from 'node:path';
import { G_SOCIAL_MATERIAL_CAPS, isFreshForBatch, clusterItems, preselection, selectSocialCandidates, selectSocialPool, buildHotspotAtlas, loadStableBatchEvents } from '../../../features/research/index.mjs';
import { EVENT_HEAT_RANKING_VERSION, buildEventHeatRanking, loadPreviousEventHeatItems, materializeStableEvents, isResearchEligibleHotspot } from '../../../features/research/index.mjs';
import { buildBatchPipelineStatus } from '../../../features/batches/index.mjs';
import { getBatchDeleteImpact, deleteBatchPermanently } from '../../../features/batches/index.mjs';
import { buildEventResolutionOperationsMetrics, readEventResolutionReview } from '../../../features/research/index.mjs';
import { buildTopicScoreOperationsMetrics } from '../../../features/research/index.mjs';
import { displayItemsForTopicGroups } from '../../../features/research/index.mjs';
import { selectBatchSourceGroups } from '../../../features/collection/application/batch-source-selection.mjs';
import { inspectRsshubEnvironment } from '../../integrations/rsshub-installer.mjs';
import { respond, boundedLimit } from '../route-helpers.mjs';

function compactEventHeatItem(item) {
  const childFields = ['eventId', 'title', 'editorialCategory', 'rank', 'scoreValue', 'reportCount', 'hotspotIds'];
  const fields = ['eventId', 'title', 'editorialCategory', 'topic_category', 'rank', 'rankDelta', 'state', 'marketScopes', 'reason',
    'platformImpactByPlatform', 'platformImpactAvailable', 'platformImpact', 'displayKind', 'reportCount', 'scoreValue', 'heatScore',
    'sourceCount', 'repositoryProject', 'materialType', 'contentClass', 'keywords', 'hotspotIds'];
  const compact = Object.fromEntries(fields.filter((key) => item?.[key] !== undefined).map((key) => [key, item[key]]));
  if (Array.isArray(item?.childItems)) {
    compact.childItems = item.childItems.map((child) => Object.fromEntries(childFields
      .filter((key) => child?.[key] !== undefined).map((key) => [key, child[key]])));
  }
  return compact;
}

function cacheJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(value), 'utf8');
    fs.renameSync(tempFile, file);
  } catch { /* Cache writes are optional; callers can still return the computed response. */ }
}

export async function handleBatchRoutes({ request, response, pathname, searchParams, root, store, jobs, body, json,
  batchWorkdir, decorateBatch, batchMaxAgeHours, config, buildStatus = buildBatchPipelineStatus }) {
  if (request.method === 'GET' && pathname === '/api/batches') return respond(json, response, 200, store.listBatches(boundedLimit(searchParams,60,500)));
  if (request.method === 'GET' && pathname === '/api/event-resolution-metrics') {
    return respond(json, response, 200, buildEventResolutionOperationsMetrics({ store, workspaceRoot: root, days: searchParams.get('days') || 7 }));
  }
  if (request.method === 'GET' && pathname === '/api/topic-score-metrics') {
    return respond(json, response, 200, buildTopicScoreOperationsMetrics({ store, workspaceRoot: root, days: searchParams.get('days') || 7 }));
  }
  if (request.method === 'POST' && pathname === '/api/batches') {
    const input = await body(request);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ? input.date : new Date().toISOString().slice(0, 10);
    return respond(json, response, 201, store.createBatch({ date, title: input.title, note: input.note }));
  }
  if (request.method === 'POST' && pathname === '/api/batches/breaking') {
    const input = await body(request);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ? input.date : new Date().toISOString().slice(0, 10);
    try {
      return respond(json, response, 201, store.createBreakingBatch({ date, title: input.title, note: input.note,
        urls: Array.isArray(input.urls) ? input.urls : String(input.urls || '').split(/\r?\n/),
        requestedTracks: Array.isArray(input.requestedTracks) ? input.requestedTracks : ['article'] }));
    } catch (error) { return respond(json, response, 400, { error: error.message }); }
  }
  const batchMatch = pathname.match(/^\/api\/batches\/([^/]+)$/);
  if (batchMatch && request.method === 'GET') {
    const batch = decorateBatch(store.getBatch(decodeURIComponent(batchMatch[1])));
    if (batch) {
      try {
        const cardFile = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
        const cardItems = fs.existsSync(cardFile) ? (JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || []) : [];
        const tagged = batch.hotspots.filter((item) => !item.is_stale && isResearchEligibleHotspot(item)).filter((item) => {
          try { const tags = JSON.parse(item.raw_json).aiTags; return Boolean(tags?.eventKey && tags?.preScores); } catch { return false; }
        });
        const skippedEventIds=new Set((batch.pipeline_failures||[]).filter((item)=>item.stage==='event-card'&&item.status==='skipped')
          .map((item)=>String(item.detail?.eventId||item.object_key.replace(/^event:/,''))));
        const cardTotal = loadStableBatchEvents({ workspaceRoot: root, batch, hotspots: tagged }).filter((event)=>!skippedEventIds.has(event.event_id)).length;
        const cardCount=cardItems.filter((item)=>!skippedEventIds.has(String(item.event_id))).length;
        batch.event_cards = { count: cardTotal ? Math.min(cardCount, cardTotal) : 0, total: cardTotal, skipped: skippedEventIds.size };
      } catch { batch.event_cards = { count: 0, total: 0 }; }
      batch.pipeline_status = buildStatus({ hotspotCount: batch.ai_status.total, tagged: batch.ai_status.tagged,
        total: batch.ai_status.total, cardsCount: batch.event_cards.count, cardsTotal: batch.event_cards.total,
        latestResearch: batch.ai_status.latestResearch, failures: batch.pipeline_failures });
    }
    return respond(json, response, batch ? 200 : 404, batch ?? { error: '批次不存在' });
  }
  if (batchMatch && request.method === 'PATCH') {
    const input = await body(request);
    if (input.lifecycleStatus != null) {
      if (!['active', 'completed', 'archived'].includes(input.lifecycleStatus)) return respond(json, response, 400, { error: '批次生命周期状态无效' });
      input.lifecycle_status = input.lifecycleStatus;
      delete input.lifecycleStatus;
    }
    const updated = store.updateBatch(decodeURIComponent(batchMatch[1]), input);
    return respond(json, response, updated ? 200 : 404, updated ?? { error: '批次不存在' });
  }
  const batchDeleteImpactMatch = pathname.match(/^\/api\/batches\/([^/]+)\/delete-impact$/);
  if (batchDeleteImpactMatch && request.method === 'GET') {
    const impact = getBatchDeleteImpact(root, store, decodeURIComponent(batchDeleteImpactMatch[1]));
    return respond(json, response, impact ? 200 : 404, impact ?? { error: '批次不存在' });
  }
  if (batchMatch && request.method === 'DELETE') {
    const batchId = decodeURIComponent(batchMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    if ((batch.lifecycle_status || 'active') !== 'archived') return respond(json, response, 409, { error: '只有已归档批次可以彻底删除，请先归档' });
    if (!request.localSecurity?.consume(request, 'batch-delete')) return respond(json, response, 403, { code: 'CONFIRMATION_REQUIRED', error: '请先确认彻底删除批次' });
    const result = deleteBatchPermanently(root, store, batchId);
    return respond(json, response, 200, { ok: true, ...result });
  }
  const collectMatch = pathname.match(/^\/api\/batches\/([^/]+)\/collect$/);
  if (collectMatch && request.method === 'POST') {
    const input = await body(request);
    // 批次不再拥有第二套来源选择状态；来源台账中的 enabled 才是唯一准入条件。
    // 保留固定入口集合只是为了兼容旧客户端的响应字段，不采信 input.sources 的子集。
    const requestedSources = ['reddit', 'paper', 'rsshub', 'x', 'wechat', 'github'];
    const rsshub = await inspectRsshubEnvironment(config?.rsshub || {});
    const selection = selectBatchSourceGroups(requestedSources, store.listCollectionSources(), {
      rsshubReady: rsshub.ready,
      rsshubReason: rsshub.reason,
    });
    if (!selection.selected.length) return respond(json, response, 409, { error: '没有已启用的可采集来源', code: 'NO_ENABLED_COLLECTION_SOURCES', available: selection.available });
    const sources = selection.selected;
    const batchId = decodeURIComponent(collectMatch[1]);
    let maxAgeHours = null;
    if (input.maxAgeHours != null) {
      maxAgeHours = Number(input.maxAgeHours);
      if (![24, 48, 72, 120, 168].includes(maxAgeHours)) return respond(json, response, 400, { error: '时间范围只支持 24、48、72、120、168 小时' });
      store.updateBatch(batchId, { max_age_hours: maxAgeHours });
    }
    return respond(json, response, 202, { ...jobs.startCollection(batchId, sources, maxAgeHours), requestedSources, skippedSources: selection.skipped });
  }
  const overviewMatch = pathname.match(/^\/api\/batches\/([^/]+)\/overview$/);
  const eventHeatMatch = pathname.match(/^\/api\/batches\/([^/]+)\/event-heat-ranking$/);
  const eventReviewMatch = pathname.match(/^\/api\/batches\/([^/]+)\/event-resolution-review$/);
  const eventDecisionMatch = pathname.match(/^\/api\/batches\/([^/]+)\/event-resolution-decisions$/);
  const eventDecisionItemMatch = pathname.match(/^\/api\/batches\/([^/]+)\/event-resolution-decisions\/(\d+)$/);
  const rankingMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ranking$/);
  const socialRankingMatch = pathname.match(/^\/api\/batches\/([^/]+)\/social-ranking$/);
  if (eventReviewMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(eventReviewMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    return respond(json, response, 200, readEventResolutionReview({ store, workspaceRoot: root, batch }));
  }
  if (eventDecisionMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(eventDecisionMatch[1]);
    if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const input = await body(request);
    try {
      const decision = store.recordEventResolutionDecision({ batchId, eventId: input.eventId, decisionType: input.decisionType,
        targetEventId: input.targetEventId, hotspotIds: input.hotspotIds, reason: input.reason, actor: input.actor, metadata: input.metadata });
      return respond(json, response, 201, decision);
    } catch (error) { return respond(json, response, 400, { error: error.message }); }
  }
  if (eventDecisionItemMatch && request.method === 'DELETE') {
    const batchId = decodeURIComponent(eventDecisionItemMatch[1]); const decisionId = Number(eventDecisionItemMatch[2]);
    const decision = store.listEventResolutionDecisions({ batchId, limit: 5000 }).find((item) => item.id === decisionId);
    if (!decision) return respond(json, response, 404, { error: '人工校正记录不存在' });
    return respond(json, response, 200, store.revertEventResolutionDecision(decisionId));
  }
  if (socialRankingMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(socialRankingMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const file = path.join(batchWorkdir(batch), 'sources', 'social-card-ranking.json');
    let items = []; try { items = JSON.parse(fs.readFileSync(file, 'utf8')).items || []; } catch {}
    if (!items.length) {
      const eligible = batch.hotspots.filter(isResearchEligibleHotspot).filter((item) => isFreshForBatch(item, batch.batch_date, batchMaxAgeHours(batch)));
      const tagged = eligible.filter((item) => { try { const tags = JSON.parse(item.raw_json || '{}').aiTags; return tags?.eventKey && tags?.preScores; } catch { return false; } });
      if (tagged.length) {
        const scored = selectSocialCandidates(preselection(loadStableBatchEvents({ workspaceRoot: root, batch, hotspots: tagged }), batch.batch_date), tagged.length, true);
        const selectedKeys = new Set(selectSocialPool(scored, 10, G_SOCIAL_MATERIAL_CAPS).map((item) => item.eventId ?? item.hotspotId ?? item.title));
        items = scored.map((item, index) => ({ ...item, socialRank: index + 1, selected: selectedKeys.has(item.eventId ?? item.hotspotId ?? item.title) }));
      }
    }
    const inPoolIds = new Set(store.listCandidates(batchId, 'social_cards').map((item) => item.hotspot_id));
    return respond(json, response, 200, items.map((item) => ({ ...item, inPool: inPoolIds.has(item.hotspotId) })));
  }
  if (rankingMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(rankingMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const items = batch.hotspots.filter((item) => !item.is_stale).map((item) => {
      const raw = (() => { try { return JSON.parse(item.raw_json || '{}'); } catch { return {}; } })();
      const tags = raw.aiTags || {}; const preScores = tags.preScores || {};
      const base = ['conflict', 'audience', 'informationGain', 'emotion', 'timeliness', 'impact', 'sourceReliability'].reduce((s, k) => s + (preScores[k] || 0), 0);
      return { hotspotId: item.id, title: item.title, category: item.category, marketScope: item.market_scope,
        riskLevel: tags.riskLevel || item.category, score: base + (tags.categoryPreference || 0) + (tags.credibleScoop || 0) - (tags.saturationPenalty || 0),
        eliminationReason: raw.eliminationReason || '', inPool: false };
    }).sort((a, b) => b.score - a.score).map((item, idx) => ({ ...item, rank: idx + 1 }));
    const inPoolIds = new Set(store.listCandidates(batchId).map((c) => c.hotspot_id));
    for (const item of items) if (inPoolIds.has(item.hotspotId)) item.inPool = true;
    return respond(json, response, 200, items);
  }
  if (eventHeatMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(eventHeatMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const file = path.join(batchWorkdir(batch), 'sources', 'event-heat-ranking.json');
    let ranking = null;
    try { ranking = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (!ranking || !Array.isArray(ranking.items) || ranking.titleVersion !== 2 || ranking.scoringVersion !== EVENT_HEAT_RANKING_VERSION) {
      const rankingHotspots = batch.hotspots.filter(isResearchEligibleHotspot).filter((item) => isFreshForBatch(item, batch.batch_date, batchMaxAgeHours(batch)));
      ranking = buildEventHeatRanking({ store, batch, events: loadStableBatchEvents({ workspaceRoot: root, batch, hotspots: rankingHotspots }), previousItems: loadPreviousEventHeatItems({ store, workspaceRoot: root, batch }) });
      cacheJson(file, ranking);
    }
    return respond(json, response, 200, ranking);
  }
  if (overviewMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(overviewMatch[1]); const batch = store.getAtlasBatch?.(batchId) || store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const eligible = batch.hotspots.filter(isResearchEligibleHotspot).filter((item) => isFreshForBatch(item, batch.batch_date, batchMaxAgeHours(batch)));
    const taggedCount = eligible.filter((item) => { try { const tags = JSON.parse(item.raw_json).aiTags; return Boolean(tags?.eventKey && tags?.relevanceReason && tags?.preScores); } catch { return false; } }).length;
    const heatFile = path.join(batchWorkdir(batch), 'sources', 'event-heat-ranking.json');
    let eventHeatRanking = null;
    try {
      eventHeatRanking = fs.existsSync(heatFile) ? JSON.parse(fs.readFileSync(heatFile, 'utf8')) : null;
    } catch { eventHeatRanking = null; }
    if (!eventHeatRanking || !Array.isArray(eventHeatRanking.items) || eventHeatRanking.titleVersion !== 2 || eventHeatRanking.scoringVersion !== EVENT_HEAT_RANKING_VERSION) {
      eventHeatRanking = buildEventHeatRanking({ store, batch, events: loadStableBatchEvents({ workspaceRoot: root, batch, hotspots: eligible }), previousItems: loadPreviousEventHeatItems({ store, workspaceRoot: root, batch }) });
      cacheJson(heatFile, eventHeatRanking);
    }
    const memberships = store.listEventHotspots?.({ batchId, limit: Math.max(1, batch.hotspots.length) }) || [];
    const membershipsByEvent = new Map();
    for (const membership of memberships) {
      if (!membershipsByEvent.has(membership.event_id)) membershipsByEvent.set(membership.event_id, []);
      membershipsByEvent.get(membership.event_id).push(membership);
    }
    const recordsById = new Map((store.listEventRecords?.({ eventIds: [...membershipsByEvent.keys()], limit: Math.max(1, membershipsByEvent.size) }) || []).map((record) => [record.id, record]));
    const rawStableEvents = [...membershipsByEvent.entries()].map(([eventId, eventMemberships]) => {
      const record = recordsById.get(eventId) || {};
      return { event_id: eventId, title: record.title || '', normalized: record.normalized || {}, hotspot_ids: eventMemberships.map((item) => Number(item.hotspot_id)),
        legacy_event_ids: record.legacy_ids || [], first_seen_at: record.first_seen_at || null, last_seen_at: record.last_seen_at || null };
    });
    const heatByEvent = new Map((eventHeatRanking.items || []).map((item) => [item.eventId, item]));
    const rankingAliases = new Map();
    for (const item of eventHeatRanking.items || []) {
      for (const eventId of item.mergedEventIds || []) rankingAliases.set(String(eventId), String(item.eventId));
    }
    const stableEventsById = new Map();
    for (const event of rawStableEvents) {
      const canonicalId = rankingAliases.get(String(event.event_id)) || String(event.event_id);
      const existing = stableEventsById.get(canonicalId);
      if (!existing) {
        stableEventsById.set(canonicalId, { ...event, event_id: canonicalId, hotspot_ids: [...new Set(event.hotspot_ids || [])] });
        continue;
      }
      existing.hotspot_ids = [...new Set([...(existing.hotspot_ids || []), ...(event.hotspot_ids || [])])];
      existing.first_seen_at = [existing.first_seen_at, event.first_seen_at].filter(Boolean).sort()[0] || null;
      existing.last_seen_at = [existing.last_seen_at, event.last_seen_at].filter(Boolean).sort().at(-1) || null;
    }
    const stableEvents = [...stableEventsById.values()];
    const atlasClusters = stableEvents.length ? materializeStableEvents({ shadowEvents: stableEvents, hotspots: eligible, heatByEvent }) : [];
    let discussionRelations = [];
    try {
      const relationFile = path.join(batchWorkdir(batch), 'sources', 'event-relations.json');
      discussionRelations = JSON.parse(fs.readFileSync(relationFile, 'utf8'))?.items || [];
    } catch { discussionRelations = []; }
    const atlas = buildHotspotAtlas({ clusters: atlasClusters, totalArticles: eligible.length, taggedCount, excludedStale: batch.hotspots.length - eligible.length, discussionRelations });
    const eventByHotspot = new Map(memberships.map((membership) => [Number(membership.hotspot_id), rankingAliases.get(String(membership.event_id)) || membership.event_id]));
    for (const event of atlas.events || []) {
      const stableIds = [...new Set((event.hotspot_ids || []).map((hotspotId) => eventByHotspot.get(Number(hotspotId))).filter(Boolean))];
      event.event_record_ids = stableIds;
      if (stableIds.length === 1) {
        const heat = heatByEvent.get(stableIds[0]);
        if (heat) event.event_heat = { rank: heat.rank, heatScore: heat.heatScore, state: heat.state, rankDelta: heat.rankDelta };
      }
    }
    atlas.eventHotlist = (eventHeatRanking.items || []).map((item) => ({
      eventId: item.eventId,
      title: item.title,
      hotspotIds: item.hotspotIds,
      repositoryProject: item.repositoryProject,
      materialType: item.materialType,
      contentClass: item.contentClass,
    }));
    atlas.eventHeatRankings = Object.fromEntries(Object.entries(eventHeatRanking.categoryRankings || {}).map(([category, board]) => [category, {
      editorialCategory: board.editorialCategory,
      scoreModel: board.scoreModel,
      scoreComparable: board.scoreComparable,
      totalEvents: board.totalEvents,
      items: displayItemsForTopicGroups(board.items || [], eventHeatRanking.topicGroups || []).map(compactEventHeatItem),
    }]));
    atlas.eventHotlistGeneratedAt = eventHeatRanking.generatedAt || null;
    try {
      const cardFile = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
      if (fs.existsSync(cardFile)) {
        const cards = JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || [];
        const cardMap = new Map(cards.map((card) => [String(card.event_id), card]));
        for (const event of atlas.events || []) {
          const card = cardMap.get(String(event.event_id));
          if (card) {
            event.card = { ...card, event_id: event.event_id };
          }
        }
        for (const node of atlas.graph?.nodes || []) if (node.type === 'event') { const card = cardMap.get(String(node.id).replace(/^event:/, '')); if (card?.conclusion) node.summary = card.conclusion; }
      }
    } catch { /* event cards are optional */ }
    atlas.events = (atlas.events || []).map((event) => ({
      ...event,
      articles: (event.articles || []).map((article) => ({
        title: article.title,
        source: article.source,
        channel: article.channel,
        url: article.url,
        time: article.time,
      })),
    }));
    return respond(json, response, 200, atlas);
  }
  return false;
}
