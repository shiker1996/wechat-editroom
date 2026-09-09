// 批次采集面板只暴露三类稳定入口；每类入口再映射到实际的采集源类型。
// RSSHub 入口也承接 direct / twitter / 其他订阅型来源，保持现有批次语义。
export const BATCH_SOURCE_GROUPS = Object.freeze([
  Object.freeze({ id: 'reddit', label: 'Reddit', sourceTypes: Object.freeze(['reddit']) }),
  Object.freeze({ id: 'rsshub', label: 'RSSHub', sourceTypes: Object.freeze(['rsshub', 'twitter', 'direct']) }),
  Object.freeze({ id: 'github', label: 'GitHub', sourceTypes: Object.freeze(['github']) }),
]);

function sourceBelongsToGroup(source, group) {
  if (group.id === 'rsshub') return source.source_type !== 'reddit' && source.source_type !== 'github';
  return group.sourceTypes.includes(source.source_type);
}

export function describeBatchSourceGroups(sources = [], options = {}) {
  const enabled = sources.filter((source) => source?.enabled !== false && source?.dismissed !== true);
  return BATCH_SOURCE_GROUPS.map((group) => {
    const matching = enabled.filter((source) => sourceBelongsToGroup(source, group));
    const runtimeBlocked = group.id === 'rsshub' && options.rsshubReady === false && matching.length > 0;
    return {
      id: group.id,
      label: group.label,
      sourceTypes: [...group.sourceTypes],
      enabledSourceCount: matching.length,
      ready: matching.length > 0 && !runtimeBlocked,
      reason: runtimeBlocked ? (options.rsshubReason || 'RSSHub 尚未安装或依赖未完成') : matching.length > 0 ? '' : '尚未配置或启用采集源',
    };
  });
}

export function selectBatchSourceGroups(requested, sources = [], options = {}) {
  const available = new Map(describeBatchSourceGroups(sources, options).map((group) => [group.id, group]));
  const unique = [...new Set((Array.isArray(requested) ? requested : []).filter((item) => available.has(item)))];
  const selected = unique.filter((item) => available.get(item).ready);
  return {
    requested: unique,
    selected,
    skipped: unique.filter((item) => !selected.includes(item)),
    available: [...available.values()],
  };
}
