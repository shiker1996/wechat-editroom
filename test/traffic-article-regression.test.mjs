import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = process.env.TRAFFIC_ARTICLE_FIXTURE_DIR || 'E:/Downloads';
const fixtures = [
  { file: '拼多多被罚15亿那天，一个骑手在凌晨倒下了.html', terms: ['15亿', '骑手', '10万'], placement: 'woven' },
  { file: '小红书这次赌世界杯，赢了吗？.html', terms: ['世界杯', '流量来了'], placement: 'woven' },
  { file: '这家外企裁员16%，外资科技寒冬真的来了.html', terms: ['裁员', '打工人'], placement: 'standalone_h2' },
];

function visibleText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

for (const fixture of fixtures) {
  test(`历史流量文回归：${fixture.file}`, (t) => {
    const file = `${root}/${fixture.file}`;
    if (!fs.existsSync(file)) {
      t.skip(`本机没有样本文件：${file}`);
      return;
    }
    const html = fs.readFileSync(file, 'utf8');
    const text = visibleText(html);
    assert.ok(text.length > 1000, '样本正文应有足够长度');
    assert.ok((html.match(/<h[1-6][^>]*>/gi) || []).length >= 3, '样本应有可识别的分段结构');
    for (const term of fixture.terms) assert.ok(text.includes(term), `样本应包含关键事实/读者收益信号：${term}`);
    assert.match(fixture.placement, /^(?:woven|standalone_h2|ending)$/);
  });
}
