import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatAccountContext, isAccountContextConfigured, loadAccountContext, saveAccountContext } from '../server/shared/domain/account-context.mjs';

const appHtml = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const mainJs = fs.readFileSync(new URL('../public/src/main.js', import.meta.url), 'utf8');

test('账号画像独立于运行配置，位于发布分组', () => {
  assert.match(appHtml, /data-nav-group="publication"[\s\S]*data-view="account"[\s\S]*账号画像/);
  assert.match(appHtml, /id="view-account"[\s\S]*id="account-context-editor"/);
  assert.doesNotMatch(appHtml.match(/id="view-system"[\s\S]*?<\/section>\s*<section class="view" id="view-themes"/)?.[0] || '', /account-context-editor/);
  assert.match(mainJs, /account:\s*"\.\/views\/account\.js"/);
  assert.match(mainJs, /account:\s*"账号画像"/);
});

test('账号上下文格式化双分发策略与通知资格', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'account-context-'));
  const file = path.join(root, 'account-context.json');
  fs.writeFileSync(file, JSON.stringify({
    name: '虚构账号',
    distributionStrategy: {
      recommendation: {
        purpose: '拉新',
        preferredTopics: ['工具', '方法'],
        titleRule: '场景 + 结果',
      },
      notification: {
        purpose: '维护读者',
        preferredTopics: ['职场'],
        titleRule: '事件 + 影响',
      },
    },
    notificationPolicy: {
      minimumMatchedCriteria: 2,
      minimumNotificationFit: 4,
      minimumFactSupport: 4,
      maxPerBatch: 2,
      blockedRiskLevels: ['高', '较高'],
      readerStakes: ['工作', '成本'],
      criteria: ['影响工作', '有明确判断'],
    },
  }), 'utf8');

  loadAccountContext(file);
  const formatted = formatAccountContext();
  assert.match(formatted, /## 分发策略/);
  assert.match(formatted, /### 推荐池/);
  assert.match(formatted, /优先内容：工具、方法/);
  assert.match(formatted, /### 通知池/);
  assert.match(formatted, /## 通知资格/);
  assert.match(formatted, /最少满足条件数：2/);
  assert.match(formatted, /最低通知适配分：4\/5/);
  assert.match(formatted, /最低事实支持分：4\/5/);
  assert.match(formatted, /每批通知池上限：2 条/);
  assert.match(formatted, /禁止进入通知池的风险等级：高、较高/);
  assert.match(formatted, /读者利益：工作、成本/);
});

test('账号上下文可由表单初始化并保留高级配置', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'account-context-save-'));
  const file = path.join(root, 'account-context.json');
  fs.writeFileSync(file, JSON.stringify({ scoring: { eventValueWeight: 0.1 }, name: '旧账号' }), 'utf8');

  const saved = saveAccountContext({
    name: '新账号',
    description: '面向真实读者的内容账号',
    readerProfile: '关注实际问题的读者',
    contentPillars: ['方向一', '方向二'],
    voiceGuardrails: ['不夸大事实'],
  }, { filePath: file });

  assert.equal(saved.name, '新账号');
  assert.deepEqual(saved.contentPillars, ['方向一', '方向二']);
  assert.deepEqual(saved.scoring, { eventValueWeight: 0.1 });
  assert.equal(isAccountContextConfigured(saved, { filePath: file }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).voiceGuardrails, ['不夸大事实']);
});
