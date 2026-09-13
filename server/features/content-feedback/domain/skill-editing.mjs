const MAX_EDIT_TEXT_CHARS = 2400;

function cleanPatchText(value, max = MAX_EDIT_TEXT_CHARS) { return String(value || '').trim().slice(0, max); }
function containsSkillMeta(value) { return /根据(?:本期|最近|当前)?(?:反馈|周期)|样本(?:量)?|每千|平均(?:阅读|读)|关注率|非因果|复盘反馈|作为参考/.test(String(value || '')); }

export function applySkillEdits(oldContent, edits = []) {
  let content = String(oldContent || '');
  const applied = [];
  const warnings = [];
  for (const item of Array.isArray(edits) ? edits.slice(0, 8) : []) {
    const oldText = cleanPatchText(item?.old_text);
    const newText = cleanPatchText(item?.new_text);
    if (!oldText || !newText) { warnings.push('技能修改缺少 old_text 或 new_text，已跳过。'); continue; }
    if (containsSkillMeta(newText)) { warnings.push('技能修改包含复盘分析话术，已跳过。'); continue; }
    const occurrences = content.split(oldText).length - 1;
    if (occurrences !== 1) { warnings.push(`技能修改原文定位不唯一或不存在：${oldText.slice(0, 80)}`); continue; }
    content = content.replace(oldText, newText);
    applied.push({ section: cleanPatchText(item?.section, 160), old_text: oldText, new_text: newText, reason: cleanPatchText(item?.reason, 800) });
  }
  return { content, applied, warnings };
}
