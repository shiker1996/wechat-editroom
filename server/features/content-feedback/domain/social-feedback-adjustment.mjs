const SOCIAL_COPY_SKILL_ID = 'xiaohongshu-article-generator';

function rank(map) {
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

export function resolveSocialSkillTargetsFromEvidence(rows = []) {
  const counts = { storyboard: new Map(), copy: new Map() };
  for (const row of Array.isArray(rows) ? rows : []) {
    const storyboard = String(row?.storyboard_skill_id || '').trim();
    const copy = String(row?.copy_skill_id || '').trim();
    if (storyboard) counts.storyboard.set(storyboard, (counts.storyboard.get(storyboard) || 0) + 1);
    if (copy) counts.copy.set(copy, (counts.copy.get(copy) || 0) + 1);
  }
  const storyboard = rank(counts.storyboard);
  const copy = rank(counts.copy);
  const targets = [];
  if (storyboard[0]) targets.push({ skill_id: storyboard[0][0], role: 'storyboard', sample_count: storyboard[0][1] });
  if (copy[0]) targets.push({ skill_id: copy[0][0], role: 'copy', sample_count: copy[0][1] });
  if (!copy[0]) targets.push({ skill_id: SOCIAL_COPY_SKILL_ID, role: 'copy', sample_count: 0 });
  return {
    targets,
    source: targets.some((item) => item.sample_count > 0) ? 'social-card-stage-executions' : 'builtin-fallback',
    evidence: [...rank(counts.storyboard).map(([skill_id, sample_count]) => ({ skill_id, role: 'storyboard', sample_count })), ...rank(counts.copy).map(([skill_id, sample_count]) => ({ skill_id, role: 'copy', sample_count }))],
  };
}

export { SOCIAL_COPY_SKILL_ID };
