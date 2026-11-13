import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { candidateArticleDir } from '../../../platform/core/workspace-paths.mjs';
import { runPipelineStage } from '../../../platform/skills/pipeline-runtime.mjs';
import { loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { collectCandidateImageSources } from './article-image-sources.mjs';
import { createArticleImageAsset } from './article-image-create.mjs';
import { generateArticleImage } from './article-image-generator.mjs';
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

function checkCancelled(signal) {
  if(signal?.aborted) throw Object.assign(new Error(signal.reason?.message||'配图流水线已取消'),{code:'JOB_CANCELLED'});
}

function sourceAgentInput(slots,sources) {
  return {slots:slots.map((item)=>({imageId:item.id,description:item.content,position:item.position,suggestedSource:item.suggestedSource})),
    sources:sources.slice(0,30).map((source)=>({sourceId:source.sourceId,title:source.title,site:source.source||source.source_name||'',url:source.url,excerpt:String(source.description||source.content||'').slice(0,1000)}))};
}

async function planSourceAssignments({gateway,store,batchId,candidateId,provider,workspaceRoot,rootRunId,workflowRunId,slots,sources,signal}) {
  if(!slots.length)return new Map();
  if(!sources.length)return new Map(slots.map((item)=>[item.id,{action:'needs_review',reason:'当前选题没有可用的已采集来源'}]));
  const skill=loadSkillBundle({workspaceRoot,skillName:'article-image-agent'});
  if(skill.fallback)throw new Error('配图来源规划 Agent 技能不可用');
  const availableIds=new Set(sources.map((source)=>source.sourceId));
  const result=await runPipelineStage({gateway,store,batchId,candidateId,provider,purpose:'article-image-agent-plan',skillId:'article-image-agent',entryPoint:'article-image-pipeline',stageId:'source-plan',input:sourceAgentInput(slots,sources),messages:[
    {role:'system',content:skill.prompt,protected:true},
    {role:'user',content:JSON.stringify(sourceAgentInput(slots,sources)),protected:true},
  ],maxOutputTokens:2500,jsonMode:true,rootRunId,workflowRunId,signal});
  const parsed=parseModelJson(result,{store,label:'配图来源规划'});
  const assignments=new Map();
  for(const assignment of Array.isArray(parsed?.assignments)?parsed.assignments:[]){
    const imageId=String(assignment?.imageId||'');
    if(!slots.some((slot)=>slot.id===imageId)||assignments.has(imageId))continue;
    const sourceId=String(assignment?.sourceId||'');
    assignments.set(imageId,assignment?.action==='capture'&&availableIds.has(sourceId)
      ?{action:'capture',sourceId,reason:String(assignment.reason||'').slice(0,300)}
      :{action:'needs_review',reason:String(assignment.reason||'没有找到足够相关的采集来源').slice(0,300)});
  }
  for(const item of slots)if(!assignments.has(item.id))assignments.set(item.id,{action:'needs_review',reason:'来源规划 Agent 未为该配图选择有效来源'});
  return assignments;
}

export async function runArticleImagePipeline({gateway,store,batchId,candidateId,provider,workspaceRoot,replan=true,rootRunId=null,workflowRunId=null,signal=null,onProgress=()=>{}}) {
  const batch=store.getBatch(batchId),candidate=store.getCandidate(Number(candidateId));
  if(!batch||!candidate||candidate.batch_id!==batchId)throw new Error('文章候选不存在或不属于当前批次');
  const workdir=candidateArticleDir(workspaceRoot,batch,candidate),finalPath=path.join(workdir,'09-FINAL.md');
  if(!fs.existsSync(finalPath))throw new Error('缺少 09-FINAL.md，请先完成成稿链');
  checkCancelled(signal);
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
  const sources=collectCandidateImageSources(candidate,store);
  let assignments=new Map();
  try { checkCancelled(signal);onProgress(`配图流水线 2/4：Agent 正在匹配 ${sourceSlots.length} 张来源配图与选题采集报道`);assignments=await planSourceAssignments({gateway,store,batchId,candidateId:candidate.id,provider,workspaceRoot,rootRunId,workflowRunId,slots:sourceSlots,sources,signal}); }
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
  return {status:failed.length||needsReview.length?'partial':'completed',candidateId:candidate.id,total:eligible.length,completed:results.filter((item)=>item.status==='completed').length,needsReview:needsReview.length,failed:failed.length,items:results,failedItems:failed.map(({imageId,error})=>({imageId,error})),needsReviewItems:needsReview.map(({imageId,reason})=>({imageId,reason}))};
}
