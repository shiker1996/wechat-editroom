#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJianziClient } from './client.mjs';
import { executeJianziTool } from './tools.mjs';
import { agentIntegrationRoot, installAgentIntegration } from './install.mjs';
import { createCodexOAuthService } from '../../server/platform/integrations/codex-oauth.mjs';
import { getAgentRuntimeSettings, setAgentRuntimeSettings } from '../../server/platform/integrations/agent-runtime-settings.mjs';
import { loginCodexOAuth } from './codex-auth.mjs';

const cliPath = fileURLToPath(import.meta.url);
const root = agentIntegrationRoot();

function parse(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) { options[key] = next; index += 1; }
    else options[key] = true;
  }
  return { positional, options };
}

function jsonOption(value, fallback) {
  if (value == null || value === true) return fallback;
  try { return JSON.parse(value); }
  catch { throw new Error(`JSON 参数无法解析：${value}`); }
}

function jsonFileOption(filePath, inlineValue, fallback) {
  if (filePath && filePath !== true) {
    const resolved = path.resolve(String(filePath));
    try { return JSON.parse(fs.readFileSync(resolved, 'utf8')); }
    catch (error) { throw new Error(`无法读取 JSON 文件 ${resolved}：${error.message}`); }
  }
  return jsonOption(inlineValue, fallback);
}

function booleanOption(value, fallback) {
  if (value == null || value === true) return fallback;
  if (value === false) return false;
  if (/^(true|1|yes|on)$/i.test(String(value))) return true;
  if (/^(false|0|no|off)$/i.test(String(value))) return false;
  throw new Error(`布尔参数无效：${value}`);
}

function print(value, asJson = false) {
  process.stdout.write(`${JSON.stringify(value, null, asJson ? 0 : 2)}\n`);
}

function help() {
  process.stdout.write(`见字 Agent CLI（jianzi）\n\n用法：\n  node scripts/agent-integration/cli.mjs doctor [--json]\n  node scripts/agent-integration/cli.mjs install --agent codex|workbuddy|both\n  node scripts/agent-integration/cli.mjs workbench-setup [--yes]\n  node scripts/agent-integration/cli.mjs auth codex login|status|logout [--json]\n  node scripts/agent-integration/cli.mjs batch list|create|collect|auto|ranking|candidates ...\n  node scripts/agent-integration/cli.mjs candidate add|get|update|lock ...\n  node scripts/agent-integration/cli.mjs article generate|documents|typeset ...\n  node scripts/agent-integration/cli.mjs cover generate ...\n  node scripts/agent-integration/cli.mjs account profile|update --file <json>\n  node scripts/agent-integration/cli.mjs collectors list|config-list|config-get|config-set|config-test ...\n  node scripts/agent-integration/cli.mjs sources list|capabilities|add|update|test ...\n  node scripts/agent-integration/cli.mjs card editorial|storyboard|update|lock|generate ...\n  node scripts/agent-integration/cli.mjs job get|wait ...\n  node scripts/agent-integration/cli.mjs mcp\n\n写操作和长任务返回 JSON；异步任务使用 job get/wait 查询。AI 任务由当前默认 Agent Runtime 或工作台模型执行，取决于该任务是否接入外部 Runtime。\n`);
}

async function dispatch(positional, options) {
  const [group, action] = positional;
  const client = createJianziClient({ baseUrl: options.server === true ? undefined : options.server });
  if (!group || group === 'help' || options.help) return help();
  if (group === 'auth') {
    const [provider, verb] = positional.slice(1);
    if (provider !== 'codex' || !['login', 'status', 'logout'].includes(verb)) throw new Error('用法：jianzi auth codex login|status|logout');
    const oauth = createCodexOAuthService({ root });
    if (verb === 'status') {
      const status = await oauth.status();
      return print({ provider: status.provider, configured: status.configured, expiresAt: status.expiresAt, defaultRuntime: getAgentRuntimeSettings(root).defaultRuntime }, Boolean(options.json));
    }
    if (verb === 'login') {
      const result = await loginCodexOAuth({ root, service: oauth, onWaiting: () => process.stderr.write('正在打开 ChatGPT 授权页面，请在浏览器中完成登录；完成后会自动返回终端。\n') });
      if (result.configured) setAgentRuntimeSettings(root, { defaultRuntime: 'codex' });
      return print({ ...result, defaultRuntime: getAgentRuntimeSettings(root).defaultRuntime }, Boolean(options.json));
    }
    oauth.disconnect();
    if (getAgentRuntimeSettings(root).defaultRuntime === 'codex') setAgentRuntimeSettings(root, { defaultRuntime: 'local-harness' });
    return print({ provider: 'codex', configured: false, defaultRuntime: getAgentRuntimeSettings(root).defaultRuntime }, Boolean(options.json));
  }
  if (group === 'mcp') {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'agent-integration', 'mcp-server.mjs')], { cwd: root, stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
    return;
  }
  if (group === 'install') return print(installAgentIntegration({ agent: String(options.agent || 'both') }), Boolean(options.json));
  if (group === 'workbench-setup') {
    const script = path.join(root, 'scripts', 'runtime', 'setup.mjs');
    const result = spawnSync(process.execPath, [script, ...(options.yes ? ['--yes'] : [])], { cwd: root, stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
    return;
  }
  if (group === 'doctor') {
    const health = await executeJianziTool(client, 'jianzi_doctor');
    const integration = {
      codexConfig: path.join(root, '.codex', 'config.toml'),
      workbuddyConfig: path.join(root, '.mcp.json'),
      skillSource: path.join(root, 'agent-integrations', 'skills'),
    };
    return print({ ...health, integration, nodeSupported: Number(process.versions.node.split('.')[0]) >= 24 }, Boolean(options.json));
  }
  let toolName = '';
  const mapped = {
    'batch:list': ['jianzi_batches_list', {}],
    'batch:create': ['jianzi_batch_create', { date: options.date, title: options.title, note: options.note }],
    'batch:collect': ['jianzi_batch_collect', { batchId: options.batch, maxAgeHours: options.maxAgeHours ? Number(options.maxAgeHours) : undefined }],
    'batch:auto': ['jianzi_batch_auto_research', { batchId: options.batch, provider: options.provider }],
    'batch:ranking': ['jianzi_batch_ranking', { batchId: options.batch }],
    'batch:candidates': ['jianzi_batch_candidates', { batchId: options.batch, track: options.track, kind: options.kind }],
    'candidate:add': ['jianzi_candidate_add', { batchId: options.batch, hotspotIds: jsonOption(options.hotspotIds, []), tracks: jsonOption(options.tracks, ['article']) }],
    'candidate:get': ['jianzi_candidate_get', { candidateId: options.candidate }],
    'candidate:update': ['jianzi_candidate_editorial_update', { candidateId: options.candidate, editorial: jsonOption(options.editorial, {}) }],
    'candidate:lock': ['jianzi_candidate_lock', { candidateId: options.candidate }],
    'article:generate': ['jianzi_article_generate', { candidateId: options.candidate, provider: options.provider, skillId: options.skill }],
    'article:documents': ['jianzi_article_documents', { batchId: options.batch, candidateId: options.candidate, kind: options.kind }],
    'article:typeset': ['jianzi_article_typeset', { batchId: options.batch, candidateId: options.candidate, imageDeliveryMode: options.images || 'auto' }],
    'cover:generate': ['jianzi_cover_generate', { candidateId: options.candidate, provider: options.provider }],
    'card:editorial': ['jianzi_card_editorial_get', { candidateId: options.candidate }],
    'card:storyboard': ['jianzi_card_storyboard_generate', { candidateId: options.candidate, provider: options.provider }],
    'card:update': ['jianzi_card_editorial_update', { candidateId: options.candidate, cardPlan: jsonOption(options.cardPlan, []), outputMode: options.outputMode }],
    'card:lock': ['jianzi_card_lock', { candidateId: options.candidate }],
    'card:generate': ['jianzi_card_generate', { candidateId: options.candidate, provider: options.provider, styleBrief: options.styleBrief }],
    'job:get': ['jianzi_job_get', { jobId: options.job }],
    'job:wait': ['jianzi_job_wait', { jobId: options.job, timeoutSeconds: options.timeout ? Number(options.timeout) : 180 }],
    'account:profile': ['jianzi_account_profile', {}],
    'account:update': ['jianzi_account_profile_update', { context: jsonFileOption(options.file, options.context, {}) }],
    'settings:summary': ['jianzi_settings_summary', {}],
    'collectors:list': ['jianzi_collectors_list', {}],
    'collectors:config-list': ['jianzi_collector_configuration_catalog', {}],
    'collectors:config-get': ['jianzi_collector_configuration_get', { collectorId: options.id }],
    'collectors:config-set': ['jianzi_collector_configuration_save', { collectorId: options.id, configuration: jsonFileOption(options.file, options.config, {}) }],
    'collectors:config-test': ['jianzi_collector_configuration_test', { collectorId: options.id }],
    'sources:list': ['jianzi_collection_sources_list', {}],
    'sources:capabilities': ['jianzi_collection_capabilities', {}],
    'sources:add': ['jianzi_collection_source_create', { pluginId: options.plugin, label: options.label, config: jsonFileOption(options.file, options.config, {}), enabled: booleanOption(options.enabled, true) }],
    'sources:update': ['jianzi_collection_source_update', { sourceId: options.id, label: options.label, config: options.file || options.config ? jsonFileOption(options.file, options.config, {}) : undefined, enabled: options.enabled == null ? undefined : booleanOption(options.enabled, true) }],
    'sources:test': ['jianzi_collection_source_test', { sourceId: options.id }],
  };
  toolName = `${group}:${action || ''}`;
  const command = mapped[toolName];
  if (!command) throw new Error(`未知命令：${positional.join(' ')}\n运行 --help 查看用法`);
  const [, result] = command;
  print(await executeJianziTool(client, command[0], result), Boolean(options.json));
}

const { positional, options } = parse(process.argv.slice(2));
dispatch(positional, options).catch((error) => {
  process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.message || String(error)}\n`);
  if (error.details) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  process.exitCode = 1;
});
