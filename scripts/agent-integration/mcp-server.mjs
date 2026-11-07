#!/usr/bin/env node
import { createJianziClient } from './client.mjs';
import { executeJianziTool, JIANZI_TOOLS } from './tools.mjs';
import { startJianziMcpServer } from './mcp-server-core.mjs';
import { agentIntegrationRoot } from './install.mjs';

const client = createJianziClient();
const externalAgentInstructions = [
  '见字工作台面向外部 Agent 的工具用于完成连续的内容工作流。先按用户要求判断目标是否包含多个阶段；不要把中间工具调用结果当作最终完成。',
  '工具结果中的 next_action、next_step、pending 状态、jobId 和工具说明是流程续接依据。用户要求端到端完成且下一步明确时，在同一轮继续调用；缺少信息或需要用户选择/审阅/确认时，停在该门禁，并说明具体待办、候选或对象 ID。',
  '每轮结束时给出与当前状态匹配的一个具体下一步：列明用户需要提供/选择/确认什么，或提供产物入口和建议的后续操作。不要用泛化的“还需要什么吗”。不得自动越过用户确认、账号配置写入、外部发布或覆盖等门禁。',
].join('\n');

startJianziMcpServer({
  executeTool: (name, args) => executeJianziTool(client, name, args, { projectRoot: agentIntegrationRoot() }),
  tools: JIANZI_TOOLS,
  instructions: externalAgentInstructions,
});
