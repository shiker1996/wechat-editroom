import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const SKILL_SOURCE = path.join(REPO_ROOT, 'agent-integrations', 'skills');
const SERVER_FILE = path.join(REPO_ROOT, 'scripts', 'agent-integration', 'mcp-server.mjs');
const SERVER_NAME = 'jianzi_workbench';

function installSkills(targetRoot) {
  const installed = [];
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const entry of fs.readdirSync(SKILL_SOURCE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = path.join(SKILL_SOURCE, entry.name);
    const target = path.join(targetRoot, entry.name);
    fs.cpSync(source, target, { recursive: true });
    installed.push(target);
  }
  return installed;
}

const tomlString = (value) => JSON.stringify(String(value));
function tomlArray(values) { return `[${values.map(tomlString).join(', ')}]`; }

function installCodex() {
  const configDir = path.join(REPO_ROOT, '.codex');
  const configPath = path.join(configDir, 'config.toml');
  fs.mkdirSync(configDir, { recursive: true });
  const original = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const lines = original.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[mcp_servers.${SERVER_NAME}]`);
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[end])) end += 1;
    lines.splice(start, end - start);
  }
  const current = lines.join('\n').trimEnd();
  const section = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(process.execPath)}`,
    `args = ${tomlArray([SERVER_FILE])}`,
    `cwd = ${tomlString(REPO_ROOT)}`,
    'startup_timeout_sec = 15',
    'tool_timeout_sec = 300',
  ].join('\n');
  fs.writeFileSync(configPath, `${current ? `${current}\n\n` : ''}${section}\n`, 'utf8');
  return { configPath, skills: installSkills(path.join(REPO_ROOT, '.agents', 'skills')) };
}

function installWorkBuddy() {
  const configPath = path.join(REPO_ROOT, '.mcp.json');
  let config = { mcpServers: {} };
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    try { config = JSON.parse(raw); }
    catch { throw new Error(`${configPath} 不是标准 JSON；为保留现有配置，未覆盖该文件。`); }
  }
  config.mcpServers ||= {};
  config.mcpServers[SERVER_NAME] = {
    type: 'stdio',
    command: process.execPath,
    args: [SERVER_FILE],
    timeout: 120000,
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const installedSkills = installSkills(path.join(REPO_ROOT, '.codebuddy', 'skills'));
  return { configPath, skills: installedSkills };
}

export function installAgentIntegration({ agent = 'both' } = {}) {
  const targets = agent === 'both' ? ['codex', 'workbuddy'] : [agent];
  if (targets.some((target) => !['codex', 'workbuddy'].includes(target))) throw new Error('agent 必须是 codex、workbuddy 或 both');
  const result = { projectRoot: REPO_ROOT, installed: [] };
  if (targets.includes('codex')) {
    const codexConfig = installCodex();
    result.installed.push({ agent: 'codex', config: codexConfig, skills: SKILL_SOURCE, note: 'Codex 已通过项目级 MCP 配置连接；请在 Codex 中信任此项目目录后重启 MCP。' });
  }
  if (targets.includes('workbuddy')) {
    const installed = installWorkBuddy();
    result.installed.push({ agent: 'workbuddy', ...installed, note: '若 WorkBuddy 版本不读取项目级 .mcp.json，请导入 agent-integrations/workbuddy 连接器包或按 MCP 文档手动添加 stdio server。' });
  }
  return result;
}

export function agentIntegrationRoot() { return REPO_ROOT; }
