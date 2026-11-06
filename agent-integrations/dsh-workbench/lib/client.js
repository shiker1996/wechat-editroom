window.__ModuleLoader__.load({
  id: 'jianzi-content-workbench',
  factory: (require) => {
    const React = require('react');
    const styles = `
      .jianzi-workbench{height:100%;min-height:0;display:flex;flex-direction:column;background:#f7f7f5;color:#20211f;font:14px/1.5 system-ui,sans-serif;container-type:inline-size}
      .jianzi-workbench [data-dsh-workbench-toolbar]{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;background:#fff;border-bottom:1px solid #e8e7e2}
      .jianzi-workbench a{color:inherit;text-decoration:none}.jianzi-workbench header a{border:1px solid #deddd8;border-radius:8px;padding:8px 12px;white-space:nowrap}
      .jianzi-workbench main{width:min(100%,1000px);margin:0 auto;padding:40px 28px;overflow:auto}.jianzi-workbench h1{font-size:30px;margin:0 0 10px}.jianzi-workbench p{color:#65665f;max-width:680px}
      .jianzi-workbench__steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:28px 0}
      .jianzi-workbench__step{display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:22px;background:#fff;border:1px solid #e8e7e2;border-radius:14px;min-height:168px}
      .jianzi-workbench__step span{color:#8b6b43;font-size:12px;font-weight:700}.jianzi-workbench__step strong{font-size:18px}.jianzi-workbench__step small{color:#66675f;flex:1}.jianzi-workbench__step b{font-size:13px;color:#705333}
      .jianzi-workbench__note{padding:14px 16px;background:#efeee9;border-radius:10px}
      @container (max-width:700px){.jianzi-workbench__steps{grid-template-columns:1fr}.jianzi-workbench main{padding:24px 16px}}
    `;
    function Panel() {
      return React.createElement(React.Fragment, null,
        React.createElement('style', null, styles),
        React.createElement('section', { className: 'jianzi-workbench' },
          React.createElement('header', { 'data-dsh-workbench-toolbar': '' }, React.createElement('strong', null, '见字内容工作台'), React.createElement('a', { href: 'http://127.0.0.1:4317/', target: '_blank', rel: 'noreferrer' }, '打开见字')),
          React.createElement('main', null,
            React.createElement('h1', null, '从热点走到可交付文章'),
            React.createElement('p', null, '在 DSH 中让 Agent 采集热点、研判选题、推进文章与排版；业务记录由本机见字工作台保存。'),
            React.createElement('div', { className: 'jianzi-workbench__steps' }, ...[
              ['01', '采集与选题', '创建批次、收集热点并查看选题排名。', '#topics'],
              ['02', '文章生产', '选择候选，读取事实材料并生成或保存文章。', '#editorial'],
              ['03', '排版交付', '完成终稿后生成公众号排版并查看预览。', '#preview'],
            ].map(([number, title, detail, path]) => React.createElement('a', { className: 'jianzi-workbench__step', href: `http://127.0.0.1:4317/${path}`, target: '_blank', rel: 'noreferrer', key: number }, React.createElement('span', null, number), React.createElement('strong', null, title), React.createElement('small', null, detail), React.createElement('b', null, '打开流程 →')))),
            React.createElement('p', { className: 'jianzi-workbench__note' }, 'Agent 可调用见字 jianzi_* 工具。文章终稿需经你确认后再排版。'))));
    }
    function apply(ctx) { ctx.effect(() => ctx.desktopWorkbenches.register({ title: '见字内容工作台', description: '从热点选题到公众号文章和排版交付。', customFrame: true, headerLayout: 'compact' }, Panel)); }
    return { apply, inject: ['desktopWorkbenches'] };
  }
});
