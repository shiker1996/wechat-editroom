#!/usr/bin/env node
import readline from 'node:readline';
import { createJianziClient } from './client.mjs';
import { executeJianziTool, JIANZI_TOOLS } from './tools.mjs';

const client = createJianziClient();
const protocolVersion = '2025-03-26';
const supportedProtocolVersions = new Set([protocolVersion, '2024-11-05']);

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function result(id, value) { send({ jsonrpc: '2.0', id, result: value }); }
function rpcError(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(message) {
  const { id, method, params = {} } = message || {};
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
  if (method === 'initialize') {
    const negotiated = supportedProtocolVersions.has(params.protocolVersion) ? params.protocolVersion : protocolVersion;
    result(id, { protocolVersion: negotiated, capabilities: { tools: {} }, serverInfo: { name: 'jianzi-workbench', version: '1.0.0' } });
    return;
  }
  if (method === 'ping') { result(id, {}); return; }
  if (method === 'tools/list') {
    result(id, { tools: JIANZI_TOOLS.map(({ readOnlyHint, openWorldHint, ...tool }) => ({ ...tool, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: openWorldHint === true } })) });
    return;
  }
  if (method === 'tools/call') {
    try {
      const data = await executeJianziTool(client, String(params.name || ''), params.arguments || {});
      result(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: false });
    } catch (error) {
      const data = { code: error.code || 'JIANZI_TOOL_FAILED', message: error.message || String(error), ...(error.details ? { details: error.details } : {}) };
      result(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true });
    }
    return;
  }
  if (id !== undefined) rpcError(id, -32601, `不支持的 MCP 方法：${method}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
input.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); }
  catch { rpcError(null, -32700, '无法解析 JSON-RPC 请求'); return; }
  void handle(message).catch((error) => rpcError(message?.id ?? null, -32603, error.message || 'MCP server internal error'));
});
input.on('close', () => process.exit(0));
