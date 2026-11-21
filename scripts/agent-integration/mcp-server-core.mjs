import readline from 'node:readline';

const protocolVersion = '2025-03-26';
const supportedProtocolVersions = new Set([protocolVersion, '2024-11-05']);
/** Start the shared stdio MCP transport for Jianzi tool implementations. */
export function startJianziMcpServer({ executeTool, tools, instructions, input = process.stdin, output = process.stdout }) {
  const send = (message) => output.write(`${JSON.stringify(message)}\n`);
  const result = (id, value) => send({ jsonrpc: '2.0', id, result: value });
  const rpcError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  const toolResult = (data, isError = false) => {
    let previewImageBase64 = typeof data?.previewImageBase64 === 'string' ? data.previewImageBase64 : '';
    const textData = { ...(data || {}) };
    delete textData.previewImageBase64;
    if (textData.details && typeof textData.details === 'object') {
      if (!previewImageBase64 && typeof textData.details.previewImageBase64 === 'string') previewImageBase64 = textData.details.previewImageBase64;
      textData.details = { ...textData.details };
      delete textData.details.previewImageBase64;
    }
    return {
      content: [
        { type: 'text', text: JSON.stringify(textData, null, 2) },
        ...(previewImageBase64 ? [{ type: 'image', data: previewImageBase64, mimeType: 'image/png' }] : []),
      ],
      isError,
    };
  };

  async function handle(message) {
    const { id, method, params = {} } = message || {};
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
    if (method === 'initialize') {
      const negotiated = supportedProtocolVersions.has(params.protocolVersion) ? params.protocolVersion : protocolVersion;
      result(id, { protocolVersion: negotiated, capabilities: { tools: {} }, serverInfo: { name: 'jianzi-workbench', version: '1.0.0' }, ...(instructions ? { instructions } : {}) });
      return;
    }
    if (method === 'ping') { result(id, {}); return; }
    if (method === 'tools/list') {
      result(id, { tools: tools.map(({ readOnlyHint, openWorldHint, ...tool }) => ({ ...tool, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: openWorldHint === true } })) });
      return;
    }
    if (method === 'tools/call') {
      try {
        const data = await executeTool(String(params.name || ''), params.arguments || {});
        result(id, toolResult(data));
      } catch (error) {
        const data = { code: error.code || 'JIANZI_TOOL_FAILED', message: error.message || String(error), ...(error.details ? { details: error.details } : {}) };
        result(id, toolResult(data, true));
      }
      return;
    }
    if (id !== undefined) rpcError(id, -32601, `不支持的 MCP 方法：${method}`);
  }

  const stream = readline.createInterface({ input, crlfDelay: Infinity, terminal: false });
  stream.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch { rpcError(null, -32700, '无法解析 JSON-RPC 请求'); return; }
    void handle(message).catch((error) => rpcError(message?.id ?? null, -32603, error.message || 'MCP server internal error'));
  });
  stream.on('close', () => process.exit(0));
  return stream;
}
