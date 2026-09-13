import fs from 'node:fs';
import { indexArticleArtifacts } from '../../artifacts/article-artifact-indexer.mjs';
import { isInsideRoots } from '../../artifacts/artifact-indexer.mjs';
import { boundedLimit } from '../route-helpers.mjs';
import {
  buildAdjustmentDraft,
  buildContentFeedbackSnapshot,
  buildFeedbackAdjustmentMessages,
  buildFeedbackAdjustmentPatchMessages,
  buildProjectDiscoveryFeedbackSnapshot,
  buildSocialContentFeedbackSnapshot,
  buildSocialFeedbackAdjustmentDraft,
  buildSocialFeedbackAdjustmentPatchMessages,
  buildSocialFeedbackAdjustmentPlanningMessages,
  buildWechatStrategyRecommendations,
  confirmAdjustmentDraft,
  currentSkillFile,
  currentSkillPackageFiles,
  extractArticleContentFeatures,
  FEEDBACK_ADJUSTMENT_VERSION,
  fetchWechatArticleContent,
  linkWechatArticlesContent,
  listWriterSkillCatalog,
  matchWechatArticles,
  parseWechatExport,
  resolveSocialSkillTargets,
  resolveTitleSkillTarget,
  resolveWriterSkillTarget,
} from '../../../features/content-feedback/index.mjs';
import { getAccountContext } from '../../application/account-context-service.mjs';
import { enrichWechatReview, buildSocialFeedbackTrack } from '../../../features/content-feedback/application/wechat-review-service.mjs';
import { parseModelJson } from '../../llm/model-json.mjs';
import { createRequestHarnessGateway } from '../../skills/pipeline-runtime.mjs';

export async function handleContentFeedbackRoutes(context) {
  const { request, response, pathname, searchParams, store, artifactRoots, json, body, root, models } = context;

  if (request.method === 'GET' && pathname === '/api/wechat/review') {
    const matches = store.listWechatArticleMetricMatches({ limit: 1000 });
    const review = enrichWechatReview(store.getWechatReview({ month: searchParams.get('month') || '' }), matches);
    const social = buildSocialFeedbackTrack(store);
    json(response, 200, { ...review, review_tracks: { ...review.review_tracks, social } }); return true;
  }
  if (request.method === 'POST' && pathname === '/api/wechat/feedback/rebuild-social') {
    const track = buildSocialFeedbackTrack(store);
    json(response, 200, { status: 'ok', generated_at: new Date().toISOString(), count: Number(track.count || 0), track }); return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/matches') {
    json(response, 200, { items: store.listWechatArticleMetricMatches({ status: searchParams.get('status') || '', limit: boundedLimit(searchParams, 200, 1000) }), stats: store.wechatArticleMetricMatchStats(), artifacts: store.listWechatMatchArtifacts() }); return true;
  }
  if (request.method === 'POST' && pathname === '/api/wechat/matches/rematch') {
    const index = indexArticleArtifacts(store, artifactRoots);
    json(response, 200, { ...matchWechatArticles(store, { force: false }), index }); return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/content-links') {
    const items = store.listArticleContentLinks({ limit: boundedLimit(searchParams, 200, 1000) }).map((item) => {
      if (item.artifact_type !== '图文发布文案' || !item.file_path || !isInsideRoots(item.file_path, artifactRoots)) return item;
      try { return { ...item, copy_content: fs.readFileSync(item.file_path, 'utf8').slice(0, 100_000) }; } catch { return item; }
    });
    json(response, 200, { items }); return true;
  }
  if (request.method === 'POST' && pathname === '/api/wechat/content-links/relink') {
    const index = indexArticleArtifacts(store, artifactRoots);
    json(response, 200, { ...linkWechatArticlesContent(store, { root, artifactRoots }), index }); return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/feedback') {
    const feedback = store.getLatestContentFeedbackSnapshot();
    const analyses = store.listArticleContentAnalyses({ limit: 2000 });
    json(response, 200, { feedback, stats: { linked_articles: analyses.filter((item) => item.content_status === 'ok').length, features: analyses.filter((item) => item.feature_id).length } }); return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/project-feedback') {
    json(response, 200, { feedback: store.getLatestGithubProjectFeedbackSnapshot(), applied: store.getLatestAppliedGithubProjectFeedbackSnapshot(), history: store.listGithubProjectFeedbackSnapshots({ limit: 10 }) }); return true;
  }
  if (request.method === 'POST' && pathname === '/api/wechat/project-feedback/rebuild') {
    try {
      const rows = store.listGithubProjectFeedbackRows({ limit: 2000 });
      const feedback = store.saveGithubProjectFeedbackSnapshot(buildProjectDiscoveryFeedbackSnapshot(rows));
      json(response, 200, { status: 'ok', feedback, source_count: rows.length });
    } catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  const projectFeedbackAction = pathname.match(/^\/api\/wechat\/project-feedback\/(\d+)\/(apply|reject)$/);
  if (projectFeedbackAction && request.method === 'POST') {
    try {
      const snapshot = store.getGithubProjectFeedbackSnapshot(Number(projectFeedbackAction[1]));
      if (!snapshot) { json(response, 404, { error: '项目发现反馈快照不存在' }); return true; }
      if (projectFeedbackAction[2] === 'apply' && !snapshot.can_apply) { json(response, 400, { error: '当前样本不足或没有可应用的项目发现调整' }); return true; }
      json(response, 200, store.updateGithubProjectFeedbackSnapshotStatus(Number(projectFeedbackAction[1]), projectFeedbackAction[2] === 'apply' ? 'applied' : 'rejected'));
    } catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/strategy') {
    const review = enrichWechatReview(store.getWechatReview());
    json(response, 200, buildWechatStrategyRecommendations({ snapshots: store.listContentFeedbackSnapshots({ limit: 100 }), review, accountContext: getAccountContext({ workspaceRoot: root }) })); return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/feedback/adjustments') {
    json(response, 200, { version: FEEDBACK_ADJUSTMENT_VERSION, items: store.listContentFeedbackAdjustmentDrafts({ limit: boundedLimit(searchParams, 20, 100) }), writerSkills: listWriterSkillCatalog({ workspaceRoot: root }).map(({ id, label }) => ({ id, label })) }); return true;
  }
  if (request.method === 'POST' && pathname === '/api/wechat/feedback/adjustments/generate') {
    const streamProgress = typeof response?.writeHead === 'function' && typeof response?.write === 'function' && typeof response?.end === 'function';
    const emitProgress = (event) => { if (streamProgress && !response.writableEnded) response.write(`${JSON.stringify(event)}\n`); };
    let harness = null;
    try {
      if (!models?.complete) throw new Error('模型服务尚未配置，无法生成调整草案');
      if (streamProgress) response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      emitProgress({ type: 'progress', stage: 'snapshot', message: '正在检查并刷新反馈快照…' });
      const input = await body(request);
      harness = createRequestHarnessGateway({ gateway: models, store, entryPoint: 'content-feedback-adjustments', skillId: 'content-feedback-adjustments', provider: input.provider || models.config?.defaultProvider, stageId: 'content-feedback-adjustments' });
      let feedback = input.feedbackSnapshotId
        ? store.listContentFeedbackSnapshots({ limit: 100 }).find((item) => Number(item.id) === Number(input.feedbackSnapshotId))
        : store.getLatestContentFeedbackSnapshot();
      if (!feedback && input.scope !== 'social') throw new Error('还没有反馈快照，请先生成文章反馈');
      const currentAnalyses = store.listArticleContentAnalyses({ limit: 2000 });
      if (!input.feedbackSnapshotId && feedback) {
        const refreshed = buildContentFeedbackSnapshot(currentAnalyses, { review: store.getWechatReview() });
        const storedEvidence = JSON.stringify(feedback.writer_skill_evidence || []);
        const currentEvidence = JSON.stringify(refreshed.writer_skill_evidence || []);
        if (Number(feedback.linked_article_count || 0) !== Number(refreshed.linked_article_count || 0)
          || Number(feedback.feature_count || 0) !== Number(refreshed.feature_count || 0)
          || (currentEvidence !== storedEvidence && refreshed.writer_skill_evidence?.length)) {
          feedback = store.saveContentFeedbackSnapshot(refreshed);
        }
      }
      const titleSkillTarget = resolveTitleSkillTarget({ workspaceRoot: root, analyses: currentAnalyses, feedback });
      if (input.scope === 'social') {
        const reviewMatches = store.listWechatArticleMetricMatches({ limit: 1000 });
        const social = buildSocialFeedbackTrack(store);
        const socialFeedback = social.content_feedback || buildSocialContentFeedbackSnapshot(reviewMatches);
        const socialTarget = resolveSocialSkillTargets({ matches: reviewMatches });
        const socialSkills = Object.fromEntries(socialTarget.targets.map((item) => {
          const skillPaths = currentSkillPackageFiles(root, item.skill_id);
          const skillContents = Object.fromEntries(Object.entries(skillPaths).map(([file, filePath]) => {
            try { return [file, fs.readFileSync(filePath, 'utf8')]; } catch { return [file, '']; }
          }).filter(([, content]) => content));
          return [item.skill_id, skillContents];
        }).filter(([, files]) => Object.keys(files).length));
        emitProgress({ type: 'progress', stage: 'planning', message: '第一阶段：AI 正在判断图文故事板与文案技能调整目标（thinking）…' });
        const planningMessages = buildSocialFeedbackAdjustmentPlanningMessages({ feedback: socialFeedback, targets: socialTarget.targets });
        const planningResult = await harness.gateway.complete({ provider: input.provider, purpose: 'social-feedback-adjustment-plan', jsonMode: true, thinking: true, maxOutputTokens: 5000, messages: [{ role: 'system', protected: true, content: planningMessages.system }, { role: 'user', protected: true, content: planningMessages.user }] });
        const planning = parseModelJson(planningResult, { store, label: '图文复盘调整目标判断' });
        emitProgress({ type: 'progress', stage: 'patch', message: '第二阶段：AI 正在生成图文技能的精确 diff（thinking）…' });
        const patchMessages = buildSocialFeedbackAdjustmentPatchMessages({ feedback: socialFeedback, plan: planning, skills: socialSkills });
        const patchResult = await harness.gateway.complete({ provider: input.provider, purpose: 'social-feedback-adjustment-patch', jsonMode: true, thinking: true, maxOutputTokens: 8000, messages: [{ role: 'system', protected: true, content: patchMessages.system }, { role: 'user', protected: true, content: patchMessages.user }] });
        const patchOutput = parseModelJson(patchResult, { store, label: '图文复盘调整精确修改' });
        emitProgress({ type: 'progress', stage: 'validate', message: '正在校验图文技能原文定位并保存草案…' });
        const draft = buildSocialFeedbackAdjustmentDraft({ workspaceRoot: root, feedback: socialFeedback, targets: socialTarget.targets, targetEvidence: socialTarget.evidence, modelResult: { planning, patch: patchOutput }, provider: patchResult.provider || planningResult.provider || input.provider || '', model: patchResult.model || planningResult.model || '' });
        if (!draft.changes.length) {
          const result = { ...draft, status: 'no_change', saved: false, message: '未发现可安全融合到图文技能包的规则修改，不创建草案。' };
          harness.finish('completed'); if (streamProgress) { emitProgress({ type: 'complete', stage: 'complete', message: result.message, draft: result }); response.end(); } else json(response, 200, result);
          return true;
        }
        const saved = store.saveContentFeedbackAdjustmentDraft(draft);
        if (streamProgress) { emitProgress({ type: 'complete', stage: 'complete', message: '图文技能草案已生成，请检查 diff。', draft: saved }); response.end(); } else json(response, 201, saved);
        return true;
      }
      const writerSkillCatalog = listWriterSkillCatalog({ workspaceRoot: root });
      const availableWriterSkillIds = new Set(writerSkillCatalog.map((item) => item.id));
      const writerSkillTarget = resolveWriterSkillTarget({ workspaceRoot: root, entryPoint: 'hotspot-article' });
      const writerSkillHint = availableWriterSkillIds.has(String(input.writerSkillId || '')) ? String(input.writerSkillId) : '';
      const read = (filePath) => filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
      const accountContext = getAccountContext({ workspaceRoot: root, refresh: true });
      const strategy = buildWechatStrategyRecommendations({ snapshots: store.listContentFeedbackSnapshots({ limit: 100 }), review: enrichWechatReview(store.getWechatReview()), accountContext });
      emitProgress({ type: 'progress', stage: 'planning', message: '第一阶段：AI 正在判断调整目标（thinking）…' });
      const planningMessages = buildFeedbackAdjustmentMessages({ feedback, strategy, accountContext, titleSkillId: titleSkillTarget.skillId, titleSkillEvidence: titleSkillTarget.evidence, writerSkillId: writerSkillHint, currentWriterSkillId: writerSkillTarget.skillId, writerSkillCatalog });
      const planningResult = await harness.gateway.complete({ provider: input.provider, purpose: 'content-feedback-adjustment-plan', jsonMode: true, thinking: true, maxOutputTokens: 5000, messages: [{ role: 'system', protected: true, content: planningMessages.system }, { role: 'user', protected: true, content: planningMessages.user }] });
      const planning = parseModelJson(planningResult, { store, label: '复盘调整目标判断' });
      const planningWriterSkillId = String(planning.selected_writer_skill_id || '');
      const hasInferenceEvidence = Number(feedback.linked_article_count || 0) >= 3 && Array.isArray(feedback.body_signals) && feedback.body_signals.length > 0;
      const selectedWriterSkillId = writerSkillTarget.skillId || (availableWriterSkillIds.has(planningWriterSkillId)
        && ((writerSkillTarget.skillId === planningWriterSkillId) || (feedback.writer_skill_evidence || []).some((item) => String(item?.skill_id || '') === planningWriterSkillId && Number(item?.sample_count || 0) >= 3) || hasInferenceEvidence)
        ? planningWriterSkillId : '');
      const resolvedTitlePath = currentSkillFile(root, titleSkillTarget.skillId);
      const writerPath = selectedWriterSkillId ? (writerSkillCatalog.find((item) => item.id === selectedWriterSkillId)?.sourcePath || '') : '';
      emitProgress({ type: 'progress', stage: 'patch', message: '第二阶段：AI 正在生成原有规则的精确 diff（thinking）…' });
      const patchMessages = buildFeedbackAdjustmentPatchMessages({ feedback, strategy, accountContext, plan: planning, titleSkillId: titleSkillTarget.skillId, titleSkill: read(resolvedTitlePath), writerSkill: read(writerPath) });
      const patchResult = await harness.gateway.complete({ provider: input.provider, purpose: 'content-feedback-adjustment-patch', jsonMode: true, thinking: true, maxOutputTokens: 8000, messages: [{ role: 'system', protected: true, content: patchMessages.system }, { role: 'user', protected: true, content: patchMessages.user }] });
      const patchOutput = parseModelJson(patchResult, { store, label: '复盘调整精确修改' });
      emitProgress({ type: 'progress', stage: 'validate', message: '正在校验原文定位并保存草案…' });
      const draft = buildAdjustmentDraft({ workspaceRoot: root, feedback, strategy, accountContext, modelResult: { planning, patch: patchOutput }, titleSkillId: titleSkillTarget.skillId, titleSkillEvidence: titleSkillTarget.evidence, titleSkillSelectionSource: titleSkillTarget.source, currentWriterSkillId: writerSkillTarget.skillId, writerSkillId: writerSkillHint, provider: patchResult.provider || planningResult.provider || input.provider || '', model: patchResult.model || planningResult.model || '' });
      if (!draft.changes.length) {
        const result = { ...draft, status: 'no_change', saved: false, message: '未发现可安全融合到现有配置或技能的规则修改，不创建草案。' };
        harness.finish('completed'); if (streamProgress) { emitProgress({ type: 'complete', stage: 'complete', message: result.message, draft: result }); response.end(); } else json(response, 200, result);
        return true;
      }
      const saved = store.saveContentFeedbackAdjustmentDraft(draft);
      harness.finish('completed'); if (streamProgress) { emitProgress({ type: 'complete', stage: 'complete', message: '草案已生成，请检查 diff。', draft: saved }); response.end(); } else json(response, 201, saved);
    } catch (error) {
      harness?.finish('failed', error.message);
      if (streamProgress && response.headersSent) { emitProgress({ type: 'error', error: error.message, code: error.code || 'FEEDBACK_ADJUSTMENT_FAILED' }); response.end(); }
      else json(response, error.code === 'MODEL_JSON_INVALID' ? 422 : 400, { error: error.message, code: error.code || 'FEEDBACK_ADJUSTMENT_FAILED' });
    }
    return true;
  }
  const adjustmentChangeMatch = pathname.match(/^\/api\/wechat\/feedback\/adjustments\/(\d+)\/change\/(\d+)\/save$/);
  if (adjustmentChangeMatch && request.method === 'POST') {
    try {
      const draftId = Number(adjustmentChangeMatch[1]);
      const changeIndex = Number(adjustmentChangeMatch[2]);
      const draft = store.getContentFeedbackAdjustmentDraft(draftId);
      if (!draft) { json(response, 404, { error: '调整草案不存在', code: 'ADJUSTMENT_DRAFT_NOT_FOUND' }); return true; }
      if (draft.status !== 'pending') { json(response, 409, { error: '只有待确认的调整草案可以修改', code: 'ADJUSTMENT_DRAFT_NOT_PENDING' }); return true; }
      if (draft.source?.adjustment_version !== FEEDBACK_ADJUSTMENT_VERSION) { json(response, 409, { error: '调整草案来自旧版本，请重新生成', code: 'ADJUSTMENT_DRAFT_STALE' }); return true; }
      if (!Number.isInteger(changeIndex) || changeIndex < 0 || changeIndex >= (draft.changes || []).length) { json(response, 404, { error: '调整草案文件不存在', code: 'ADJUSTMENT_CHANGE_NOT_FOUND' }); return true; }
      const input = await body(request);
      if (typeof input?.new_content !== 'string') { json(response, 400, { error: 'new_content 必须是字符串', code: 'ADJUSTMENT_CHANGE_CONTENT_INVALID' }); return true; }
      const changes = [...(draft.changes || [])];
      changes[changeIndex] = { ...changes[changeIndex], new_content: input.new_content, manually_edited: true };
      json(response, 200, store.updateContentFeedbackAdjustmentDraftChanges(draftId, changes));
    } catch (error) { json(response, error.code === 'ADJUSTMENT_DRAFT_NOT_FOUND' ? 404 : 400, { error: error.message, code: error.code || 'FEEDBACK_ADJUSTMENT_CHANGE_SAVE_FAILED' }); }
    return true;
  }
  const adjustmentMatch = pathname.match(/^\/api\/wechat\/feedback\/adjustments\/(\d+)\/(confirm|reject|delete)$/);
  if (adjustmentMatch && request.method === 'POST') {
    try {
      const id = Number(adjustmentMatch[1]); const action = adjustmentMatch[2] || '';
      const draft = store.getContentFeedbackAdjustmentDraft(id);
      if (!draft) { json(response, 404, { error: '调整草案不存在' }); return true; }
      if (action === 'reject') { json(response, 200, store.updateContentFeedbackAdjustmentDraftStatus(id, 'rejected')); return true; }
      if (action === 'delete') { json(response, 200, store.deleteContentFeedbackAdjustmentDraft(id)); return true; }
      if (action !== 'confirm') { json(response, 400, { error: '请指定 confirm、reject 或 delete' }); return true; }
      const result = confirmAdjustmentDraft({ workspaceRoot: root, draft });
      json(response, 200, { ...store.updateContentFeedbackAdjustmentDraftStatus(id, 'confirmed'), ...result });
    } catch (error) { json(response, error.code === 'ADJUSTMENT_SOURCE_CONFLICT' ? 409 : 400, { error: error.message, code: error.code || 'FEEDBACK_ADJUSTMENT_CONFIRM_FAILED' }); }
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/wechat/feedback/rebuild') {
    const analyses = store.listArticleContentAnalyses({ limit: 2000 });
    for (const item of analyses) {
      if (item.content_status !== 'ok' || !item.snapshot_id) continue;
      const features = extractArticleContentFeatures(item, { metricTitle: item.metric_title, evidenceAssets: item.evidence_assets });
      item.features = features;
      store.saveArticleContentFeatures({ snapshotId: item.snapshot_id, metricId: item.metric_id, features });
    }
    const feedback = store.saveContentFeedbackSnapshot(buildContentFeedbackSnapshot(analyses, { review: store.getWechatReview() }));
    json(response, 200, { feedback, extracted: analyses.filter((item) => item.content_status === 'ok').length }); return true;
  }
  const wechatContentMatch = pathname.match(/^\/api\/wechat\/content-links\/(\d+)\/fetch$/);
  if (wechatContentMatch && request.method === 'POST') {
    try { json(response, 200, await fetchWechatArticleContent(store, { matchId: Number(wechatContentMatch[1]), root })); }
    catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  const wechatMatchMatch = pathname.match(/^\/api\/wechat\/matches\/(\d+)$/);
  if (wechatMatchMatch && request.method === 'PATCH') {
    try { json(response, 200, store.updateWechatArticleMetricMatch(Number(wechatMatchMatch[1]), await body(request))); }
    catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/wechat/imports') { json(response, 200, store.listWechatImports()); return true; }
  if (request.method === 'POST' && pathname === '/api/wechat/import') {
    const input = await body(request);
    if (!input.data) { json(response, 400, { error: '缺少文件内容' }); return true; }
    const buffer = Buffer.from(String(input.data).replace(/^data:[^;]+;base64,/, ''), 'base64');
    const parsed = parseWechatExport(buffer, input.fileName || 'export.xls');
    const imported = store.importWechatExport({ fileName: input.fileName, importType: input.importType, format: parsed.format, sheets: parsed.sheets });
    const index = indexArticleArtifacts(store, artifactRoots);
    const matches = matchWechatArticles(store, { force: false });
    json(response, 201, { ...imported, index, matches }); return true;
  }
  return false;
}
