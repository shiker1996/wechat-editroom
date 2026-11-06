#!/usr/bin/env node
import { createJianziClient } from './shared/client.mjs';
import { executeJianziTool, JIANZI_TOOLS } from './shared/tools.mjs';
import { startJianziMcpServer } from './shared/mcp-server-core.mjs';

const client = createJianziClient();
startJianziMcpServer({
  executeTool: (name, args) => executeJianziTool(client, name, args),
  tools: JIANZI_TOOLS,
});
