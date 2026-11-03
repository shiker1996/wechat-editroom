import fs from 'node:fs';
import path from 'node:path';
import { deriveEventKey, normalizeEventParts, tagBatch } from '../../../features/research/llm/tasks.mjs';
import { ensureBatchEventCards, loadStableBatchEvents } from '../../../features/research/index.mjs';
import { resolveArticleStageSkills } from '../../skills/entry-routing.mjs';
import { isFreshForBatch } from '../../../features/research/index.mjs';
import { dailyFocusOptions } from '../../../features/articles/index.mjs';
import { isResearchEligibleHotspot } from '../../../features/research/index.mjs';
import { respond, boundedLimit } from '../route-helpers.mjs';
import { skipPipelineFailure, reopenPipelineFailure } from '../../../features/batches/index.mjs';
import { createRequestHarnessGateway } from '../../skills/pipeline-runtime.mjs';
import { resolveStableBatchEvents } from '../../../features/research/application/stable-event-service.mjs';
import { tagsOf } from '../../../features/research/domain/hotspot-clustering.mjs';

export async function handleTaskRoutes({ request, response, pathname, searchParams, store, body, json, aiJobs, jobs, models, root, config,
  batchWorkdir, batchMaxAgeHours }) {
  const pipelineFailureGate=(batchId,stages,action)=>{const failures=store.listPipelineFailures(batchId,{statuses:['open','retrying'],stages});return failures.length
    ?{error:`上游环节仍有 ${failures.length} 条待处理失败，请先重试或跳过后再${action}`,code:'PIPELINE_FAILURES_PENDING',failureCount:failures.length,stages}:null;};
  const failureRetryMatch=pathname.match(/^\/api\/batches\/([^/]+)\/pipeline-failures\/(\d+)\/retry$/);
  if(failureRetryMatch&&request.method==='POST'){
    const batchId=decodeURIComponent(failureRetryMatch[1]);const failureId=Number(failureRetryMatch[2]);const input=await body(request);
    try {
      const failure=store.getPipelineFailure(failureId);
      if(!failure||failure.batch_id!==batchId)return respond(json,response,404,{error:'失败记录不存在'});
      if(!['open','retrying'].includes(failure.status))return respond(json,response,409,{error:`失败记录当前状态不可重试：${failure.status}`});
      return respond(json,response,202,aiJobs.start({batchId,provider:input.provider||config.llm.defaultProvider,type:'pipeline-failure-retry',failureId}));
    }
    catch(error){return respond(json,response,422,{error:error.message});}
  }
  const failureDecisionMatch=pathname.match(/^\/api\/batches\/([^/]+)\/pipeline-failures\/(\d+)\/(skip|reopen)$/);
  if(failureDecisionMatch&&request.method==='POST'){
    const batchId=decodeURIComponent(failureDecisionMatch[1]);const input=await body(request);
    try{const failure=failureDecisionMatch[3]==='skip'
      ?skipPipelineFailure({failureId:Number(failureDecisionMatch[2]),batchId,reason:input.reason,store})
      :reopenPipelineFailure({failureId:Number(failureDecisionMatch[2]),batchId,store});
      return respond(json,response,200,{failure});}
    catch(error){return respond(json,response,422,{error:error.message});}
  }
  const externalTagsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/external\/tags$/);
  if (externalTagsMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(externalTagsMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const input = await body(request);
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) return respond(json, response, 400, { error: 'items 必须包含 1–200 条打标结果' });
    const hotspots = new Map(batch.hotspots.map((item) => [Number(item.id), item]));
    const ids = new Set();
    const scoreRanges = { conflict:20, audience:20, informationGain:15, emotion:15, timeliness:10, impact:10, sourceReliability:10 };
    for (const item of input.items) {
      const hotspot = hotspots.get(Number(item?.id));
      if (!hotspot || ids.has(Number(item.id))) return respond(json, response, 422, { error: `热点 ID 无效或重复：${item?.id}` });
      const scores = item.preScores;
      const parts=normalizeEventParts(item.eventParts);
      if (!parts || !item.category || !item.marketScope || !['低','中','高'].includes(item.riskLevel) || !item.relevanceReason || !Number.isFinite(Number(item.chinaRelevance)) || Number(item.chinaRelevance)<0 || Number(item.chinaRelevance)>12 || (item.score!=null&&(!Number.isFinite(Number(item.score))||Number(item.score)<0||Number(item.score)>100)) || !scores || Object.entries(scoreRanges).some(([key,max]) => !Number.isFinite(Number(scores[key])) || Number(scores[key]) < 0 || Number(scores[key]) > max)) {
        return respond(json, response, 422, { error: `热点 ${item.id} 缺少分类、市场范围、风险、事件主体/动作、相关性或有效评分` });
      }
      ids.add(Number(item.id));
    }
    const updated = input.items.map((item) => {const eventParts=normalizeEventParts(item.eventParts);return store.updateHotspotTags(Number(item.id), { ...item,eventParts,eventKey:deriveEventKey({ ...item,eventParts }) });});
    return respond(json, response, 200, { batchId, updated: updated.filter(Boolean).length, items: updated.map((item) => ({ id: item.id, title: item.title, tags: JSON.parse(item.raw_json || '{}').aiTags })) });
  }
  const externalEventsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/external\/events$/);
  if (externalEventsMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(externalEventsMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return respond(json,response,404,{error:'批次不存在'});
    const hotspots = batch.hotspots.filter(isResearchEligibleHotspot).filter((item)=>isFreshForBatch(item,batch.batch_date,batchMaxAgeHours(batch))).filter((item)=>{const tags=tagsOf(item);return tags.eventKey&&tags.preScores;});
    if (!hotspots.length) return respond(json,response,409,{error:'请先完成批次热点打标'});
    const events = resolveStableBatchEvents({store,workspaceRoot:config.workspaceRoot,batch,hotspots});
    for(const [kind,name] of [['稳定事件聚类','event-clusters.json'],['事件归并影子','event-resolution-shadow.json']]){const filePath=path.join(batchWorkdir(batch),'sources',name);if(fs.existsSync(filePath)){const stat=fs.statSync(filePath);store.upsertArtifact({batchId,kind,name,path:filePath,size:stat.size,modifiedAt:stat.mtime.toISOString()});}}
    let cards=[];try{cards=JSON.parse(fs.readFileSync(path.join(batchWorkdir(batch),'sources','event-cards.json'),'utf8')).items||[];}catch{}
    const cardById=new Map(cards.map((item)=>[String(item.event_id),item]));
    return respond(json,response,200,{batchId,events:events.map((event)=>({event_id:event.event_id,representative_title:event.representative_title,report_count:event.report_count,source_count:event.source_count,hotspot_ids:event.hotspot_ids,keywords:event.keywords,articles:event.articles,card:cardById.get(String(event.event_id))||null}))});
  }
  const externalEventCardsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/external\/event-cards$/);
  if (externalEventCardsMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(externalEventCardsMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return respond(json,response,404,{error:'批次不存在'});
    const input = await body(request);
    if (!Array.isArray(input.items)||input.items.length<1||input.items.length>200) return respond(json,response,400,{error:'items 必须包含 1–200 张事件卡'});
    const hotspots = batch.hotspots.filter(isResearchEligibleHotspot).filter((item)=>isFreshForBatch(item,batch.batch_date,batchMaxAgeHours(batch))).filter((item)=>{const tags=tagsOf(item);return tags.eventKey&&tags.preScores;});
    const events = resolveStableBatchEvents({store,workspaceRoot:config.workspaceRoot,batch,hotspots});
    const expected = new Map(events.map((event)=>[String(event.event_id),event]));
    const ids = new Set();
    for (const item of input.items) {
      const id=String(item?.event_id||'');
      if(!expected.has(id)||ids.has(id)||!String(item.conclusion||'').trim()) return respond(json,response,422,{error:`事件卡 ID 无效、重复或缺少结论：${id||'(empty)'}`});
      ids.add(id);
    }
    const text=(value,max=160)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
    const list=(value,max=5)=>Array.isArray(value)?value.map((item)=>text(item,120)).filter(Boolean).slice(0,max):[];
    const items=input.items.map((raw)=>({event_id:String(raw.event_id),title:expected.get(String(raw.event_id)).representative_title,conclusion:text(raw.conclusion),background:text(raw.background,120),confirmed_facts:list(raw.confirmed_facts),source_increment:(Array.isArray(raw.source_increment)?raw.source_increment:[]).map((item)=>({source:text(item?.source,40),adds:text(item?.adds,120)})).filter((item)=>item.source||item.adds).slice(0,6),disagreements:list(raw.disagreements,4),timeline:(Array.isArray(raw.timeline)?raw.timeline:[]).map((item)=>({time:text(item?.time,30),fact:text(item?.fact,120)})).filter((item)=>item.fact).slice(0,5),unverified:list(raw.unverified,4),angles:list(raw.angles,3)}));
    const eventCardsPath=path.join(batchWorkdir(batch),'sources','event-cards.json');
    let existingCards=[];try{existingCards=JSON.parse(fs.readFileSync(eventCardsPath,'utf8')).items||[];}catch{}
    const mergedCards=new Map(existingCards.filter((card)=>expected.has(String(card.event_id))).map((card)=>[String(card.event_id),card]));
    for(const item of items)mergedCards.set(item.event_id,item);
    const allItems=[...mergedCards.values()];
    fs.mkdirSync(path.dirname(eventCardsPath),{recursive:true});
    fs.writeFileSync(eventCardsPath,JSON.stringify({generated_at:new Date().toISOString(),total_events:events.length,completed_events:allItems.length,failed:[],items:allItems},null,2),'utf8');
    const stat=fs.statSync(eventCardsPath);
    store.upsertArtifact({batchId,kind:'事件事实卡',name:'event-cards.json',path:eventCardsPath,size:stat.size,modifiedAt:stat.mtime.toISOString()});
    return respond(json,response,200,{batchId,status:allItems.length===events.length?'saved':'partial',received:items.length,completed:allItems.length,total:events.length,remaining:Math.max(0,events.length-allItems.length),path:'sources/event-cards.json'});
  }
  const externalResearchMatch = pathname.match(/^\/api\/batches\/([^/]+)\/external\/research$/);
  if (externalResearchMatch && request.method === 'GET') {
    const batchId=decodeURIComponent(externalResearchMatch[1]);const batch=store.getBatch(batchId);
    if(!batch)return respond(json,response,404,{error:'批次不存在'});
    const reportPath=path.join(batchWorkdir(batch),'sources','external-research-report.json');
    if(!fs.existsSync(reportPath))return respond(json,response,200,{batchId,exists:false,report:null});
    try{return respond(json,response,200,{batchId,exists:true,report:JSON.parse(fs.readFileSync(reportPath,'utf8'))});}
    catch{return respond(json,response,500,{error:'外部研判报告文件损坏'});}
  }
  if (externalResearchMatch && request.method === 'POST') {
    const batchId=decodeURIComponent(externalResearchMatch[1]);
    const batch=store.getBatch(batchId);
    if(!batch)return respond(json,response,404,{error:'批次不存在'});
    const input=await body(request);
    if(!Array.isArray(input.items)||input.items.length<1||input.items.length>200)return respond(json,response,400,{error:'items 必须包含 1–200 条研判结果'});
    const hotspots=batch.hotspots.filter(isResearchEligibleHotspot).filter((item)=>isFreshForBatch(item,batch.batch_date,batchMaxAgeHours(batch))).filter((item)=>{const tags=tagsOf(item);return tags.eventKey&&tags.preScores;});
    const events=resolveStableBatchEvents({store,workspaceRoot:config.workspaceRoot,batch,hotspots});
    let savedCards=[];try{savedCards=JSON.parse(fs.readFileSync(path.join(batchWorkdir(batch),'sources','event-cards.json'),'utf8')).items||[];}catch{}
    const cardIds=new Set(savedCards.map((card)=>String(card.event_id)));
    if(events.some((event)=>!cardIds.has(String(event.event_id))))return respond(json,response,409,{error:'事件事实卡尚未覆盖全部已打标稳定事件，请先提交事件卡'});
    const byId=new Map(events.map((event)=>[String(event.event_id),event]));
    const seen=new Set();
    for(const item of input.items){
      const eventId=String(item?.eventId||'');
      if(!byId.has(eventId)||seen.has(eventId)||!String(item.thesis||'').trim()||!String(item.reason||'').trim())return respond(json,response,422,{error:`研判事件 ID 无效、重复，或命题/理由缺失：${eventId||'(empty)'}`});
      const allowed=new Set(byId.get(eventId).hotspot_ids.map(Number));
      if(!Array.isArray(item.hotspotIds)||item.hotspotIds.length<1||item.hotspotIds.some((id)=>!allowed.has(Number(id))))return respond(json,response,422,{error:`事件 ${eventId} 的 hotspotIds 不属于该事件`});
      seen.add(eventId);
    }
    const report={schemaVersion:1,source:'external-agent',batchId,generatedAt:new Date().toISOString(),summary:String(input.summary||'').slice(0,4000),items:input.items.map((item)=>({eventId:String(item.eventId),eventTitle:byId.get(String(item.eventId)).representative_title,hotspotIds:[...new Set(item.hotspotIds.map(Number))],title:String(item.title||'').trim().slice(0,120),thesis:String(item.thesis).trim().slice(0,800),angle:String(item.angle||'').trim().slice(0,800),readerBenefit:String(item.readerBenefit||'').trim().slice(0,500),riskLevel:String(item.riskLevel||'').trim().slice(0,40),riskReason:String(item.riskReason||'').trim().slice(0,500),reason:String(item.reason).trim().slice(0,1200),recommendedTrack:['article','social_cards'].includes(item.recommendedTrack)?item.recommendedTrack:'article',score:Number.isFinite(Number(item.score))?Math.max(0,Math.min(100,Number(item.score))):null}))};
    const reportPath=path.join(batchWorkdir(batch),'sources','external-research-report.json');
    fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2),'utf8');
    const stat=fs.statSync(reportPath);store.upsertArtifact({batchId,kind:'外部 Agent 选题研判',name:'external-research-report.json',path:reportPath,size:stat.size,modifiedAt:stat.mtime.toISOString()});
    return respond(json,response,200,{batchId,status:'saved',count:report.items.length,path:'sources/external-research-report.json'});
  }
  const tagMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/tag$/);
  if (tagMatch && request.method === 'POST') {
    const input = await body(request); const batchId = decodeURIComponent(tagMatch[1]);
    const blocked=pipelineFailureGate(batchId,['collect'],'打标');if(blocked)return respond(json,response,409,blocked);
    if (input.background === true) return respond(json, response, 202, aiJobs.start({ batchId, provider: input.provider, type: input.force ? 'retag' : 'tag', force: Boolean(input.force) }));
    const harness=createRequestHarnessGateway({gateway:models,store,entryPoint:'batch-tag-sync',skillId:'hotspot-tagging',provider:input.provider||models.config.defaultProvider,batchId,stageId:'tag'});
    try {
      const result = await tagBatch({ gateway: harness.gateway, store, batchId, provider: input.provider, limit: input.limit, force: Boolean(input.force), maxAgeHours: batchMaxAgeHours(store.getBatch(batchId)), workspaceRoot: config.workspaceRoot });
      try {
        const cardResult = await ensureBatchEventCards({ gateway: harness.gateway, store, batchId, provider: input.provider, workspaceRoot: config.workspaceRoot, maxAgeHours: batchMaxAgeHours(store.getBatch(batchId)), regenerate: Boolean(input.force) });
        result.eventCards = { total: cardResult.total, generated: cardResult.generated, cached: cardResult.cached, failed: cardResult.failed.length };
      } catch (error) { result.eventCards = { error: error.message }; }
      harness.finish('completed');
      return respond(json, response, 200, result);
    } catch(error){ harness.finish('failed',error.message); throw error; }
  }
  const researchMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/research$/);
  if (researchMatch && request.method === 'POST') {
    const input = await body(request); const batchId = decodeURIComponent(researchMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const blocked=pipelineFailureGate(batchId,['collect','tag','event-card'],'研判');if(blocked)return respond(json,response,409,blocked);
    let resumeFrom = '';
    if (batch.batch_type !== 'breaking') {
      try {
        const checkpoint = JSON.parse(fs.readFileSync(path.join(batchWorkdir(batch), 'sources', 'discussion-research-stage3-input.json'), 'utf8'));
        if (checkpoint?.batch_id === batchId && Array.isArray(checkpoint.single_pass?.reports) && checkpoint.single_pass.reports.length
          && checkpoint.base_report?.scope?.items?.length) resumeFrom = 'topic_generation';
      } catch { /* 没有阶段 1/2 快照时执行完整研判。 */ }
    }
    return respond(json, response, 202, aiJobs.start({ batchId, provider: input.provider, type: batch.batch_type === 'breaking' ? 'breaking-analysis' : 'research', resumeFrom }));
  }
  const autoMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/auto$/);
  if (autoMatch && request.method === 'POST') {
    const input = await body(request); const batchId = decodeURIComponent(autoMatch[1]);
    if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const blocked=pipelineFailureGate(batchId,['collect'],'继续流程');if(blocked)return respond(json,response,409,blocked);
    return respond(json, response, 202, aiJobs.start({ batchId, provider: input.provider, type: 'auto' }));
  }
  const eventCardsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/event-cards$/);
  if (eventCardsMatch && request.method === 'POST') {
    const input = await body(request); const batchId = decodeURIComponent(eventCardsMatch[1]);
    if (!store.getBatch(batchId)) return respond(json, response, 404, { error: '批次不存在' });
    const blocked=pipelineFailureGate(batchId,['collect','tag'],'生成事件卡');if(blocked)return respond(json,response,409,blocked);
    return respond(json, response, 202, aiJobs.start({ batchId, provider: input.provider, type: 'event-cards', force: Boolean(input.force) }));
  }
  const dailyMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily$/);
  if (dailyMatch && request.method === 'GET') {
    const batchId = decodeURIComponent(dailyMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    let eventCards = [], focusOptions = [];
    try {
      const cardFile = path.join(batchWorkdir(batch), 'sources', 'event-cards.json');
      if (fs.existsSync(cardFile)) {
        eventCards = JSON.parse(fs.readFileSync(cardFile, 'utf8'))?.items || [];
        const eligible = batch.hotspots.filter(isResearchEligibleHotspot).filter((item) => isFreshForBatch(item, batch.batch_date, batchMaxAgeHours(batch)));
        const clusters = loadStableBatchEvents({ workspaceRoot: root, batch, hotspots: eligible });
        for (const event of clusters) event.card = eventCards.find((card) => String(card.event_id) === String(event.event_id)) || null;
        focusOptions = dailyFocusOptions(clusters);
      }
    } catch {}
    const documents = store.listDocuments(batchId).filter((item) => item.kind === 'daily-draft' || item.kind === 'daily-final');
    const jobs = store.listAiRuns(batchId, 30).filter((job) => job.type === 'daily').slice(0, 5).map((job) => {
      let focuses = []; try { const parsed = JSON.parse(job.result_json || '{}'); if (Array.isArray(parsed.focuses)) focuses = parsed.focuses; } catch {}
      return { id: job.id, status: job.status, progress: job.progress, error: job.error, provider: job.provider, focuses, createdAt: job.created_at, updatedAt: job.updated_at };
    });
    return respond(json, response, 200, { batch: { id: batch.id, title: batch.title, batchDate: batch.batch_date, batchType: batch.batch_type }, eventCards, focusOptions, documents, jobs });
  }
  if (dailyMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(dailyMatch[1]); const batch = store.getBatch(batchId);
    if (!batch) return respond(json, response, 404, { error: '批次不存在' });
    const input = await body(request); const requestedStages = input.stageSkills && typeof input.stageSkills === 'object' ? input.stageSkills : {};
    const hasExplicitStages = Object.values(requestedStages).some((value) => String(value || '').trim());
    const previousSnapshot = (input.useLatestSkill === true || hasExplicitStages) ? null : store.findLatestGenerationSnapshot({ batchId, candidateId: null, purposes: ['daily'] });
    const stageSelections = previousSnapshot ? null : await resolveArticleStageSkills({ workspaceRoot: root, entryPoint: 'batch-daily', requested: requestedStages });
    return respond(json, response, 202, aiJobs.start({ batchId, provider: previousSnapshot ? null : input.provider, type: 'daily', snapshotId: previousSnapshot?.id || null, stageSelections, focuses: Array.isArray(input.focuses) ? input.focuses : [], focus: input.focus || null }));
  }
  if (request.method === 'GET' && pathname === '/api/jobs') return respond(json, response, 200, store.listRecentRuns(boundedLimit(searchParams,40,500)));
  const cancelJobMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
  if (cancelJobMatch && request.method === 'POST') {
    const jobId = decodeURIComponent(cancelJobMatch[1]);
    const result = aiJobs.cancel(jobId);
    if (!result.ok) {
      if (result.code === 'JOB_NOT_FOUND') return respond(json, response, 404, { error: '任务不存在或服务已重启', code: result.code });
      return respond(json, response, 409, { error: '当前任务无法取消', code: result.code, status: result.status });
    }
    if (result.cancelling) return respond(json, response, 202, { ...result.job, cancelled: false, status: 'cancelling' });
    if (result.alreadyStopped) return respond(json, response, 200, { ...result.job, cancelled: false, alreadyStopped: true });
    return respond(json, response, 200, { ...result.job, cancelled: true });
  }
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && request.method === 'GET') {
    const persistedSource = /^source:(\d+)$/.exec(jobMatch[1]);
    const job = jobs.get(jobMatch[1]) ?? aiJobs.get(jobMatch[1]) ?? (persistedSource ? store.getSourceRun(Number(persistedSource[1])) : null);
    return respond(json, response, job ? 200 : 404, job ?? { error: '任务不存在或服务已重启' });
  }
  return false;
}
