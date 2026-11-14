import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { candidateArticleDir } from '../../../platform/core/workspace-paths.mjs';
import { runPipelineStage } from '../../../platform/skills/pipeline-runtime.mjs';
import { loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';
// capability-call: cap_content_web_search, cap_content_url_fetch
import { collectCandidateImageSources } from './article-image-sources.mjs';
import { createArticleImageAsset } from './article-image-create.mjs';
import { generateArticleImage } from './article-image-generator.mjs';
import { executeInformationCapabilitySlot, listInformationCapabilitySlots } from '../../../platform/tools/capability-slots.mjs';
import { clearImagePlan, getImageWorkspace, imageManifestFile, planImagePlaceholders, registerGeneratedSlotImage, saveLocalImage } from './image-workflow.mjs';

const CHECKPOINT_NAME='article-image-pipeline.json';
const SOURCE_TYPES=new Set(['来源','资料','参考']);

function writeJson(filePath,value) {
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const temp=`${filePath}.tmp`;
  fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');
  fs.renameSync(temp,filePath);
  return fs.statSync(filePath);
}

function slotHash(item) {
  return crypto.createHash('sha256').update(JSON.stringify({id:item.id,type:item.type,content:item.content,position:item.position,ratio:item.ratio,suggestedSource:item.suggestedSource,generate:item.generate||null})).digest('hex');
}

function checkpointArtifact(store,batchId,candidateId,filePath,stat) {
  store.upsertArtifact({batchId,candidateId,track:'article',kind:'配图流水线检查点',name:path.basename(filePath),path:filePath,size:stat.size,modifiedAt:stat.mtime.toISOString()});
}

export function archivePreviousImageRun(workdir) {
  const historyRoot=path.join(workdir,'.image-history');
  const archiveDir=path.join(historyRoot,new Date().toISOString().replace(/[:.]/g,'-'));
  const files=[['images',path.join(workdir,'images')],['image-assets.json',imageManifestFile(workdir)],[CHECKPOINT_NAME,path.join(workdir,CHECKPOINT_NAME)]];
  const existing=files.filter(([,file])=>fs.existsSync(file));
  if(!existing.length)return null;
  fs.mkdirSync(archiveDir,{recursive:true});
  for(const [name,file] of existing)fs.renameSync(file,path.join(archiveDir,name));
  return archiveDir;
}

function checkCancelled(signal) {
  if(signal?.aborted) throw Object.assign(new Error(signal.reason?.message||'配图流水线已取消'),{code:'JOB_CANCELLED'});
}

function relevantSourceExcerpt(source,slots,limit=5000) {
  const text=String(source?.content||source?.description||'').trim();
  if(text.length<=limit)return text;
  const query=slots.map((item)=>`${item.content||''} ${item.suggestedSource||''}`).join(' ');
  const terms=[...new Set((query.match(/[a-z0-9][a-z0-9._+-]{2,}/gi)||[]).map((term)=>term.toLowerCase()))];
  const paragraphs=text.split(/\n{2,}|(?<=[。！？])\s*/).map((part)=>part.trim()).filter(Boolean);
  const chunks=paragraphs.flatMap((part)=>part.length<=900?[part]:Array.from({length:Math.ceil((part.length-700)/500)+1},(_,index)=>part.slice(index*500,index*500+700)).filter(Boolean));
  if(!terms.length||!chunks.length)return text.slice(0,limit);
  const ranked=chunks.map((chunk,index)=>({chunk,index,score:terms.reduce((score,term)=>score+(chunk.toLowerCase().includes(term)?Math.min(3,chunk.toLowerCase().split(term).length-1):0),0)}))
    .sort((left,right)=>right.score-left.score||left.index-right.index);
  const selected=[];let size=0;
  for(const item of ranked){if(item.score===0)break;if(size+item.chunk.length>limit)continue;selected.push(item);size+=item.chunk.length+2;}
  return selected.length?selected.sort((left,right)=>left.index-right.index).map((item)=>item.chunk).join('\n\n'):text.slice(0,limit);
}

function sourceAgentInput(slots,sources,articleText='') {
  return {slots:slots.map((item)=>({imageId:item.id,description:item.content,position:item.position,suggestedSource:item.suggestedSource})),
    sources:sources.slice(0,40).map((source)=>({sourceId:source.sourceId,title:source.title,site:source.source||source.source_name||'',url:source.url,kind:source.kind||'collected',excerpt:relevantSourceExcerpt(source,slots)})),
    articleText:String(articleText).slice(0,24000)};
}

async function discoverImageSources({workspaceRoot,slots,signal}) {
  const slotList=await listInformationCapabilitySlots(workspaceRoot);
  if(!slotList.find((item)=>item.id==='web-search')?.available)return {sources:[],warning:'网络搜索槽位未配置或不可用'};
  const sources=[],warnings=[];
  for(const item of slots.slice(0,4)) {
    if(signal?.aborted)throw Object.assign(new Error('配图流水线已取消'),{code:'JOB_CANCELLED'});
    const topic=[item.content,item.suggestedSource].filter(Boolean).join(' ').slice(0,500);
    if(!topic)continue;
    const result=await executeInformationCapabilitySlot('web-search',{query:`官方 ${topic}`,maxResults:4},{workspaceRoot,allowedCapabilities:['cap_content_web_search'],skillId:'article-image-agent',consumerId:'article-image-pipeline:web-search'});
    if(result?.status!=='ok') { warnings.push(result?.error?.message||'网络搜索失败'); continue; }
    for(const candidate of result.data?.results||[]) {
      const url=String(candidate?.url||'').trim();
      try { const parsed=new URL(url); if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)continue; } catch { continue; }
      if(sources.some((source)=>source.url===url))continue;
      sources.push({sourceId:`web-${String(sources.length+1).padStart(3,'0')}`,kind:'web-search',title:String(candidate.title||'').slice(0,300),source:String(candidate.source||new URL(url).hostname).slice(0,150),url,description:String(candidate.snippet||'').slice(0,1600),publishedAt:String(candidate.publishedAt||'')});
    }
  }
  for(const source of sources.slice(0,8)) {
    if(signal?.aborted)throw Object.assign(new Error('配图流水线已取消'),{code:'JOB_CANCELLED'});
    try {
      const fetched=await executeInformationCapabilitySlot('web-page',{targetUrl:source.url,title:source.title,root:workspaceRoot},{workspaceRoot,allowedCapabilities:['cap_content_url_fetch'],skillId:'article-image-agent',consumerId:'article-image-pipeline:source-verify'});
      if(fetched?.status==='ok') { source.content=String(fetched.data?.content||fetched.data?.text||'').slice(0,50000); source.verifiedAt=fetched.provenance?.fetchedAt||new Date().toISOString(); }
      else warnings.push(`${source.url}：${fetched?.error?.message||'网页正文抓取失败'}`);
    } catch(error) { warnings.push(`${source.url}：${String(error.message||error)}`); }
  }
  return {sources,warnings};
}

function numericTokens(value) { return new Set((String(value||'').match(/\d+(?:\.\d+)?%?/g)||[]).map((item)=>item.replace(/%$/,''))); }

async function planSourceAssignments({gateway,store,batchId,candidateId,provider,workspaceRoot,rootRunId,workflowRunId,slots,sources,articleText,searchWarning='',signal}) {
  if(!slots.length)return new Map();
  if(!sources.length)return new Map(slots.map((item)=>[item.id,{action:'needs_review',reason:`没有可用来源。${searchWarning||'请检查网络搜索槽位配置'}`.slice(0,300)}]));
  const skill=loadSkillBundle({workspaceRoot,skillName:'article-image-agent'});
  if(skill.fallback)throw new Error('配图来源规划 Agent 技能不可用');
  const availableIds=new Set(sources.map((source)=>source.sourceId));
  const input=sourceAgentInput(slots,sources,articleText);
  const result=await runPipelineStage({gateway,store,batchId,candidateId,provider,purpose:'article-image-agent-plan',skillId:'article-image-agent',entryPoint:'article-image-pipeline',stageId:'source-plan',input,messages:[
    {role:'system',content:skill.prompt,protected:true},
    {role:'user',content:JSON.stringify(input),protected:true},
  ],maxOutputTokens:2500,jsonMode:true,rootRunId,workflowRunId,signal});
  const parsed=parseModelJson(result,{store,label:'配图来源规划'});
  const assignments=new Map();
  for(const assignment of Array.isArray(parsed?.assignments)?parsed.assignments:[]){
    const imageId=String(assignment?.imageId||'');
    if(!slots.some((slot)=>slot.id===imageId)||assignments.has(imageId))continue;
    const sourceId=String(assignment?.sourceId||'');
    if(assignment?.action==='capture'&&availableIds.has(sourceId)) assignments.set(imageId,{action:'capture',sourceId,reason:String(assignment.reason||'').slice(0,300)});
    else if(assignment?.action==='datacard'&&availableIds.has(sourceId)&&assignment.spec&&typeof assignment.spec==='object') {
      const source=sources.find((item)=>item.sourceId===sourceId);
      let evidenceText=source?.content||source?.description||'';
      if(source?.kind==='web-search'&&!source?.content) {
        try {
          const fetched=await executeInformationCapabilitySlot('web-page',{targetUrl:source.url,title:source.title,root:workspaceRoot},{workspaceRoot,allowedCapabilities:['cap_content_url_fetch'],skillId:'article-image-agent',consumerId:'article-image-pipeline:source-verify'});
          if(fetched?.status==='ok')evidenceText=String(fetched.data?.content||fetched.data?.text||evidenceText);
        } catch {}
      }
      const articleNumbers=numericTokens(articleText), evidenceNumbers=numericTokens(evidenceText);
      const items=Array.isArray(assignment.spec.items)?assignment.spec.items:[];
      const values=items.flatMap((item)=>[...numericTokens(item?.value)]);
      const verified=items.length>=2&&items.length<=8&&values.length>0&&values.every((value)=>articleNumbers.has(value)&&evidenceNumbers.has(value));
      assignments.set(imageId,verified?{action:'datacard',sourceId,spec:assignment.spec,reason:String(assignment.reason||'').slice(0,300)}:{action:'needs_review',reason:'数据卡数字未能同时在终稿和联网来源摘要中核对'});
    } else if(assignment?.action==='diagram'&&assignment.spec&&typeof assignment.spec==='object') {
      const sourceIds=[...new Set((Array.isArray(assignment.sourceIds)?assignment.sourceIds:[sourceId]).map((id)=>String(id||'')).filter(Boolean))];
      const evidence=Array.isArray(assignment.spec.evidence)?assignment.spec.evidence.map((item)=>({sourceId:String(item?.sourceId||''),quote:String(item?.quote||'').trim()})):[];
      const sourceRows=sourceIds.map((id)=>sources.find((item)=>item.sourceId===id)).filter(Boolean);
      let verified=sourceIds.length>=1&&sourceIds.length<=3&&sourceRows.length===sourceIds.length&&evidence.length>0&&evidence.length<=6&&evidence.every((item)=>sourceIds.includes(item.sourceId)&&item.quote.length>=24)&&sourceIds.every((id)=>evidence.some((item)=>item.sourceId===id));
      if(verified){
        for(const source of sourceRows){
          const quotes=evidence.filter((item)=>item.sourceId===source.sourceId).map((item)=>item.quote);
          let evidenceText=String(source.content||'');
          if(!quotes.every((quote)=>evidenceText.includes(quote))&&source.url){
            try {
              const fetched=await executeInformationCapabilitySlot('web-page',{targetUrl:source.url,title:source.title,root:workspaceRoot},{workspaceRoot,allowedCapabilities:['cap_content_url_fetch'],skillId:'article-image-agent',consumerId:'article-image-pipeline:source-verify'});
              if(fetched?.status==='ok'){
                evidenceText=String(fetched.data?.content||fetched.data?.text||'');
                source.content=evidenceText.slice(0,50000);
                source.verifiedAt=fetched.provenance?.fetchedAt||source.verifiedAt||new Date().toISOString();
              }
            } catch {}
          }
          if(!quotes.every((quote)=>evidenceText.includes(quote))){verified=false;break;}
        }
      }
      assignments.set(imageId,verified?{action:'diagram',sourceIds,sourceId:sourceIds[0],spec:assignment.spec,reason:String(assignment.reason||'').slice(0,300)}:{action:'needs_review',reason:'示意图的多来源原文摘录未能逐条核验'});
    } else assignments.set(imageId,{action:'needs_review',reason:String(assignment.reason||'没有找到足够相关的公开来源').slice(0,300)});
  }
  for(const item of slots)if(!assignments.has(item.id))assignments.set(item.id,{action:'needs_review',reason:'来源规划 Agent 未为该配图选择有效来源'});
  return assignments;
}

export async function runArticleImagePipeline({gateway,store,batchId,candidateId,provider,workspaceRoot,replan=true,restartFromStart=false,rootRunId=null,workflowRunId=null,signal=null,onProgress=()=>{}}) {
  const batch=store.getBatch(batchId),candidate=store.getCandidate(Number(candidateId));
  if(!batch||!candidate||candidate.batch_id!==batchId)throw new Error('文章候选不存在或不属于当前批次');
  const workdir=candidateArticleDir(workspaceRoot,batch,candidate),finalPath=path.join(workdir,'09-FINAL.md');
  if(!fs.existsSync(finalPath))throw new Error('缺少 09-FINAL.md，请先完成成稿链');
  checkCancelled(signal);
  if(restartFromStart)archivePreviousImageRun(workdir);
  const checkpointPath=path.join(workdir,CHECKPOINT_NAME);
  let checkpoint={schemaVersion:1,batchId,candidateId:candidate.id,items:{},createdAt:new Date().toISOString()};
  try { const saved=JSON.parse(fs.readFileSync(checkpointPath,'utf8')); if(saved?.candidateId===candidate.id&&saved.items)checkpoint={...checkpoint,...saved}; } catch {}
  const persist=()=>{checkpoint.updatedAt=new Date().toISOString();const stat=writeJson(checkpointPath,checkpoint);checkpointArtifact(store,batchId,candidate.id,checkpointPath,stat);};

  let workspace=getImageWorkspace(workdir);
  const hasReadyImages=workspace.items.some((item)=>item.status==='local'||item.status==='cdn');
  const shouldReplan=Boolean(replan)&&!hasReadyImages;
  if(!workspace.planned||shouldReplan){
    onProgress(shouldReplan?'配图流水线 1/4：清理旧占位并重新规划':'配图流水线 1/4：读取终稿并规划配图位置');
    const currentMarkdown=fs.readFileSync(finalPath,'utf8');
    const markdown=shouldReplan?clearImagePlan(currentMarkdown):currentMarkdown;
    const planned=await planImagePlaceholders({gateway,store,batchId,candidateId:candidate.id,provider,markdown});
    checkCancelled(signal);
    fs.writeFileSync(finalPath,planned,'utf8');
    const existing=store.getDocument(batchId,candidate.id,'final');
    store.saveDocument({batchId,candidateId:candidate.id,kind:'final',title:existing?.title||candidate.hotspot_title||'',content:planned,filePath:finalPath,status:existing?.status||'finalized',reviewState:existing?.review_state||existing?.reviewState||null});
    const stat=fs.statSync(finalPath);store.upsertArtifact({batchId,kind:'文章终稿',name:'09-FINAL.md',path:finalPath,size:stat.size,modifiedAt:stat.mtime.toISOString()});
    workspace=getImageWorkspace(workdir);
  }

  const items=workspace.items||[],eligible=items.filter((item)=>SOURCE_TYPES.has(item.type)||item.generate||item.generated);
  const current=new Map();
  for(const item of eligible){
    const hash=slotHash(item),previous=checkpoint.items[item.id];
    const hasAsset=item.status==='local'||item.status==='cdn';
    const changedSuccessfulOutput=previous?.status==='completed'&&previous.slotHash!==hash;
    const ready=hasAsset&&!changedSuccessfulOutput;
    current.set(item.id,{imageId:item.id,slotHash:hash,action:item.generate?'generate':item.generated?'existing-generated':'capture',status:ready?'completed':'pending',sourceId:previous?.slotHash===hash?previous.sourceId||null:null,reason:'',error:'',updatedAt:new Date().toISOString()});
  }
  checkpoint.items=Object.fromEntries([...current].map(([id,state])=>[id,{...(checkpoint.items[id]||{}),...state}]));persist();
  const pending=eligible.filter((item)=>current.get(item.id).status!=='completed');
  if(!pending.length){onProgress(items.length?'配图流水线 4/4：所有配图均已就绪':'配图流水线 4/4：文章无需额外配图');return {status:'completed',candidateId:candidate.id,total:eligible.length,completed:eligible.length,needsReview:0,failed:0,items:[...current.values()]};}

  const sourceSlots=pending.filter((item)=>!item.generate&&!item.generated);
  const articleText=fs.readFileSync(finalPath,'utf8');
  const collectedSources=collectCandidateImageSources(candidate,store);
  let discovered={sources:[],warnings:[]};
  onProgress(`配图流水线 2/4：联网检索 ${sourceSlots.length} 张配图的公开来源`);
  try { discovered=await discoverImageSources({workspaceRoot,slots:sourceSlots,signal}); }
  catch(error) { if(error.code==='JOB_CANCELLED')throw error; discovered={sources:[],warnings:[String(error.message||error)]}; }
  const sources=[...collectedSources,...discovered.sources];
  let assignments=new Map();
  try { checkCancelled(signal);onProgress(`配图流水线 2/4：Agent 正在选择截图、数据卡或示意图方案`);assignments=await planSourceAssignments({gateway,store,batchId,candidateId:candidate.id,provider,workspaceRoot,rootRunId,workflowRunId,slots:sourceSlots,sources,articleText,searchWarning:discovered.warning||discovered.warnings?.join('；'),signal}); }
  catch(error){if(error.code==='JOB_CANCELLED')throw error;for(const item of sourceSlots)assignments.set(item.id,{action:'failed',reason:error.message});}

  const orderedPending=[...pending].sort((left,right)=>{
    const score=(item)=>item.generate||assignments.get(item.id)?.action==='capture'?0:1;
    return score(left)-score(right);
  });
  for(let index=0;index<orderedPending.length;index++){
    checkCancelled(signal);
    const item=orderedPending[index],state=current.get(item.id),assignment=assignments.get(item.id);
    onProgress(`配图流水线 3/4：处理 ${index+1}/${orderedPending.length} · ${item.id}`);
    state.status='running';state.action=item.generate?'generate':item.generated?'existing-generated':assignment?.action||'capture';state.startedAt=new Date().toISOString();state.error='';state.reason='';state.sourceId=assignment?.sourceId||null;persist();
    try{
      if(item.generate){
        const generated=await generateArticleImage({workspaceRoot,workdir,slotId:item.id,generate:item.generate,ratio:item.ratio});
        registerGeneratedSlotImage(workdir,item.id,generated.localPath,{generation:{mode:'structured-data',pipelineSlotHash:state.slotHash}});
      }else if(item.generated&&!item.generation?.sourceUrl){
        state.status='needs_review';state.reason='缺少可恢复的原始图表规格，请重新规划或手动补图';state.updatedAt=new Date().toISOString();onProgress(`${item.id} 暂停：${state.reason}`);persist();continue;
      }else if(assignment?.action==='needs_review'){
        state.status='needs_review';state.reason=assignment.reason||'未找到足够相关的选题来源';state.updatedAt=new Date().toISOString();onProgress(`${item.id} 暂停：${state.reason}`);persist();continue;
      }else if(assignment?.action==='datacard'){
        const source=sources.find((entry)=>entry.sourceId===assignment.sourceId);
        const verifiedAt=source?.verifiedAt||source?.fetched_at||new Date().toISOString();
        await createArticleImageAsset({workspaceRoot,workdir,imageId:item.id,input:{mode:'datacard',spec:assignment.spec,source:`${source?.title||'来源'} · ${source?.url||''} · 核验日期 ${verifiedAt.slice(0,10)}`},sources,saveLocalImage});
      }else if(assignment?.action==='diagram'){
        const linkedSources=(assignment.sourceIds||[assignment.sourceId]).map((id)=>sources.find((entry)=>entry.sourceId===id)).filter(Boolean);
        const sourceNote=`来源：${linkedSources.map((source)=>`${String(source.title||'公开原文').slice(0,36)} · ${source.url||''} · 核验日期 ${(source.verifiedAt||source.fetched_at||new Date().toISOString()).slice(0,10)}`).join('；')}`;
        await createArticleImageAsset({workspaceRoot,workdir,imageId:item.id,input:{mode:'diagram',spec:{...assignment.spec,sourceNote},source:sourceNote},sources,saveLocalImage});
      }else if(assignment?.action==='failed'){
        throw new Error(assignment.reason||'来源规划失败');
      }else{
        await createArticleImageAsset({workspaceRoot,workdir,imageId:item.id,input:{mode:'auto',sourceId:assignment?.sourceId},sources,saveLocalImage});
      }
      checkCancelled(signal);
      const manifestPath=imageManifestFile(workdir),stat=fs.statSync(manifestPath);
      store.upsertArtifact({batchId,candidateId:candidate.id,track:'article',kind:'配图资产清单',name:path.basename(manifestPath),path:manifestPath,size:stat.size,modifiedAt:stat.mtime.toISOString()});
      state.status='completed';state.completedAt=new Date().toISOString();state.updatedAt=state.completedAt;
    }catch(error){if(error.code==='JOB_CANCELLED')throw error;state.status='failed';state.error=String(error.message||error).slice(0,500);state.updatedAt=new Date().toISOString();onProgress(`${item.id} 生成失败：${state.error}`);}
    persist();
  }
  onProgress('配图流水线 4/4：保存配图结果与恢复检查点');
  const results=[...current.values()],failed=results.filter((item)=>item.status==='failed'),needsReview=results.filter((item)=>item.status==='needs_review');
  return {status:failed.length||needsReview.length?'partial':'completed',candidateId:candidate.id,total:eligible.length,completed:results.filter((item)=>item.status==='completed').length,needsReview:needsReview.length,failed:failed.length,warnings:[...(discovered.warnings||[]),...(discovered.warning?[discovered.warning]:[])],items:results,failedItems:failed.map(({imageId,error})=>({imageId,error})),needsReviewItems:needsReview.map(({imageId,reason})=>({imageId,reason}))};
}
