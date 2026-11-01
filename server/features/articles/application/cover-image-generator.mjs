// 公众号封面图生成：每次生成文章专属设计方案，经约束校验后由 AI 输出 HTML/CSS，再截图为 900×383 PNG。
// 设计文档：docs/archive/2026-08-07-cover-image-design.md
import fs from 'node:fs';
import path from 'node:path';
import { generateCoverDesignScheme } from './cover-design-scheme.mjs';
import { getAccountContext } from '../../../platform/application/account-context-service.mjs';
import { candidateArticleDir, batchArticlesDir } from '../../../platform/core/workspace-paths.mjs';
import { runAiVisualCoverJob } from './ai-visual-cover-generator.mjs';

// 从成稿 Markdown 取第一段正文作为封面副标题素材（去标题/引用/列表，≤60 字）
function firstParagraph(markdown) {
  for (const line of String(markdown || '').split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#') || text.startsWith('>') || text.startsWith('-') || text.startsWith('*') || /^\d+\./.test(text)) continue;
    const plain = text.replace(/[*`[\]]/g, '').trim();
    if ([...plain].length >= 12) return [...plain].slice(0, 60).join('');
  }
  return '';
}

// AI 任务出口：解析候选上下文 → 生成 → 落 artifacts（kind=封面图）
// candidateId 为 null 时是批次早报：终稿取批次级 daily-final 文档，产物落 articles/<批次>/daily/images/
export async function runCoverImageJob({ gateway, store, batchId, candidateId, provider, workspaceRoot, rootRunId = null, workflowRunId = null, onProgress = () => {}, onEvent = () => {} }) {
  const batch = store.getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  const daily = candidateId == null;
  const candidate = daily ? null : store.getCandidate(Number(candidateId));
  if (!daily && !candidate) throw new Error('候选不存在');
  const accountContext = getAccountContext({workspaceRoot});
  const workdir = daily ? path.join(batchArticlesDir(workspaceRoot, batch), 'daily') : candidateArticleDir(workspaceRoot, batch, candidate);
  const finalDoc = store.getDocument(batchId, daily ? null : candidate.id, daily ? 'daily-final' : 'final');
  if (!finalDoc) throw new Error(daily ? '缺少早报终稿，请先完成批次早报' : '缺少成稿终稿，请先完成成稿链');
  // title 字段已统一为正文 H1（成稿链保存时提取），封面直接以它为原题
  const title = String(finalDoc?.title || candidate?.hotspot_title || '').trim() || (daily ? '批次早报' : '未命名文章');
  const summary = firstParagraph(finalDoc?.content);
  const now = new Date();
  const brand = `${accountContext?.name || ''} · ${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
  onProgress('正在生成并校验本篇封面设计方案…');
  const designScheme = await generateCoverDesignScheme({ gateway, store, provider, batchId, candidateId, workspaceRoot, workdir, title, summary, brand, log: onProgress });
  const result = await runAiVisualCoverJob({ workspaceRoot, workdir, gateway, store, batchId, candidateId, title, summary, brand,
    designScheme, provider, rootRunId, workflowRunId, onProgress, onEvent });
  store.upsertArtifact({ batchId, candidateId: candidate?.id ?? null, kind: '封面图', name: 'cover.png', path: result.localPath, size: result.size, modifiedAt: result.modifiedAt });
  const imageDir = path.join(workdir, 'images');
  const artifactNames = ['cover-design-scheme.json', 'cover-design-scheme.md', 'ai-cover.html', 'cover.html', 'cover-visual-input.json', 'cover-ai-generation.json', 'cover-ai-stage-executions.json', 'cover-ai-delivery-gate.json', 'cover-ai-skill-manifest.json'];
  for (const name of artifactNames) {
    const artifactPath = path.join(imageDir, name);
    if (!fs.existsSync(artifactPath)) continue;
    const stat = fs.statSync(artifactPath);
    store.upsertArtifact({ batchId, candidateId: candidate?.id ?? null, kind: name.startsWith('cover-design') ? '封面设计方案' : 'AI视觉封面运行记录', name, path: artifactPath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
  }
  onProgress('封面已按本篇设计方案生成');
  return { image: 'images/cover.png', mode: 'ai-visual', aiVisualFallback: false, aiVisualError: '', designSchemeId: designScheme.id, width: result.width, height: result.height };
}
