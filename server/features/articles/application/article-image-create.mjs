import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureBrowserPage } from '../../../../plugins/browser-web-page/runner.mjs';
import { generateArticleImage } from './article-image-generator.mjs';
import { getImageWorkspace, registerGeneratedSlotImage } from './image-workflow.mjs';

const run=promisify(execFile);
const echartsScript=path.resolve(import.meta.dirname,'../../../../plugins/echarts-render/scripts/render-echarts.mjs');
const IMAGE_MATCH_STOPWORDS=new Set(['图片','配图','来源','报道','文章','内容','数据','图表','相关','信息','发布','表示','进行','以及','这是','通过','目前','公司','报告','新闻','the','and','for','with','from','this','that','have','has']);

function imageTerms(value) {
  const text=String(value||'').toLowerCase();
  const terms=new Set((text.match(/[a-z0-9][a-z0-9._+-]{1,}/g)||[]).filter((term)=>!IMAGE_MATCH_STOPWORDS.has(term)));
  for(const phrase of text.match(/[\u3400-\u9fff]{2,}/g)||[]){
    if(phrase.length<=8&&!IMAGE_MATCH_STOPWORDS.has(phrase))terms.add(phrase);
    for(let index=0;index<phrase.length-1;index++){
      const term=phrase.slice(index,index+2);
      if(!IMAGE_MATCH_STOPWORDS.has(term))terms.add(term);
    }
  }
  return terms;
}

export function selectArticleImageSource(image, sources=[]) {
  const target=imageTerms(`${image?.content||''} ${image?.suggestedSource||''}`);
  const ranked=(Array.isArray(sources)?sources:[]).map((source)=>{
    const url=String(source?.final_url||source?.url||'').trim();
    try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)return null;}catch{return null;}
    const titleTerms=imageTerms(source.title),bodyTerms=imageTerms(`${source.description||''} ${String(source.content||'').slice(0,10000)}`);
    const titleHits=[...target].filter((term)=>titleTerms.has(term)).length;
    const bodyHits=[...target].filter((term)=>bodyTerms.has(term)).length;
    const relevance=target.size?Math.min(1,(titleHits*2+bodyHits*0.2)/Math.max(4,target.size*0.45)):0;
    const quality=(String(source.status||'').toLowerCase()==='ok'?0.12:0)+(String(source.content||'').length>300?0.06:0);
    return {source,url,relevance,quality,score:relevance+quality};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||b.quality-a.quality);
  if(!ranked.length)throw new Error('当前选题没有可用的采集报道来源，无法自动配图');
  const selected=ranked[0];
  return {...selected.source,url:selected.url,matchScore:Number(selected.relevance.toFixed(3)),matchType:selected.relevance>0?'content-match':'related-topic-fallback'};
}

function selectSourceById(sourceId, sources=[]) {
  if (!sourceId) return null;
  const selected=(Array.isArray(sources)?sources:[]).find((source)=>String(source?.sourceId||'')===String(sourceId));
  if (!selected) throw new Error('配图 Agent 选择的来源不在当前选题采集来源中');
  const url=String(selected.final_url||selected.url||'').trim();
  try { const parsed=new URL(url); if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password) throw new Error(); }
  catch { throw new Error('所选采集来源 URL 无效'); }
  return {...selected,url};
}

function validateSpec(mode,spec) {
  if(!spec||typeof spec!=='object'||Array.isArray(spec))throw new Error('spec 必须是 JSON 对象');
  if(mode==='timeline'||mode==='datacard'){
    const items=Array.isArray(spec.items)?spec.items:[];
    if(items.length<2||items.length>8)throw new Error('时间轴或数据卡必须包含 2–8 项');
    const normalized=items.map((item)=>({label:String(item?.label||'').trim().slice(0,40),value:String(item?.value||'').trim().slice(0,80)}));
    if(normalized.some((item)=>!item.label||!item.value))throw new Error('每项都需要非空 label 和 value');
    return {kind:mode, title:String(spec.title||'').trim().slice(0,60), items:normalized};
  }
  if(mode==='diagram'){
    const nodes=Array.isArray(spec.nodes)?spec.nodes:[],edges=Array.isArray(spec.edges)?spec.edges:[];
    if(nodes.length<2||nodes.length>8||edges.length<1||edges.length>12)throw new Error('示意图需要 2–8 个节点和 1–12 条连线');
    const normalizedNodes=nodes.map((node)=>({id:String(node?.id||'').trim(),label:String(node?.label||'').trim().slice(0,48),detail:String(node?.detail||'').trim().slice(0,80),level:Number(node?.level)}));
    if(normalizedNodes.some((node)=>! /^[a-z0-9_-]{1,24}$/i.test(node.id)||!node.label||!Number.isInteger(node.level)||node.level<0||node.level>3))throw new Error('示意图节点需要有效 id、label 和 0–3 的 level');
    if(new Set(normalizedNodes.map((node)=>node.id)).size!==normalizedNodes.length)throw new Error('示意图节点 id 不能重复');
    if([0,1,2,3].some((level)=>normalizedNodes.filter((node)=>node.level===level).length>2))throw new Error('每个示意图层级最多放置 2 个节点');
    const ids=new Set(normalizedNodes.map((node)=>node.id));
    const normalizedEdges=edges.map((edge)=>({from:String(edge?.from||''),to:String(edge?.to||''),label:String(edge?.label||'').trim().slice(0,24)}));
    if(normalizedEdges.some((edge)=>!ids.has(edge.from)||!ids.has(edge.to)||edge.from===edge.to))throw new Error('示意图连线必须引用不同的有效节点');
    const nodeById=new Map(normalizedNodes.map((node)=>[node.id,node]));
    if(normalizedEdges.some((edge)=>nodeById.get(edge.from).level>=nodeById.get(edge.to).level))throw new Error('示意图连线必须从前层指向后层');
    const evidence=Array.isArray(spec.evidence)?spec.evidence.map((item)=>typeof item==='string'?{sourceId:'',quote:item.trim().slice(0,500)}:{sourceId:String(item?.sourceId||'').trim().slice(0,80),quote:String(item?.quote||'').trim().slice(0,500)}).filter((item)=>item.quote).slice(0,6):[];
    if(!evidence.length)throw new Error('示意图必须提供来源原文证据摘录');
    return {kind:'diagram',title:String(spec.title||'').trim().slice(0,60),nodes:normalizedNodes,edges:normalizedEdges,evidence,sourceNote:String(spec.sourceNote||'').trim().slice(0,280)};
  }
  if(mode==='echarts'){
    const text=JSON.stringify(spec.option||{});
    if(text.length>50000)throw new Error('ECharts 配置超过 50KB');
    if(/https?:\/\/|javascript:|<script/i.test(text))throw new Error('ECharts 配置不能引用外部资源或脚本');
    if(!spec.option||typeof spec.option!=='object'||Array.isArray(spec.option))throw new Error('ECharts option 必须是 JSON 对象');
    if(typeof spec.option.backgroundColor==='string'&&!/^(#[0-9a-f]{3,8}|rgba?\([\d.,% ]+\)|[a-z]{1,20})$/i.test(spec.option.backgroundColor))throw new Error('ECharts backgroundColor 格式不受支持');
    if(spec.option.series!==undefined&&!Array.isArray(spec.option.series))throw new Error('ECharts series 必须是数组');
    if(Array.isArray(spec.option.series)&&spec.option.series.length>6)throw new Error('ECharts 最多支持 6 个系列');
    if((spec.option.series||[]).some((item)=>item?.type&&!['line','bar','pie','scatter'].includes(item.type)))throw new Error('ECharts 仅支持 line、bar、pie、scatter 系列');
    const pointCount=(spec.option.series||[]).reduce((sum,item)=>sum+(Array.isArray(item?.data)?item.data.length:0),0);
    if(pointCount>300)throw new Error('ECharts 数据点不能超过 300');
    return spec.option;
  }
  throw new Error('mode 仅支持 auto、capture、timeline、datacard、diagram、echarts');
}

export async function createArticleImageAsset({workspaceRoot,workdir,imageId,input={},sources=[],saveLocalImage}) {
  const workspace=getImageWorkspace(workdir),slot=workspace.items.find((item)=>item.id===imageId);
  if(!slot)throw new Error('配图占位不存在');
  const mode=String(input.mode||'');
  let localPath,source='',generation={mode,generatedAt:new Date().toISOString()};
  if(mode==='auto'||mode==='capture'){
    const selected=mode==='auto'?(input.sourceId?selectSourceById(input.sourceId,sources):selectArticleImageSource(slot,sources)):null;
    const url=selected?.url||input.url;
    if(typeof url!=='string'||url.length>2048)throw new Error(mode==='auto'?'没有找到可用的选题来源报道':'capture 需要不超过 2048 字符的公开网页 URL');
    const captured=await captureBrowserPage({url,selector:input.selector,width:input.width,height:input.height,fullPage:input.fullPage},{root:workspaceRoot});
    if(captured.status!=='ok'||!captured.base64)throw new Error('网页截图没有产生图片');
    source=selected?`${selected.title||captured.title||'选题采集来源'} · ${captured.url}`:captured.url;
    generation={...generation,mode:selected?'auto-source-capture':mode,title:captured.title,sourceUrl:captured.url,renderer:captured.provenance?.fetchMethod||'isolated-browser',...(selected?{selectedSourceId:selected.sourceId||'',selectedSourceTitle:selected.title||'',sourceMatchType:selected.matchType||'agent-source-selection',sourceMatchScore:selected.matchScore}: {})};
    return saveLocalImage(workdir,imageId,{fileName:`${imageId.replace(':','-')}.png`,mimeType:'image/png',base64:captured.base64,source,copyright:'待确认',generation});
  }
  const spec=validateSpec(mode,input.spec);
  const imageDir=path.join(workdir,'images');fs.mkdirSync(imageDir,{recursive:true});
  if(mode==='timeline'||mode==='datacard'||mode==='diagram'){
    ({localPath}=await generateArticleImage({workspaceRoot,workdir,slotId:imageId,generate:spec,ratio:slot.ratio}));
    generation={...generation,spec};
  } else {
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'article-echarts-'));
    try{
      const md=path.join(temp,'chart.md'),out=path.join(temp,'rendered.md'),img=path.join(temp,'images');fs.mkdirSync(img,{recursive:true});
      fs.writeFileSync(md,`\`\`\`echarts\n${JSON.stringify(spec)}\n\`\`\`\n`,'utf8');
      await run(process.execPath,[echartsScript,md,out,img],{cwd:workspaceRoot,windowsHide:true,timeout:90000,maxBuffer:1_000_000});
      const rendered=path.join(img,'echarts-1.png');if(!fs.existsSync(rendered)||!fs.statSync(rendered).size)throw new Error('ECharts 没有生成 PNG');
      if(fs.statSync(rendered).size>8*1024*1024)throw new Error('生成的图表超过 8MB');
      localPath=path.join(imageDir,`${imageId.replace(':','-')}.png`);fs.copyFileSync(rendered,localPath);
      generation={...generation,renderer:'echarts-json',specHash:Buffer.from(JSON.stringify(spec)).toString('base64url').slice(0,64)};
    } finally {fs.rmSync(temp,{recursive:true,force:true});}
  }
  return registerGeneratedSlotImage(workdir,imageId,localPath,{source:String(input.source||'').slice(0,1000),copyright:'待确认',generation});
}
