import { renderStoryboardHtml } from '../../../features/social-cards/index.mjs';
import { compileSocialTheme } from '../../../shared/themes/social-theme-compiler.mjs';
import { validateThemeDefinition } from '../../../shared/themes/theme-validator.mjs';
import { getSocialCardTemplateCapabilities, resolveSocialCardTemplateContext } from '../../../features/social-cards/rendering/social-card-template-resolver.mjs';
import { DESKTOP_PREVIEW_COLORS as PREVIEW } from '../../../shared/desktop-preview-palette.mjs';

export const SOCIAL_THEME_SPECIMEN={
  topic:'主题样稿：把复杂内容讲清楚',repository:'example/production-preview',contentType:'repository',sourceLabel:'固定主题样稿',channelMode:'xiaohongshu',layoutStyle:'auto',compositionMode:'template',
  pages:[
    {kind:'cover',title:'如何把复杂的技术内容讲得清楚又准确',goal:'观察长封面标题、眉题与装饰'},
    {kind:'content',title:'关键指标与判断',goal:'覆盖常用内容块',content_blocks:[
      {type:'stats',title:'关键数字',items:[{num:'2.4x',label:'速度'},{num:'-12%',label:'成本'}]},
      {type:'list',title:'核心要点',items:['第一条固定要点','第二条固定要点']},
      {type:'note',title:'提示',content:'用于观察强调面板、边框和正文对比度。'},
      {type:'code',title:'代码',content:"const theme = 'preview';"},
    ]},
    {kind:'content',title:'三步完成主题配置',goal:'覆盖步骤标题、正文与序号',content_blocks:[
      {type:'steps',title:'执行步骤',items:[{title:'选择配方',content:'先确定整体造型与内容节奏。'},{title:'调整细节',content:'再微调文字、表面和边框。'},{title:'检查样稿',content:'最后确认固定画布没有溢出。'}]},
      {type:'list',title:'检查清单',items:['配方与骨架符合主题定位','对比度与密度均在预算内']},
      {type:'note',title:'提示',content:'步骤块用于观察序号、标题与正文的层级。'},
    ]},
    {kind:'content',title:'方案前后对比',goal:'覆盖对比表头、正文与边线',content_blocks:[
      {type:'compare',title:'关键差异',headers:['维度','调整前','调整后'],rows:[['控制范围','固定样式','组件级'],['AI 空间','较窄','可组合']]},
      {type:'list',title:'适用场景',items:['固定样稿对比','主题发布前检查']},
      {type:'note',title:'备注',content:'对比块用于观察表头、边框与行高。'},
    ]},
    {kind:'ending',title:'下一步',goal:'观察结尾页反色与品牌区域',content_blocks:[
      {type:'list',title:'行动提示',items:['收藏本主题样稿','在编辑器中切换配方对比']},
      {type:'note',title:'品牌区',content:'example/production-preview · 固定主题样稿'},
    ]},
  ],
};
SOCIAL_THEME_SPECIMEN.pages[0].lead='用一页讲清关键判断，再决定是否深入细节。';

const selectors={
  social:{colors:'.page',typography:'.page',spacing:'.page-inner,.page-content-stack',shape:'.page,.content-block,.code-block',surface:'.page',accentSecondary:'.eyebrow,.stat-row',line:'.page,.content-block,li',inverseText:'.page-ending,.page-ending *',codeBackground:'.code-block pre'},
};
const recipeSelectors={social:{surface:'.page-content-stack',frame:'.page',decoration:'.page:after',eyebrow:'.eyebrow',coverTitle:'.page-cover h1',skeleton:'.page',coverSupport:'.page-cover .cover-support',ending:'.page-ending',list:'.page li',code:'.code-block pre'}};
const componentSelectors={social:{coverTitle:'.page-cover h1',eyebrow:'.eyebrow',lead:'.page-cover .lead',statValue:'.stat b',statLabel:'.stat span',step:'.step',compareTable:'.compare-block table',list:'.page li',note:'.note-block',contentTitle:'.page:not(.page-cover):not(.page-ending) h1',endingTitle:'.page-ending h1'}};

function highlightSelector(target,field=''){
  if(!field)return '';
  const parts=field.split('.'),leaf=parts.at(-1),group=parts[1];
  if(parts.includes('recipes'))return recipeSelectors[target]?.[leaf]||'';
  if(parts.includes('components'))return componentSelectors[target]?.[parts[2]]||'';
  if(parts.includes('effects'))return '.page';
  return selectors[target]?.[leaf]||selectors[target]?.[group]||'';
}

function previewStyle(target,field){
  const selector=highlightSelector(target,field);
  const highlight=selector?`${selector}{outline:3px solid #E43D30!important;outline-offset:3px!important}`:'';
  return `<style data-theme-preview-shell>html{background:${PREVIEW.paperDeep}}body{margin:0;padding:24px;box-sizing:border-box}${highlight}</style>`;
}

export function compileThemePreview({target,definition,highlightField=''}){
  if(target!=='social')throw new Error('主题中心目前仅支持 social 图文主题');
  const clean=structuredClone(definition||{});delete clean.hash;delete clean.file;
  validateThemeDefinition(clean,{expectedTarget:target,expectedSource:clean.source||'user'});
  const compiled=compileSocialTheme(clean);
  const productionHtml=renderStoryboardHtml({...SOCIAL_THEME_SPECIMEN,visualStyle:clean.id,themeDefinition:clean});
  const style=previewStyle(target,highlightField);
  // 图文生产渲染器已经返回完整 HTML 文档，不能再嵌套另一层 body。
  const html=productionHtml.replace('</head>',`${style}</head>`);
  const templateContext=target==='social'?resolveSocialCardTemplateContext({themeDefinition:clean,channelMode:clean.channelMode||'xiaohongshu'}):null;
  return {schemaVersion:1,target,html,usageMap:compiled.usageMap,highlightField,theme:{id:compiled.id,label:compiled.label,version:compiled.version,hash:compiled.hash},template:templateContext?{...getSocialCardTemplateCapabilities({themeDefinition:clean,channelMode:'xiaohongshu'}),pack:templateContext.pack.id,version:templateContext.pack.version,label:templateContext.pack.label,source:templateContext.source,compatibility:templateContext.pack.id==='standard-v1'||templateContext.fallback,roleTemplates:{...templateContext.pack.roleTemplates},matching:clean.social?.templateMatch||null}:null};
}
