import fs from 'node:fs';
import path from 'node:path';
import { isDirectPracticalProject } from '../domain/content-routing.mjs';
import { isRepositoryEvent } from '../domain/editorial-categories.mjs';

const list = (value) => Array.isArray(value) ? value : [];
const id = (value) => String(value ?? '').trim();

function readArtifact(workdir, name, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(path.join(workdir, 'sources', name), 'utf8')); }
  catch { return fallback; }
}

function eventIdsOf(value = {}) {
  return [...new Set([
    value.event_id, value.eventId,
    ...list(value.event_ids), ...list(value.eventIds),
    value.source?.event_id, value.source?.eventId,
    ...list(value.source?.event_ids), ...list(value.source?.eventIds),
  ].map(id).filter(Boolean))];
}

function hotspotIdsOfEvent(event = {}) {
  return [...new Set([
    ...list(event.hotspot_ids), ...list(event.hotspotIds),
    event.representativeHotspotId, event.representative_hotspot_id,
    ...list(event.articles).map((article) => article?.hotspot_id ?? article?.hotspotId),
  ].map(Number).filter(Number.isFinite))];
}

function candidateHotspotIds(candidate = {}) {
  return [...new Set([
    candidate.hotspot_id, candidate.hotspotId,
    ...list(candidate.member_hotspot_ids), ...list(candidate.memberHotspotIds),
  ].map(Number).filter(Number.isFinite))];
}

function humanFinalRejection(item = {}) {
  const reasons = list(item.selection_rejection_reasons).map((value) => typeof value === 'string' ? value : value?.code).filter(Boolean);
  const labels = {
    article_route_blocked: '项目文章路线资格未通过',
    reader_entry_below_threshold: '读者入口评分低于门槛',
    reader_entry_incomplete: '目标读者、点击理由、标题入口或读者回报不完整',
    reader_title_anchor_missing: '标题没有包含声明的热点锚点',
    final_quota_or_event_already_assigned: '最终名额已满或关联事件已有候选',
    score_status: '评分状态未就绪',
    missing_final_score: '缺少最终 F 分',
  };
  return reasons.map((reason) => {
    if (labels[reason]) return labels[reason];
    if (reason.startsWith('score_status:')) return `评分未就绪：${reason.slice('score_status:'.length)}`;
    return reason;
  }).join('；');
}

function makeStage(stage, status, reason = '', details = {}) {
  return { stage, status, ...(reason ? { reason } : {}), ...details };
}

/** Joins persisted pipeline artifacts into track-specific, stage-aware explanations. */
export function buildBatchSelectionTrace({ batch, workdir, hotspots = [], articleCandidates = [], socialCandidates = [],
  isResearchEligibleHotspot = () => true, isFreshForBatch = () => true, maxAgeHours = null } = {}) {
  const clusters = readArtifact(workdir, 'event-clusters.json', { events: [] });
  const heat = readArtifact(workdir, 'event-heat-ranking.json', {});
  const preselection = readArtifact(workdir, 'preselection-ranking.json', { items: [] });
  const discussion = readArtifact(workdir, 'discussion-research.json', {});
  const coverage = readArtifact(workdir, 'topic-candidate-coverage.json', { items: [] });
  const generated = readArtifact(workdir, 'topic-candidate-generation.json', { items: [] });
  const finalRanking = readArtifact(workdir, 'topic-preselection-ranking.json', { items: [] });
  const socialRanking = readArtifact(workdir, 'social-card-ranking.json', { items: [] });

  const eventByHotspot = new Map();
  for (const event of list(clusters.events)) for (const hotspotId of hotspotIdsOfEvent(event)) {
    const current = eventByHotspot.get(hotspotId) || [];
    current.push(event);
    eventByHotspot.set(hotspotId, current);
  }
  const eventById = new Map(list(clusters.events).map((event) => [id(event.event_id || event.eventId), event]));
  const heatByEvent = new Map();
  const addHeatItems = (items) => { for (const item of list(items)) {
    const eventId = id(item.eventId || item.event_id);
    if (eventId && !heatByEvent.has(eventId)) heatByEvent.set(eventId, item);
  } };
  addHeatItems(heat.items);
  for (const board of Object.values(heat.rankings || {})) addHeatItems(board?.items);
  for (const board of Object.values(heat.categoryRankings || {})) addHeatItems(board?.items);
  const preselectionByEvent = new Map(list(preselection.items).map((item) => [id(item.eventId || item.event_id), item]));
  const scopeByEvent = new Map(list(discussion.scope?.items).map((item) => [id(item.event_id || item.eventId), item]));
  const coverageByEvent = new Map(list(coverage.items).map((item) => [id(item.event_id || item.eventId), item]));
  const articleItems = list(finalRanking.items);
  const socialByHotspot = new Map(list(socialRanking.items).map((item) => [Number(item.hotspotId ?? item.hotspot_id), item]).filter(([hotspotId]) => Number.isFinite(hotspotId)));
  const articleTrackByHotspot = new Map();
  for (const item of articleCandidates) for (const hotspotId of candidateHotspotIds(item)) articleTrackByHotspot.set(hotspotId, item);
  const socialTrackByHotspot = new Map();
  for (const item of socialCandidates) for (const hotspotId of candidateHotspotIds(item)) socialTrackByHotspot.set(hotspotId, item);

  const items = list(hotspots).map((hotspot) => {
    const hotspotId = Number(hotspot.id);
    const events = eventByHotspot.get(hotspotId) || [];
    const eventIds = new Set(events.map((event) => id(event.event_id || event.eventId)));
    const eligible = isResearchEligibleHotspot(hotspot);
    const fresh = isFreshForBatch(hotspot, batch.batch_date, maxAgeHours);
    const collected = makeStage('采集与时效', eligible && fresh ? 'passed' : 'blocked',
      !eligible ? '该热点未通过研判资格筛选' : !fresh ? '超出本批次采集时效范围' : '', { researchEligible: eligible, fresh });
    const resolved = makeStage('事件归并', events.length ? 'passed' : eligible && fresh ? 'not_reached' : 'not_applicable',
      events.length ? '' : eligible && fresh ? '未形成稳定事件记录，后续事件级研判未执行' : '上游资格或时效未通过',
      events.length ? { eventIds: [...eventIds] } : {});

    const articleStages = [collected, resolved];
    let articleTerminal = '';
    if (!eligible || !fresh) articleTerminal = collected.reason;
    if (!events.length && !articleTerminal) articleTerminal = resolved.reason;
    for (const event of events) {
      const eventId = id(event.event_id || event.eventId);
      const directProject = isRepositoryEvent(event) && isDirectPracticalProject(event);
      const pre = preselectionByEvent.get(eventId);
      const heatItem = heatByEvent.get(eventId);
      const scopeItem = scopeByEvent.get(eventId);
      const coverageItem = coverageByEvent.get(eventId);
      const topicItems = list(generated.items).filter((item) => eventIdsOf(item).includes(eventId));
      const scoredItems = articleItems.filter((item) => eventIdsOf(item).includes(eventId));
      const routeStage = makeStage('文章赛道资格', !isRepositoryEvent(event) || directProject ? 'passed' : 'blocked',
        isRepositoryEvent(event) && !directProject ? '纯项目未标记 direct_practical，保留在工具图文赛道' : '',
        { directPracticalProject: directProject });
      articleStages.push(routeStage);
      if (routeStage.status === 'blocked') articleTerminal ||= routeStage.reason;

      articleStages.push(makeStage('文章事件预选', pre?.poolRole && pre.poolRole !== '未入选' ? 'passed'
        : pre ? 'not_selected' : 'not_reached', pre?.eliminationReason || (pre?.poolRole === '未入选' ? '未进入文章事件预选池' : ''),
      pre ? { poolRole: pre.poolRole, eventRank: pre.preRank } : { eventId }));
      if (!pre && !scopeItem && !articleTerminal) articleTerminal = '没有文章事件预选产物，且未进入讨论深研范围';

      articleStages.push(makeStage('讨论深研范围', scopeItem ? 'passed' : 'not_selected',
        scopeItem?.included_reason || (!scopeItem
          ? isRepositoryEvent(event) && !directProject
            ? '纯项目默认留在图文赛道'
            : event.tags?.preScores?.audience === 0
              ? '账号受众相关度为 0'
              : '未进入热度 Top-K 或读者影响补入名额'
          : ''), scopeItem ? { selectionType: scopeItem.selection_type, scopeRank: scopeItem.selection_rank } : { eventId }));
      if (!scopeItem) articleTerminal = articleStages.at(-1).reason;

      articleStages.push(makeStage('候选生成与覆盖', coverageItem?.status === 'covered' ? 'passed'
        : coverageItem?.status === 'uncovered' ? 'blocked'
          : scopeItem ? 'unreported' : 'not_reached',
      coverageItem?.reason || (coverageItem?.status === 'covered' ? ''
        : scopeItem ? '深研范围内没有可映射的候选覆盖结果' : '未进入讨论深研范围'),
      { covered: coverageItem?.status === 'covered', generatedCandidateCount: topicItems.length }));
      if (coverageItem?.status === 'uncovered') articleTerminal = coverageItem.reason || '候选生成阶段未形成选题';
      else if (scopeItem && !topicItems.length) articleTerminal = coverageItem?.reason || '研判范围已覆盖，但没有生成可评分候选';

      const scoredItem = scoredItems[0];
      const finalCandidate = articleTrackByHotspot.get(hotspotId);
      const finalRole = scoredItem?.source?.poolRole || scoredItem?.poolRole || '';
      const rejection = humanFinalRejection(scoredItem);
      const scoreClaimsSelected = Boolean(scoredItem && finalRole && finalRole !== '未入选');
      articleStages.push(makeStage('角度评分与最终入池', finalCandidate ? 'passed'
        : scoreClaimsSelected ? 'unreported'
          : scoredItem ? 'blocked' : 'not_reached',
      finalCandidate ? '' : scoreClaimsSelected
        ? '评分产物标记为入选，但未匹配到持久化文章候选，状态待核对'
        : rejection || (scoredItem ? '未通过最终文章选池' : topicItems.length ? '候选未进入角度评分产物' : '没有可评分候选'),
      finalCandidate ? { candidateId: finalCandidate.candidate_id, poolRole: finalCandidate.track_pool_role || finalCandidate.pool_role }
        : scoredItem ? { candidateId: scoredItem.candidateId || scoredItem.candidate_id, poolRole: finalRole } : {}));
      if (finalCandidate) articleTerminal = '';
      else if (scoredItem) articleTerminal = rejection || '未通过最终文章选池';
      else if (topicItems.length) articleTerminal = '候选已生成，但没有进入角度评分产物';
    }
    const articleTrack = articleTrackByHotspot.get(hotspotId);
    const article = {
      inPool: Boolean(articleTrack), status: articleTrack ? 'in_pool' : 'not_in_pool',
      reason: articleTrack ? '' : articleTerminal || '没有记录可精确归因的最终文章筛选原因',
      stages: articleStages,
      ...(articleTrack ? { candidateId: articleTrack.candidate_id, candidateRole: articleTrack.track_pool_role || articleTrack.pool_role } : {}),
    };

    const socialRank = socialByHotspot.get(hotspotId);
    const socialTrack = socialTrackByHotspot.get(hotspotId);
    const socialStages = [collected, resolved];
    if (!socialRank) {
      socialStages.push(makeStage('图文资格与 G_social', 'not_reached',
        '没有图文评分产物；未进入图文候选研判'));
    } else {
      socialStages.push(makeStage('图文资格与 G_social', socialRank.candidateEligible === false ? 'blocked' : 'passed',
        socialRank.qualificationReason || socialRank.rejectionReason || '',
      { score: socialRank.gSocial ?? socialRank.socialScore ?? null, materialType: socialRank.materialType || '', contentClass: socialRank.contentClass || '' }));
      socialStages.push(makeStage('图文预选', socialRank.selected ? 'passed' : 'not_selected',
        socialRank.selected ? (socialRank.reasons || []).join('；') : socialRank.candidateEligible === false
          ? socialRank.qualificationReason || socialRank.rejectionReason || '未通过图文资格门禁'
          : socialRank.eliminationReason || '未进入 G_social 图文预选名额',
      { socialRank: socialRank.socialRank }));
    }
    const social = {
      inPool: Boolean(socialTrack), status: socialTrack ? 'in_pool' : socialRank?.selected ? 'selected_not_persisted' : 'not_in_pool',
      reason: socialTrack ? '' : socialRank?.selected ? '图文预选通过但未找到持久化候选'
        : socialRank?.candidateEligible === false ? socialRank.qualificationReason || socialRank.rejectionReason || '未通过图文资格门禁'
          : socialRank?.eliminationReason || '未进入图文预选池',
      stages: socialStages,
      ...(socialTrack ? { candidateId: socialTrack.candidate_id, candidateRole: socialTrack.track_pool_role || socialTrack.pool_role } : {}),
    };

    return { hotspotId, title: hotspot.title, source: hotspot.source_name || hotspot.source || '', eventIds: [...eventIds], tracks: { article, social_cards: social } };
  });
  return items;
}

