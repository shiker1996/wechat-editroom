#!/usr/bin/env node
import { createJianziClient } from './shared/client.mjs';
import { executeJianziTool, JIANZI_TOOLS } from './shared/tools.mjs';
import { startJianziMcpServer } from './shared/mcp-server-core.mjs';

const client = createJianziClient();
startJianziMcpServer({
  executeTool: (name, args) => executeJianziTool(client, name, args, { projectRoot: process.env.JIANZI_PROJECT_ROOT }),
  tools: JIANZI_TOOLS,
});
