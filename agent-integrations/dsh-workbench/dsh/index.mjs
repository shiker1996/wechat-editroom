import Schema from '@deepseek-ai/schemastery';
import { createJianziClient } from '../shared/client.mjs';
import { executeJianziTool, JIANZI_TOOLS } from '../shared/tools.mjs';

export const name = 'jianzi-content-workbench';
export const inject = ['tools'];
export const Config = Schema.object({});

export function apply(ctx) {
  const client = createJianziClient();
  const disposers = [];
  for (const tool of JIANZI_TOOLS) {
    const required = new Set(tool.inputSchema.required || []);
    const parameters = Object.fromEntries(Object.entries(tool.inputSchema.properties || {}).map(([key, value]) => [
      key,
      { ...value, ...(required.has(key) ? { required: true } : {}) },
    ]));
    disposers.push(ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters,
      async execute(args) {
        return executeJianziTool(client, tool.name, args || {});
      },
    }));
  }
  ctx.effect(() => () => disposers.forEach((dispose) => dispose?.()));
}
