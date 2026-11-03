export const RUNTIME_POLICY_SKILLS = Object.freeze(new Set([
  'wechat-mp-daily',
  'wechat-mp-personal-writing',
  'wechat-mp-tech-hotspot',
  'wechat-mp-tutorial',
  'wechat-article-typeset',
  'xiaohongshu-article-generator',
]));

export function ownsRuntimePolicy(skillId) {
  return RUNTIME_POLICY_SKILLS.has(String(skillId || ''));
}
