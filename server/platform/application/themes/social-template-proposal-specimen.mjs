// Fixed structural sample used to audit proposed page templates. It carries no
// user-selectable visual theme and exercises the renderer's supported blocks.
export const SOCIAL_TEMPLATE_PROPOSAL_SPECIMEN = Object.freeze({
  topic: '模板结构校验：把复杂内容讲清楚',
  repository: 'example/production-preview',
  contentType: 'repository',
  sourceLabel: '结构校验样稿',
  channelMode: 'xiaohongshu',
  layoutStyle: 'auto',
  compositionMode: 'template',
  pages: [
    { kind: 'cover', title: '如何把复杂的技术内容讲得清楚又准确', goal: '验证长标题和封面组件', lead: '先讲清关键判断，再决定是否深入细节。' },
    { kind: 'content', title: '关键指标与判断', goal: '覆盖常用内容块', content_blocks: [
      { type: 'stats', title: '关键数字', items: [{ num: '2.4x', label: '速度' }, { num: '-12%', label: '成本' }] },
      { type: 'list', title: '核心要点', items: ['保留必要事实', '清楚表达变化'] },
      { type: 'note', title: '提示', content: '用于检查强调面板和正文对比。' },
      { type: 'code', title: '代码', content: "const layout = 'checked';" },
    ] },
    { kind: 'content', title: '执行步骤', goal: '覆盖步骤标题、正文与序号', content_blocks: [
      { type: 'steps', title: '执行步骤', items: [{ title: '确认结构', content: '先核对页面目标。' }, { title: '检查承载', content: '再检查内容块容量。' }, { title: '验证样稿', content: '最后检查页面边界。' }] },
      { type: 'list', title: '检查清单', items: ['结构符合契约', '页面没有溢出'] },
    ] },
    { kind: 'content', title: '方案对比', goal: '覆盖表头、正文与边线', content_blocks: [
      { type: 'compare', title: '关键差异', headers: ['维度', '原方案', '新方案'], rows: [['内容承载', '固定样式', '按契约校验'], ['页面结构', '单一布局', '按角色配置']] },
      { type: 'note', title: '备注', content: '对比块用于检查表格层级和行高。' },
    ] },
    { kind: 'ending', title: '校验完成', goal: '检查结尾页结构', content_blocks: [
      { type: 'list', title: '结果', items: ['模板结构通过检查', '可继续验证页面渲染'] },
      { type: 'note', title: '样稿', content: 'example/production-preview · 结构校验' },
    ] },
  ],
});
