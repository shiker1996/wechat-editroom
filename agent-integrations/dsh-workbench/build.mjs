import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../..');
await mkdir(path.join(root, 'shared'), { recursive: true });
await cp(path.join(repo, 'scripts/agent-integration/client.mjs'), path.join(root, 'shared/client.mjs'));
await cp(path.join(repo, 'scripts/agent-integration/tools.mjs'), path.join(root, 'shared/tools.mjs'));
console.log('Built DSH workbench package from the shared Jianzi MCP tool implementation.');
