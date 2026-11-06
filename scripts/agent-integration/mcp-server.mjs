#!/usr/bin/env node
import { createJianziClient } from './client.mjs';
import { executeJianziTool, JIANZI_TOOLS } from './tools.mjs';
import { startJianziMcpServer } from './mcp-server-core.mjs';
import { agentIntegrationRoot } from './install.mjs';

const client = createJianziClient();
startJianziMcpServer({
  executeTool: (name, args) => executeJianziTool(client, name, args, { projectRoot: agentIntegrationRoot() }),
  tools: JIANZI_TOOLS,
});
