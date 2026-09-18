import { planArticleVisuals, insertVisualFences } from '../llm/visual-planner.mjs';
import { planImagePlaceholders } from './image-workflow.mjs';

// 三类成稿链共用的配图编排：先自动配图（Mermaid/ECharts 围栏直接插入正文），
// 再按既有 visualNeed=manual 规划必须由编辑手动提供的来源图/资料图占位。
// 没有有效视觉落点时不凭空插入图片占位，避免普通文章被无关配图打断完读。
export async function illustrateArticle({
  gateway, store, provider, batchId, candidateId = null, markdown, factBase = '',
  workspaceRoot = process.cwd(), maxOutputTokens = 5000, imageSkillPrompt = '',
  visualPolicy = 'auto', visualNeed = 'auto', onProgress = () => {},
}) {
  let visualPlan = { summary:'', placements:[], rejections:[] };
  let output = String(markdown || '');
  if (visualPolicy === 'off' || visualNeed === 'off') {
    visualPlan = { summary:'本篇没有必须用图解释的内容，按需跳过视觉规划。', placements:[], rejections:[], skipped:true, reason:visualPolicy === 'off' ? 'visual_policy_off' : 'visual_need_off' };
    onProgress('按视觉需求跳过图表与手动供图规划');
  } else try {
    visualPlan = await planArticleVisuals({
      gateway, provider, batchId, candidateId, markdown:output, factBase,
      workspaceRoot, maxOutputTokens, visualPolicy,
    });
    if (visualPlan.placements.length) {
      output = insertVisualFences(output, visualPlan.placements);
      onProgress(`已自动插入 ${visualPlan.placements.length} 张 Mermaid/ECharts 图表`);
    }
  } catch (error) {
    onProgress(`图表自动配图失败，跳过该环节：${error.message}`);
  }
  if (visualPolicy === 'off' || visualNeed === 'off') return { markdown: output, visualPlan };
  if (visualNeed !== 'manual' && !visualPlan.placements.length) {
    visualPlan = { ...visualPlan, imagePlaceholdersSkipped: true, imagePlaceholderReason: 'no_valid_visual_placement' };
    onProgress('没有有效视觉落点，跳过手动供图占位');
    return { markdown: output, visualPlan };
  }
  output = await planImagePlaceholders({
    gateway, store, batchId, candidateId, provider, markdown:output,
    maxOutputTokens:Math.min(5000, maxOutputTokens), skillPrompt:imageSkillPrompt,
  });
  return { markdown:output, visualPlan };
}
