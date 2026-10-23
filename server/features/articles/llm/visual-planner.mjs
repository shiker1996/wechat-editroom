import { loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { resolvePrompt } from '../../../platform/llm/prompt-registry.mjs';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';

// 技能缺失时的内置回退，与 skills/article-visual-planner/SKILL.md 保持一致
const FALLBACK_SYSTEM=resolvePrompt('articles.visual-planner-fallback').text;

function parseJson(result) {
  return parseModelJson(result, { label: '图表规划' });
}

function headingKey(value) {
  return String(value||'').replace(/[*_`]/g,'').replace(/^[\s\d一二三四五六七八九十]+[、.．)）:-]\s*/,'')
    .replace(/[：:，,。！？!?（）()《》【】\s]/g,'').toLowerCase();
}

function resolveHeading(value,headings) {
  const raw=String(value||'').replace(/^#{1,3}\s+/,'').trim();
  if(headings.includes(raw))return raw;
  const key=headingKey(raw);
  const matches=headings.filter((heading)=>{
    const candidate=headingKey(heading);
    return candidate===key||(key.length>=4&&(candidate.includes(key)||key.includes(candidate)));
  });
  return matches.length===1?matches[0]:'';
}

function normalizeMermaidCode(value) {
  let code=String(value||'').trim().replace(/^```mermaid\s*/i,'').replace(/\s*```$/,'');
  code=code.replace(/^graph\s+TD\b/i,'flowchart TB').replace(/^flowchart\s+TD\b/i,'flowchart TB').replace(/^graph\s+LR\b/i,'flowchart LR');
  return code;
}

function mermaidNodeIds(code) {
  return new Set([...String(code).matchAll(/^\s*([A-Za-z][\w-]*)\s*(?:\[|\(|\{|-->|---)/gm)].map((match) => match[1]));
}

function applyMermaidFocus(code, focusNodes) {
  const available = mermaidNodeIds(code);
  const valid = [...new Set(Array.isArray(focusNodes) ? focusNodes.map((item) => String(item).trim()).filter((item) => available.has(item)) : [])].slice(0, 4);
  if (!valid.length) return { code, focusNodes:[] };
  if (/\baiFocus\b/.test(code)) return { code, focusNodes:valid };
  return { code:`${code.trim()}\nclassDef aiFocus stroke-width:4px\nclass ${valid.join(',')} aiFocus`, focusNodes:valid };
}

export function analyzeVisualComplexity(type, code) {
  if (type === 'mermaid') {
    const flow = /^flowchart\s+(?:TB|LR)\b/i.test(code);
    const sequence = /^sequenceDiagram\b/i.test(code);
    const state = /^stateDiagram-v2\b/i.test(code);
    const lines = String(code).split(/\r?\n/).filter((line) => line.trim() && !/^\s*(?:%%|flowchart|sequenceDiagram|stateDiagram-v2)/.test(line));
    const relationCount = lines.filter((line) => /-->|->>|-->>|:\s/.test(line)).length;
    const entityCount = flow
      ? new Set([...String(code).matchAll(/\b([A-Za-z][\w-]*)\s*(?:\[|\(|\{|-->|---)/g)].map((match) => match[1])).size
      : new Set([...String(code).matchAll(/^\s*(?:participant|actor|state)\s+([^\s]+)/gm)].map((match) => match[1])).size || Math.min(lines.length, 9);
    const score = entityCount * 2 + relationCount;
    return { mobileReady:entityCount <= 8 && relationCount <= 12 && score <= 26, entityCount, relationCount, score,
      warning:entityCount > 8 ? '移动端节点超过 8 个，建议拆成两张图' : relationCount > 12 ? '关系线超过 12 条，移动端阅读密度过高' : score > 26 ? '图表结构过于复杂，建议精简' : '' };
  }
  let option={};try{option=JSON.parse(code);}catch{return {mobileReady:false,score:99,warning:'ECharts 配置不是严格 JSON'};}
  const series=Array.isArray(option.series)?option.series:[];
  const categories=Math.max(Array.isArray(option.xAxis?.data)?option.xAxis.data.length:0,...series.map((item)=>Array.isArray(item.data)?item.data.length:0),0);
  const pie=series.some((item)=>item.type==='pie');
  const score=series.length*4+categories;
  return { mobileReady:series.length<=4&&categories<=(pie?6:12)&&score<=28, seriesCount:series.length, categoryCount:categories, score,
    warning:series.length>4?'数据系列超过 4 组，移动端难以辨认':categories>(pie?6:12)?`分类超过 ${pie?6:12} 项，建议筛选或改用横向条形图`:score>28?'图表信息密度过高，建议拆图':'' };
}

export function normalizeVisualPlan(value, markdown, factBase = '') {
  const headings = [...String(markdown).matchAll(/^#{1,3}\s+(.+)$/gm)].map((match) => match[1].replace(/[*_`]/g, '').trim());
  const placements = [];
  const rejections = [];
  for (const [index, raw] of (Array.isArray(value?.placements) ? value.placements : []).slice(0, 3).entries()) {
    const type = raw?.type === 'mermaid' || raw?.type === 'echarts' ? raw.type : '';
    const afterHeading = resolveHeading(raw?.afterHeading,headings);
    let code = type==='mermaid'?normalizeMermaidCode(raw?.code):String(raw?.code || '').trim();
    if (!type || !afterHeading || !code) {
      rejections.push(!afterHeading?'建议的插入章节未在正文中找到':'图表类型或代码为空');
      continue;
    }
    if (type === 'mermaid' && !/^(?:flowchart\s+(?:TB|LR)|sequenceDiagram|stateDiagram-v2)\b/i.test(code)) {
      rejections.push('Mermaid 代码不是受支持的流程图、时序图或状态图');
      continue;
    }
    if (type === 'echarts') {
      try {
        const option = JSON.parse(code);
        if (!option || Array.isArray(option) || typeof option !== 'object') continue;
        const allowedSeries = new Set(['bar','line','pie','scatter','radar']);
        if ((Array.isArray(option.series) ? option.series : []).some((series) => !allowedSeries.has(series?.type))) continue;
        const numericData = (Array.isArray(option.series) ? option.series : [])
          .flatMap((series) => Array.isArray(series?.data) ? series.data : [])
          .map((item) => typeof item === 'object' && item !== null ? item.value : item)
          .filter((item) => typeof item === 'number');
        if (!String(factBase).trim() || numericData.some((number) => !String(factBase).includes(String(number)))) {
          rejections.push('ECharts 数值未全部进入事实基座');
          continue;
        }
        code = JSON.stringify(option, null, 2);
      } catch { rejections.push('ECharts 配置不是严格 JSON');continue; }
    }
    const mermaidFocus = type === 'mermaid' ? applyMermaidFocus(code, raw?.focusNodes) : { code, focusNodes:[] };
    code = mermaidFocus.code;
    const complexity = analyzeVisualComplexity(type, code);
    placements.push({
      id:`visual-${String(index + 1).padStart(2, '0')}`, type, afterHeading,
      purpose:String(raw.purpose || '').trim(), reason:String(raw.reason || '').trim(),
      sourceRefs:Array.isArray(raw.sourceRefs) ? raw.sourceRefs.map(String).filter(Boolean).slice(0, 8) : [],
      focusNodes:mermaidFocus.focusNodes, code, fence:`\`\`\`${type}\n${code}\n\`\`\``, complexity,
    });
  }
  const summary=placements.length
    ? String(value?.summary||'发现可提升理解效率的可视化位置').trim()
    : rejections.length
      ? `发现可视化想法，但暂时无法生成：${[...new Set(rejections)].join('；')}`
      : '当前文章无需额外图表';
  return { summary, placements, rejections };
}

// 把图表围栏插入对应章节末尾（下一个同级或更高级标题之前），与编辑器手动插入的口径一致
export function insertVisualFences(markdown, placements = []) {
  let output = String(markdown || '');
  for (const item of placements) {
    if (!item?.fence || output.includes(item.fence)) continue;
    const escaped = String(item.afterHeading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) continue;
    const heading = new RegExp(`^(#{1,3})\\s+${escaped}\\s*$`, 'm').exec(output);
    if (!heading) continue;
    const sectionStart = heading.index + heading[0].length;
    const next = /\n#{1,3}\s+/.exec(output.slice(sectionStart));
    const insertAt = next ? sectionStart + next.index : output.length;
    output = `${output.slice(0, insertAt).trimEnd()}\n\n${item.fence}\n${output.slice(insertAt)}`;
  }
  return output;
}

export async function planArticleVisuals({ gateway, provider, batchId, candidateId, markdown, factBase, preferences = [], maxOutputTokens = 8000, workspaceRoot = process.cwd(), visualPolicy = 'auto' }) {
  if (visualPolicy === 'off') {
    return {
      summary: '按写作立场策略跳过自动图表；保留手动供图规划。',
      placements: [],
      rejections: [],
      skipped: true,
      reason: 'visual_policy_off',
    };
  }
  const skill = loadSkillBundle({ workspaceRoot, skillName:'article-visual-planner' });
  const system = skill.fallback ? FALLBACK_SYSTEM : skill.prompt;
  const messages=[
    { role:'system', content:system, protected:true },
    { role:'user', content:`历史编辑选择统计（仅用于建议排序，不得改变事实）：\n${JSON.stringify(preferences)}\n\n事实基座：\n${String(factBase || '未提供结构化事实基座；禁止生成 ECharts。')}\n\n文章终稿：\n${String(markdown)}`, protected:true },
  ];
  const result = await gateway.complete({
    provider, purpose:'article-visual-plan', batchId, candidateId, jsonMode:true, maxOutputTokens,
    messages,
  });
  let plan=normalizeVisualPlan(parseJson(result), markdown, factBase);
  if(plan.placements.some((item)=>!item.complexity.mobileReady)){
    const retry=await gateway.complete({
      provider,purpose:'article-visual-plan-mobile-retry',batchId,candidateId,jsonMode:true,maxOutputTokens,
      messages:[
        ...messages,
        {role:'assistant',content:JSON.stringify({summary:plan.summary,placements:plan.placements.map(({type,afterHeading,purpose,reason,sourceRefs,focusNodes,code})=>({type,afterHeading,purpose,reason,sourceRefs,focusNodes,code}))})},
        {role:'user',protected:true,content:resolvePrompt('articles.visual-planner-mobile-retry').text},
      ],
    });
    plan=normalizeVisualPlan(parseJson(retry),markdown,factBase);
  }
  const rejected=plan.placements.filter((item)=>!item.complexity.mobileReady);
  if(rejected.length){
    plan.placements=plan.placements.filter((item)=>item.complexity.mobileReady);
    plan.rejections=[...(plan.rejections||[]),'移动端复杂度返工后仍超限'];
    plan.summary=plan.placements.length
      ? `${plan.summary}；另有 ${rejected.length} 张超限图已隐藏`
      : '可视化方案在移动端复杂度返工后仍超限，未生成可插入图表';
  }
  return plan;
}
