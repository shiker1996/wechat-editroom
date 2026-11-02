const RUNTIME_ID = /^[a-z][a-z0-9-]{1,63}$/;
export const AGENT_RUNTIME_CAPABILITIES = Object.freeze(['run', 'streaming', 'cancel', 'resume', 'hostToolCallbacks', 'structuredOutput']);

/** Registry for platform Agent Runtime adapters. The local Harness remains the
 * built-in path and is represented by a missing adapter. */
export class AgentRuntimeRegistry {
  #adapters = new Map();

  register(adapter, id = adapter?.id) {
    if (!RUNTIME_ID.test(String(id || ''))) throw new TypeError('Agent Runtime ID 无效');
    if (!adapter || typeof adapter.run !== 'function' || typeof adapter.getCapabilities !== 'function') {
      throw new TypeError(`Agent Runtime ${id} 缺少 run 或 getCapabilities`);
    }
    if (this.#adapters.has(id)) throw new Error(`Agent Runtime 已注册：${id}`);
    this.#adapters.set(id, adapter);
    return adapter;
  }

  resolve(id) { return this.#adapters.get(String(id || '')) || null; }
  has(id) { return this.#adapters.has(String(id || '')); }
  list() { return [...this.#adapters.keys()].sort(); }
}
