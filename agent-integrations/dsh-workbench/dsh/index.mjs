import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
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
    disposers.push(ctx.tools.register(defineTool({
      name: tool.name,
      description: tool.description,
      parameters,
      output: {
        schema: {
          type: 'object',
          properties: { result: { type: 'json', required: true } },
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: 'text',
          text: typeof value.result === 'string' ? value.result : JSON.stringify(value.result, null, 2),
        }],
      },
      async execute(args) {
        return { result: (await executeJianziTool(client, tool.name, args || {})) ?? null };
      },
    })));
  }
  ctx.effect(() => () => disposers.forEach((dispose) => dispose?.()));
}
