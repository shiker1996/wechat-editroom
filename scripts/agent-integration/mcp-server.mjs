#!/usr/bin/env node
import { createJianziClient } from './client.mjs';
import { executeJianziTool, JIANZI_TOOLS } from './tools.mjs';
import { startJianziMcpServer } from './mcp-server-core.mjs';

const client = createJianziClient();
startJianziMcpServer({
  executeTool: (name, args) => executeJianziTool(client, name, args),
  tools: JIANZI_TOOLS,
});
