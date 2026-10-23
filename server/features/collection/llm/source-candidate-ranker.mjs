import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { resolvePrompt } from '../../../platform/llm/prompt-registry.mjs';
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);

function parse(result){return parseModelJson(result,{label:'采集候选排序'});}

export async function rankSourceCandidates({gateway,provider,intent,page,candidates}){
  const goal=clean(intent,160);if(!gateway||!goal||candidates.length<2)return {candidates,aiApplied:false};
  const safeCandidates=candidates.map((candidate,index)=>({index,name:clean(candidate.name,80),reason:clean(candidate.reason),matched:candidate.validation?.matched||0,itemCount:candidate.validation?.itemCount||0,samples:(candidate.preview||[]).slice(0,3).map((item)=>clean(item.title,160))}));
  try{
    const result=await gateway.complete({provider,purpose:'source-candidate-ranking',jsonMode:true,thinking:false,temperature:0,maxOutputTokens:800,messages:[
      {role:'system',protected:true,content:resolvePrompt('collection.source-candidate-ranker').text},
      {role:'user',protected:true,content:JSON.stringify({intent:goal,page:{title:clean(page?.title,120),url:clean(page?.url,500),mode:page?.mode},candidates:safeCandidates})},
    ]});
    const value=parse(result),expected=new Set(candidates.map((_,index)=>index)),order=Array.isArray(value.order)?value.order.map(Number):[];
    if(order.length!==candidates.length||new Set(order).size!==order.length||order.some((index)=>!expected.has(index)))throw new Error('模型返回的候选顺序无效');
    return {candidates:order.map((index)=>candidates[index]),aiApplied:true,aiReason:clean(value.reason,240)};
  }catch(error){return {candidates,aiApplied:false,aiWarning:`AI 排序未生效，已保留确定性排序：${error.message}`};}
}
