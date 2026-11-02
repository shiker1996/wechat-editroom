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

function errorFromResponse(body, status, action) {
  return Object.assign(new Error(`${action}失败（HTTP ${status}）${body?.msg || body?.message ? `：${body.msg || body.message}` : ''}`), {
    code: body?.code || `WORKBUDDY_HTTP_${status}`,
  });
}

async function readJson(response, action) {
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok || (body.code != null && body.code !== 0 && body.code !== '0')) throw errorFromResponse(body, response.status, action);
  return body.data || body;
}

function textFromUpdate(message) {
  const update = message?.params?.update || message?.params || {};
  const kind = String(update.sessionUpdate || update.type || '');
  if (!/agent_message_chunk|agent_message|text_delta|message_delta/iu.test(kind)) return '';
  const content = update.content || update.message?.content || update;
  if (typeof content === 'string') return content;
  if (typeof content?.text === 'string') return content.text;
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('');
  return '';
}

function trustedTaskLink(value) {
  const url = new URL(String(value || ''));
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !(host === 'workbuddy.cn' || host.endsWith('.workbuddy.cn') || host.endsWith('.agentos-run.net'))) {
    throw Object.assign(new Error('WorkBuddy 返回了不受信任的 ACP 地址'), { code: 'WORKBUDDY_PROTOCOL_ERROR' });
  }
  return url.toString();
}

/** WorkBuddy Cloud Task Runtime over its documented ACP SSE/JSON-RPC channel. */
export function createWorkBuddyAcpRuntime({ getAccessToken, fetchImpl = fetch } = {}) {
  if (typeof getAccessToken !== 'function') throw new TypeError('WorkBuddy Runtime 需要 OAuth token provider');

  return {
    id: 'workbuddy-acp',
    async getCapabilities() {
      // ACP provides streaming text and cancellation, but the documented
      // WorkBuddy bridge does not expose callbacks into Jianzi's Tool Broker.
      return { run: true, streaming: true, cancel: true, resume: false, hostToolCallbacks: false, structuredOutput: false };
    },
    async *run(request) {
      const accessToken = await getAccessToken(request.runtimeProfileId);
      if (!accessToken) throw Object.assign(new Error('WorkBuddy OAuth 尚未连接或已过期'), { code: 'WORKBUDDY_AUTH_REQUIRED' });
      const apiHeaders = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
      const created = await readJson(await fetchImpl('https://www.workbuddy.cn/openapi/v2/tasks', {
        method: 'POST', headers: { ...apiHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ name: `见字 ${request.stageId || 'Agent任务'}`,
          prompt: '创建见字工作台运行会话，等待后续通过 ACP 发送的正式任务指令。' }), signal: request.signal,
      }), 'WorkBuddy 云端任务创建');
      const taskId = String(created.task_id || '');
      if (!taskId) throw Object.assign(new Error('WorkBuddy 未返回云端任务 ID'), { code: 'WORKBUDDY_PROTOCOL_ERROR' });

      let task = created;
      for (let attempt = 0; attempt < 6 && (!task.link || !task.token); attempt += 1) {
        if (request.signal?.aborted) throw Object.assign(new Error('WorkBuddy Runtime 已取消'), { code: 'AGENT_ABORTED', name: 'AbortError' });
        await new Promise((resolve) => setTimeout(resolve, 500));
        task = await readJson(await fetchImpl(`https://www.workbuddy.cn/openapi/v2/tasks/${encodeURIComponent(taskId)}`, { headers: apiHeaders, signal: request.signal }), 'WorkBuddy 云端任务查询');
      }
      if (!task.link || !task.token) throw Object.assign(new Error('WorkBuddy 任务未能建立 ACP 连接'), { code: 'WORKBUDDY_ACP_UNAVAILABLE' });
      task.link = trustedTaskLink(task.link);

      const acpHeaders = { authorization: `Bearer ${task.token}`, accept: 'text/event-stream' };
      const streamController = new AbortController();
      const onAbort = () => {
        void fetchImpl(task.link, { method: 'POST', headers: {
          authorization: `Bearer ${task.token}`, 'content-type': 'application/json',
          'acp-connection-id': response?.headers?.get?.('acp-connection-id') || '',
        }, body: JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: taskId } }),
        signal: AbortSignal.timeout(3000) }).catch(() => {});
        streamController.abort(request.signal?.reason);
      };
      request.signal?.addEventListener('abort', onAbort, { once: true });
      let response;
      try {
        response = await fetchImpl(task.link, { headers: acpHeaders, signal: streamController.signal });
        if (!response.ok || !response.body) throw Object.assign(new Error(`WorkBuddy ACP SSE 建连失败（HTTP ${response.status}）`), { code: 'WORKBUDDY_ACP_CONNECT_FAILED' });
      } catch (error) {
        request.signal?.removeEventListener('abort', onAbort);
        throw error;
      }

      const connectionId = response.headers.get('acp-connection-id');
      if (!connectionId) {
        streamController.abort(); request.signal?.removeEventListener('abort', onAbort);
        throw Object.assign(new Error('WorkBuddy ACP 响应缺少 Acp-Connection-Id'), { code: 'WORKBUDDY_PROTOCOL_ERROR' });
      }
      const pending = new Map();
      const events = [];
      let wake = null;
      let nextId = 0;
      let terminal = false;
      let output = '';
      let failure = null;
      const notify = () => { wake?.(); wake = null; };
      const enqueue = (event) => { events.push(event); notify(); };
      const post = async (message) => {
        const result = await fetchImpl(task.link, { method: 'POST', headers: {
          authorization: `Bearer ${task.token}`, 'content-type': 'application/json', 'acp-connection-id': connectionId,
        }, body: JSON.stringify(message), signal: streamController.signal });
        if (!result.ok) throw Object.assign(new Error(`WorkBuddy ACP 请求失败（HTTP ${result.status}）`), { code: 'WORKBUDDY_ACP_REQUEST_FAILED' });
      };
      const call = (method, params = {}) => {
        const id = ++nextId;
        const wait = deferred(); pending.set(id, wait);
        void post({ jsonrpc: '2.0', id, method, params }).catch((error) => {
          pending.delete(id); wait.reject(error);
        });
        return wait.promise;
      };
      const respondToRequest = (message) => post({ jsonrpc: '2.0', id: message.id,
        error: { code: -32000, message: '见字未启用 WorkBuddy 云端交互授权桥接' } }).catch((error) => { failure ||= error; terminal = true; notify(); });
      const handleMessage = (message) => {
        if (message?.id != null && pending.has(message.id)) {
          const wait = pending.get(message.id); pending.delete(message.id);
          if (message.error) wait.reject(Object.assign(new Error(message.error.message || 'WorkBuddy ACP 请求失败'), { code: message.error.code || 'WORKBUDDY_ACP_ERROR' }));
          else wait.resolve(message.result || {});
          return;
        }
        if (message?.id != null && message.method) { void respondToRequest(message); return; }
        if (message?.method === 'session/update') {
          const delta = textFromUpdate(message);
          if (delta) { output += delta; enqueue({ type: 'message.delta', text: delta }); }
        }
      };
      const pump = (async () => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/u); buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const raw = line.slice(5).trim();
              if (!raw || raw === '[DONE]') continue;
              try { handleMessage(JSON.parse(raw)); } catch (error) { if (error instanceof SyntaxError) continue; throw error; }
            }
          }
        } catch (error) {
          if (!streamController.signal.aborted) failure ||= error;
        } finally {
          if (!terminal && !streamController.signal.aborted) failure ||= Object.assign(new Error('WorkBuddy ACP SSE 已结束'), { code: 'WORKBUDDY_ACP_STREAM_ENDED' });
          if (failure) {
            for (const wait of pending.values()) wait.reject(failure);
            pending.clear();
          }
          terminal = true; notify();
        }
      })();

      try {
        enqueue({ type: 'run.started', runtimeRunRef: taskId });
        await call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
        await call('session/load', { sessionId: taskId, cwd: '/workspace', mcpServers: [] });
        const prompt = [request.instruction || '', `输入数据：\n${messageText(request.input)}`,
          request.outputSchema ? `输出契约：\n${JSON.stringify(request.outputSchema)}` : ''].filter(Boolean).join('\n\n');
        const promptRun = call('session/prompt', { sessionId: taskId, prompt: [{ type: 'text', text: prompt }] }).then((result) => {
          if (result.stopReason === 'cancelled') enqueue({ type: 'run.cancelled' });
          else if (result.stopReason === 'refusal') failure = Object.assign(new Error('WorkBuddy 拒绝执行该请求'), { code: 'WORKBUDDY_REFUSED' });
          else enqueue({ type: 'run.completed', output, runtimeRunRef: taskId });
          terminal = true; notify();
        }, (error) => { failure ||= error; terminal = true; notify(); });
        while (!terminal || events.length) {
          if (events.length) { yield events.shift(); continue; }
          await new Promise((resolve) => { wake = resolve; });
        }
        await promptRun;
        if (failure) throw failure;
      } catch (error) {
        if (request.signal?.aborted) { enqueue({ type: 'run.cancelled' }); while (events.length) yield events.shift(); }
        else throw error;
      } finally {
        terminal = true; streamController.abort(); request.signal?.removeEventListener('abort', onAbort);
        for (const wait of pending.values()) wait.reject(new Error('WorkBuddy Runtime 已关闭'));
        pending.clear(); await pump.catch(() => {});
      }
    },
    async cancel(runtimeRunRef) { return { runtimeRunRef, supported: true }; },
  };
}
