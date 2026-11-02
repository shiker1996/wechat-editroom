import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../core/atomic-file.mjs';

const FILE = path.join('data', 'agent-runtime-settings.json');
export function getAgentRuntimeSettings(root) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, FILE), 'utf8'));
    const defaultRuntime = String(value.defaultRuntime || '');
    return { defaultRuntime: defaultRuntime === 'local-harness' || /^[a-z][a-z0-9-]{1,63}$/.test(defaultRuntime) ? defaultRuntime : 'local-harness' };
  } catch { return { defaultRuntime: 'local-harness' }; }
}

export function setAgentRuntimeSettings(root, input = {}, { registeredRuntimes = ['codex'] } = {}) {
  const defaultRuntime = String(input.defaultRuntime || '');
  if (defaultRuntime !== 'local-harness' && !registeredRuntimes.includes(defaultRuntime)) throw new Error('默认 Agent Runtime 未注册');
  const value = { schemaVersion: 1, defaultRuntime, updatedAt: new Date().toISOString() };
  atomicWriteJson(path.join(root, FILE), value);
  return { defaultRuntime };
}
