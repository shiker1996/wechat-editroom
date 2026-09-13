/**
 * 账号上下文应用服务。
 * 负责工作区路径、JSON 持久化与进程内缓存；领域规则位于 shared/domain/account-context-model.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  formatAccountContext as formatAccountContextModel,
  getDefaultAccountContext,
  isAccountContextConfigured as isAccountContextConfiguredModel,
  normalizeAccountPatch,
} from '../../shared/domain/account-context-model.mjs';

let cached = null;
let cachedFile = '';

function accountContextPath(options = {}) {
  return path.resolve(options.filePath || path.join(options.workspaceRoot || process.cwd(), 'account-context.json'));
}

export function loadAccountContext(filePath = path.join(process.cwd(), 'account-context.json')) {
  const resolvedFile = path.resolve(filePath);
  if (fs.existsSync(resolvedFile)) {
    try {
      cached = JSON.parse(fs.readFileSync(resolvedFile, 'utf8'));
      cachedFile = resolvedFile;
      return cached;
    } catch {
      // fall through to defaults
    }
  }
  cached = getDefaultAccountContext();
  cachedFile = resolvedFile;
  return cached;
}

export function getAccountContext(options = {}) {
  if (!Object.keys(options).length && cached) return cached;
  const filePath = accountContextPath(options);
  if (!cached || cachedFile !== filePath || options.refresh) return loadAccountContext(filePath);
  return cached;
}

export function formatAccountContext(options = {}) {
  return formatAccountContextModel(getAccountContext(options));
}

export function isAccountContextConfigured(context, options = {}) {
  return fs.existsSync(accountContextPath(options)) && isAccountContextConfiguredModel(context);
}

export function saveAccountContext(input, options = {}) {
  const filePath = accountContextPath(options);
  let existing = {};
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
    } catch {
      existing = {};
    }
  }
  const patch = normalizeAccountPatch(input);
  const next = { ...existing, ...patch };
  if (!isAccountContextConfiguredModel(next)) {
    throw new Error('请至少填写账号名称、账号简介、核心读者和一个内容支柱');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
  cached = next;
  cachedFile = filePath;
  return next;
}
