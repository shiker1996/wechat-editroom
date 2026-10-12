import { collectWeChatAccount, testWeChatAccount } from './collector.mjs';
import { ok } from './result.mjs';

export function createAdapter({ configuration = {}, onProgress = () => {}, fetchImpl = fetch } = {}) {
  return {
    test: (source) => testWeChatAccount(source, configuration, fetchImpl),
    collect: async (source) => ok(await collectWeChatAccount(source, configuration, onProgress, fetchImpl), { fetchMethod: 'dajiala-post-history', provider: '极致了 / 大佳拉' }),
  };
}
