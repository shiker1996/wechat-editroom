import { collectXSearch, testXSearch } from './collector.mjs';
import { ok } from './result.mjs';

export function createAdapter({ configuration = {}, onProgress = () => {}, fetchImpl = fetch } = {}) {
  return {
    test: (source) => testXSearch(source, configuration, fetchImpl),
    collect: async (source) => ok(await collectXSearch(source, configuration, onProgress, fetchImpl), { fetchMethod: source.mode === 'replies' ? 'twitterapi-replies' : source.mode === 'trending' ? 'twitterapi-trending-search' : 'twitterapi-search', provider: 'TwitterAPI' }),
  };
}
