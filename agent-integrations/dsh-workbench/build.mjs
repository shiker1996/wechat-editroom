import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../..');
await mkdir(path.join(root, 'shared'), { recursive: true });
await cp(path.join(repo, 'scripts/agent-integration/client.mjs'), path.join(root, 'shared/client.mjs'));
const toolsSource = await readFile(path.join(repo, 'scripts/agent-integration/tools.mjs'), 'utf8');
const toolsBundle = toolsSource.replace('../../server/shared/domain/schemas/social-card-design-scheme.mjs', './social-card-design-scheme.mjs');
await writeFile(path.join(root, 'shared/tools.mjs'), toolsBundle, 'utf8');
const designSchemeSource = await readFile(path.join(repo, 'server/shared/domain/schemas/social-card-design-scheme.mjs'), 'utf8');
const designSchemeBundle = designSchemeSource.replace(
  "from '../social-card-visual-paradigms.mjs'",
  "from './social-card-visual-paradigms.mjs'",
);
if (designSchemeBundle === designSchemeSource) throw new Error('Could not rewrite the visual-paradigm import for the DSH bundle.');
await writeFile(path.join(root, 'shared/social-card-design-scheme.mjs'), designSchemeBundle, 'utf8');
await cp(path.join(repo, 'server/shared/domain/social-card-visual-paradigms.mjs'), path.join(root, 'shared/social-card-visual-paradigms.mjs'));
await cp(path.join(repo, 'scripts/agent-integration/mcp-server-core.mjs'), path.join(root, 'shared/mcp-server-core.mjs'));
console.log('Built DSH workbench package from the shared Jianzi MCP tool implementation.');
