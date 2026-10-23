import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const promptRoot = path.join(repositoryRoot, 'prompts');
const manifestPath = path.join(promptRoot, 'manifest.json');
const VARIABLE = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;

function fail(message) { throw new Error(`提示词资产无效：${message}`); }

function readManifest() {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (error) { fail(`无法读取 manifest.json（${error.message}）`); }
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.prompts)) fail('manifest schemaVersion 必须为 1 且 prompts 必须为数组');
  const byId = new Map();
  for (const entry of manifest.prompts) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entry.id)) fail('prompt id 格式无效');
    if (byId.has(entry.id)) fail(`prompt id 重复：${entry.id}`);
    if (!Number.isInteger(entry.version) || entry.version < 1) fail(`${entry.id} version 必须是正整数`);
    if (typeof entry.file !== 'string' || !entry.file.endsWith('.md')) fail(`${entry.id} file 必须指向 Markdown 文件`);
    if (!Array.isArray(entry.variables || []) || !Array.isArray(entry.components || [])) fail(`${entry.id} variables/components 必须是数组`);
    byId.set(entry.id, entry);
  }
  for (const entry of byId.values()) for (const componentId of entry.components || []) {
    if (!byId.has(componentId)) fail(`${entry.id} 引用了未登记组件 ${componentId}`);
  }
  return byId;
}

function promptFile(entry) {
  const target = path.resolve(promptRoot, entry.file);
  if (!target.startsWith(`${promptRoot}${path.sep}`)) fail(`${entry.id} 文件路径越界`);
  try { return fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''); }
  catch (error) { fail(`${entry.id} 文件读取失败（${error.message}）`); }
}

function renderEntry(id, variables, entries, stack = [], componentOverride = null) {
  if (stack.includes(id)) fail(`组件循环引用：${[...stack, id].join(' -> ')}`);
  const entry = entries.get(id);
  if (!entry) fail(`未登记的 prompt id：${id}`);
  const componentIds = componentOverride ?? entry.components ?? [];
  const components = componentIds.map((componentId) => renderEntry(componentId, variables, entries, [...stack, id]));
  const ownText = promptFile(entry);
  const allowed = new Set(entry.variables || []);
  const supplied = variables && typeof variables === 'object' ? variables : {};
  for (const key of Object.keys(supplied)) if (!allowed.has(key)) fail(`${id} 收到未登记变量 ${key}`);
  for (const match of ownText.matchAll(VARIABLE)) if (!allowed.has(match[1])) fail(`${id} 使用了未登记变量 ${match[1]}`);
  const rendered = ownText.replace(VARIABLE, (_match, key) => {
    if (!Object.hasOwn(supplied, key)) fail(`${id} 缺少变量 ${key}`);
    const value = supplied[key];
    if (value === null || value === undefined) fail(`${id} 变量 ${key} 不能为空`);
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
  if (/{{\s*[a-zA-Z][a-zA-Z0-9_]*\s*}}/.test(rendered)) fail(`${id} 展开后仍有未替换变量`);
  const componentText = components.map((item) => item.text);
  const text = [rendered.trimEnd(), ...componentText].filter(Boolean).join('\n');
  const sourceHashes = Object.fromEntries([[id, `sha256:${crypto.createHash('sha256').update(ownText).digest('hex')}`], ...components.flatMap((item) => Object.entries(item.sourceHashes))]);
  return { text, sourceHashes, components: [...(entry.components || []), ...components.flatMap((item) => item.components)] };
}

export function resolvePrompt(id, variables = {}, { components = null } = {}) {
  const entries = readManifest();
  const entry = entries.get(id);
  if (!entry) fail(`未登记的 prompt id：${id}`);
  if (components !== null && (!Array.isArray(components) || components.some((componentId) => !(entry.components || []).includes(componentId)))) fail(`${id} 请求了未声明的组件`);
  const resolved = renderEntry(id, variables, entries, [], components);
  return { id, version: entry.version, purpose: entry.purpose || '', output: entry.output || { format: 'text' }, components: resolved.components,
    sourceHashes: resolved.sourceHashes, promptHash: `sha256:${crypto.createHash('sha256').update(resolved.text).digest('hex')}`, text: resolved.text };
}

export function promptRegistryManifest() {
  return { schemaVersion: 1, prompts: [...readManifest().values()] };
}
