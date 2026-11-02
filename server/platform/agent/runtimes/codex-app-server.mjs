import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const CODEX_ARGS = [
  'app-server', '--listen', 'stdio://',
  '-c', 'model_provider="openai_chatgpt_plan"',
  '-c', 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
  '-c', 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
  '-c', 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
  '-c', 'model_providers.openai_chatgpt_plan.wire_api="responses"',
  '-c', 'model_providers.openai_chatgpt_plan.requires_openai_auth=false',
  '-c', 'model_providers.openai_chatgpt_plan.supports_websockets=false',
];

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function messageText(input) {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join('\n');
  return JSON.stringify(input ?? null);
}

/**
 * Codex app-server Runtime adapter. OAuth acquisition/storage is deliberately
 * injected so this process never reads Codex CLI's private auth files.
 */
export function createCodexAppServerRuntime({
  command = 'codex',
  args = CODEX_ARGS,
  getAccessToken,
  clientInfo = { name: 'jianzi-workbench', title: '见字工作台', version: '0.8.0' },
  spawnProcess = spawn,
} = {}) {
  if (typeof getAccessToken !== 'function') throw new TypeError('Codex Runtime 需要 OAuth token provider');

  return {
    id: 'codex-app-server',
    async getCapabilities() {
      return { run: true, streaming: true, cancel: true, resume: false, hostToolCallbacks: true, structuredOutput: false };
    },
    async *run(request) {
      const accessToken = await getAccessToken(request.runtimeProfileId);
      if (!accessToken) throw Object.assign(new Error('Codex ChatGPT OAuth 尚未连接或已过期'), { code: 'CODEX_AUTH_REQUIRED' });
      const child = spawnProcess(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, ACCESS_TOKEN: accessToken } });
      const lines = createInterface({ input: child.stdout });
      const pending = new Map();
      const events = [];
      let wake = null;
      let nextId = 0;
      let terminal = false;
      let failure = null;
      let output = '';
      let threadId = null;
      let turnId = null;
      const signal = request.signal;
      const notify = () => { wake?.(); wake = null; };
      const enqueue = (event) => { events.push(event); notify(); };
      const rejectPending = (error) => {
        for (const wait of pending.values()) wait.reject(error);
        pending.clear();
      };
      const send = (method, params = {}) => {
        const id = ++nextId;
        const result = deferred();
        pending.set(id, result);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        return result.promise;
      };
      const respondToToolCall = async (message) => {
        const params = message.params || {};
        let response;
        try {
          if (typeof request.executeTool !== 'function') throw Object.assign(new Error('见字 Tool Broker 未提供给 Codex Runtime'), { code: 'RUNTIME_TOOL_BRIDGE_UNAVAILABLE' });
          const result = await request.executeTool({ callId: params.callId, tool: params.tool, arguments: params.arguments, namespace: params.namespace });
          response = { success: result?.status === 'ok', contentItems: [{ type: 'inputText', text: JSON.stringify(result ?? null) }] };
        } catch (error) {
          response = { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ error: { code: error.code || 'TOOL_EXECUTION_FAILED', message: error.message || '工具执行失败' } }) }] };
        }
        try { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: response })}\n`); }
        catch (error) { failure ||= error; terminal = true; notify(); }
      };
      const onLine = (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.id != null && message.method === 'item/tool/call') {
          void respondToToolCall(message);
          return;
        }
        if (message.id != null && pending.has(message.id)) {
          const wait = pending.get(message.id); pending.delete(message.id);
          if (message.error) wait.reject(Object.assign(new Error(message.error.message || 'Codex app-server 请求失败'), { code: message.error.code }));
          else wait.resolve(message.result);
          return;
        }
        const params = message.params || {};
        if (message.method === 'item/agentMessage/delta') {
          const delta = params.delta || params.text || '';
          if (delta) { output += delta; enqueue({ type: 'message.delta', text: delta }); }
        } else if (message.method === 'turn/completed') {
          const status = params.turn?.status || params.status;
          if (status === 'completed') { enqueue({ type: 'run.completed', output, runtimeRunRef: threadId }); terminal = true; }
          else if (signal?.aborted || status === 'interrupted') { enqueue({ type: 'run.cancelled' }); terminal = true; }
          else { failure = Object.assign(new Error(`Codex turn ${status || 'failed'}`), { code: 'CODEX_TURN_FAILED' }); terminal = true; }
          notify();
        }
      };
      lines.on('line', onLine);
      child.stderr.setEncoding('utf8');
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
      child.on('error', (error) => { failure = error; terminal = true; rejectPending(error); notify(); });
      child.on('exit', (code) => {
        if (!terminal && !failure) failure = Object.assign(new Error(`Codex app-server exited (${code}): ${stderr.trim()}`), { code: 'CODEX_PROCESS_EXITED' });
        rejectPending(failure || Object.assign(new Error('Codex app-server 已退出'), { code: 'CODEX_PROCESS_EXITED' }));
        terminal = true; notify();
      });
      const interrupt = () => {
        if (turnId) void send('turn/interrupt', { threadId, turnId }).catch(() => {});
      };
      signal?.addEventListener('abort', interrupt, { once: true });
      try {
        await send('initialize', { clientInfo, capabilities: { experimentalApi: true } });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);
        const threadParams = { model: request.model || undefined };
        if (Array.isArray(request.tools) && request.tools.length) {
          threadParams.dynamicTools = request.tools.map((tool) => ({ type: 'function', name: tool.name,
            description: tool.description || tool.name, inputSchema: tool.inputSchema || { type: 'object' } }));
        }
        const thread = await send('thread/start', threadParams);
        threadId = thread?.thread?.id;
        if (!threadId) throw Object.assign(new Error('Codex 未返回 thread ID'), { code: 'CODEX_PROTOCOL_ERROR' });
        enqueue({ type: 'run.started', runtimeRunRef: threadId });
        const prompt = [request.instruction || '', `输入数据：\n${messageText(request.input)}`, request.outputSchema ? `输出契约：\n${JSON.stringify(request.outputSchema)}` : ''].filter(Boolean).join('\n\n');
        const turn = await send('turn/start', { threadId, input: [{ type: 'text', text: prompt }] });
        turnId = turn?.turn?.id || null;
        while (!terminal || events.length) {
          if (events.length) { yield events.shift(); continue; }
          if (failure) throw failure;
          await new Promise((resolve) => { wake = resolve; });
        }
        if (failure) throw failure;
      } finally {
        signal?.removeEventListener('abort', interrupt);
        lines.close();
        child.stdin.end();
        if (child.exitCode == null) child.kill();
        for (const wait of pending.values()) wait.reject(new Error('Codex Runtime 已关闭'));
      }
    },
    async cancel(runtimeRunRef) {
      // Active runs are interrupted through the request AbortSignal. The
      // thread reference is retained in the normalized protocol for auditing.
      return { runtimeRunRef, supported: true };
    },
  };
}

export { CODEX_ARGS };
