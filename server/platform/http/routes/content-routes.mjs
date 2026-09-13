import fs from 'node:fs';
import path from 'node:path';
import { indexArtifacts, isInsideRoots, resolveArtifactRelativeAsset } from '../../artifacts/artifact-indexer.mjs';
import { indexArticleArtifacts } from '../../artifacts/article-artifact-indexer.mjs';
import { imageArtifactPreviewHtml, injectPhonePreviewStyles, isImageArtifact, textArtifactPreviewHtml } from '../../artifacts/artifact-preview.mjs';
import { boundedLimit, pipeFile } from '../route-helpers.mjs';
import { buildContentPlanningRecommendation } from '../../../features/content-planning/content-planning-recommendations.mjs';
import { materialBriefReadiness } from '../../../features/content-planning/material-brief-service.mjs';
import { matchWechatArticles } from '../../../features/content-feedback/index.mjs';
import { enrichWechatReview } from '../../../features/content-feedback/application/wechat-review-service.mjs';
import { parseModelJson } from '../../llm/model-json.mjs';
import { createRequestHarnessGateway } from '../../skills/pipeline-runtime.mjs';

const ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'";

function enrichCalendarEntry(entry, insights, feedback) {
  if (entry?.content_type !== 'writing_plan') return entry;
  return {
    ...entry,
    planning_recommendation: buildContentPlanningRecommendation({
      title: entry.title,
      raw_text: entry.raw_text,
      next_teaser: entry.teaser,
    }, { feedback, insights }),
  };
}

export async function handleContentRoutes(context) {
  const { request, response, pathname, searchParams, store, artifactRoots, mime, json, body, root, models } = context;

  if (request.method === 'GET' && pathname === '/api/content-columns') {
    json(response, 200, store.listContentColumns({ includeInactive: searchParams.get('all') === '1' })); return true;
  }
  if (request.method === 'POST' && pathname === '/api/content-columns') {
    json(response, 201, store.saveContentColumn(await body(request))); return true;
  }
  if (request.method === 'GET' && pathname === '/api/writing-material-plans') { json(response, 200, store.listWritingPlans({ month: searchParams.get('month') || '', limit: boundedLimit(searchParams, 300, 500) })); return true; }
  if (request.method === 'POST' && pathname === '/api/writing-material-plans') { json(response, 201, store.createWritingPlan(await body(request))); return true; }
const planMatch = pathname.match(/^\/api\/writing-material-plans\/(\d+)$/);
  if (planMatch && ['PATCH', 'PUT'].includes(request.method)) { json(response, 200, store.updateWritingPlan(Number(planMatch[1]), await body(request))); return true; }
  if (request.method === 'GET' && pathname === '/api/writing-material-briefs') {
    const materialId = searchParams.get('materialId') || '';
    json(response, 200, store.listWritingMaterialBriefs(materialId ? { materialId } : {})); return true;
  }
  if (request.method === 'POST' && pathname === '/api/writing-material-briefs') {
    try { const brief = store.createWritingMaterialBrief(await body(request)); brief.readiness = materialBriefReadiness(brief); json(response, 201, brief); }
    catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  const briefMatch = pathname.match(/^\/api\/writing-material-briefs\/(\d+)$/);
  if (briefMatch && request.method === 'GET') { const brief = store.getWritingMaterialBrief(Number(briefMatch[1])); if (brief) brief.readiness = materialBriefReadiness(brief); json(response, brief ? 200 : 404, brief || { error: '素材简报不存在' }); return true; }
  if (briefMatch && ['PATCH', 'PUT'].includes(request.method)) {
    try {
      const brief = store.updateWritingMaterialBrief(Number(briefMatch[1]), await body(request));
      if (brief) brief.readiness = materialBriefReadiness(brief);
      json(response, brief ? 200 : 404, brief || { error: '素材简报不存在' });
    } catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  const briefGenerateMatch = pathname.match(/^\/api\/writing-material-briefs\/(\d+)\/generate$/);
  if (briefGenerateMatch && request.method === 'POST') {
    const brief = store.getWritingMaterialBrief(Number(briefGenerateMatch[1]));
    if (!brief) { json(response, 404, { error: '素材简报不存在' }); return true; }
    if (brief.status === 'confirmed') { json(response, 409, { error: '简报已锁定；生成新候选请先创建新简报' }); return true; }
    if (!models?.complete) { json(response, 400, { error: '模型能力不可用' }); return true; }
    try {
      const materials = brief.materialIds.map((id) => store.getWritingMaterial(id)).filter(Boolean);
      const context = materials.map((item) => `素材 ${item.id}（${item.source_type}）${item.title ? `标题：${item.title}` : ''}\n${String(item.raw_text || '').slice(0, 6000)}`).join('\n\n---\n\n');
      const routedProvider = typeof models.resolveForInput === 'function'
        ? models.resolveForInput({ purpose: 'material-brief' })?.provider
        : null;
      const providerConfig = models.config?.providers?.[routedProvider || models.config.defaultProvider] || {};
      const harness=createRequestHarnessGateway({gateway:models,store,entryPoint:'material-brief-generate',skillId:'material-brief',provider:routedProvider||models.config.defaultProvider,stageId:'material-brief'});
      let result; try { result = await harness.gateway.complete({
        purpose: 'material-brief', batchId: null, jsonMode: true, maxOutputTokens: Math.min(4000, providerConfig.maxOutputTokens || 4000),
        messages: [
          { role: 'system', protected: true, content: '你是素材主编。基于给定素材产出一份可被作者确认的写作主线简报。约束：事实摘要只能归纳素材原文，不得新增事实；冲突/反差/未解决问题必须有素材依据；主线候选 2-4 个，每个包含 id（mainline-1）、title 主线名称、question 围绕什么问题展开、thesis 候选核心观点（可被读者同意或反对）、argument 论据方向数组、counter_argument 反方或限制、evidence_refs 引用 fact_summary 中给出的事实 id；不把模型生成的观点伪装成作者经历。返回严格 JSON：{"fact_summary":[{"id":"material-fact-1","text":"已确认事实","source":"material","confidence":"confirmed"}],"context":"背景","tension":"冲突反差","why_it_matters":"对目标读者的影响","mainline_candidates":[{"id":"mainline-1","title":"主线名称","question":"问题","thesis":"核心观点","argument":["论据"],"counter_argument":"反方","evidence_refs":["material-fact-1"]}],"discussion_question":"读者可能争论的问题","missing_evidence":["仍需补充或核验的内容"],"recommended_formats":["article-experience","social-opinion"]}' },
          { role: 'user', protected: true, content: `请提炼以下素材的写作主线：\n\n${context}` },
        ],
      }); harness.finish('completed'); } catch (error) { harness.finish('failed',error.message); throw error; }
      const parsed = parseModelJson(result, { label: '素材简报主线' });
      const factSummary = (Array.isArray(parsed.fact_summary) ? parsed.fact_summary : []).map((item, index) => ({
        id: String(item.id || `material-fact-${index + 1}`),
        text: String(item.text || '').trim(),
        source: String(item.source || 'material'),
        confidence: String(item.confidence || 'confirmed'),
      })).filter((item) => item.text);
      const mainlineCandidates = (Array.isArray(parsed.mainline_candidates) ? parsed.mainline_candidates : []).map((item, index) => ({
        id: String(item.id || `mainline-${index + 1}`),
        title: String(item.title || `主线 ${index + 1}`).trim(),
        question: String(item.question || '').trim(),
        thesis: String(item.thesis || '').trim(),
        argument: Array.isArray(item.argument) ? item.argument.map((v) => String(v).trim()).filter(Boolean) : [],
        counter_argument: String(item.counter_argument || '').trim(),
        evidence_refs: Array.isArray(item.evidence_refs) ? item.evidence_refs.map((v) => String(v).trim()).filter(Boolean) : [],
      })).filter((item) => item.thesis).slice(0, 4);
      const updated = store.updateWritingMaterialBrief(brief.id, {
        factSummary,
        context: String(parsed.context || '').trim(),
        tension: String(parsed.tension || '').trim(),
        whyItMatters: String(parsed.why_it_matters || '').trim(),
        mainlineCandidates,
        discussionQuestion: String(parsed.discussion_question || '').trim(),
        missingEvidence: Array.isArray(parsed.missing_evidence) ? parsed.missing_evidence.map((v) => String(v).trim()).filter(Boolean) : [],
        recommendedFormats: Array.isArray(parsed.recommended_formats) ? parsed.recommended_formats.map((v) => String(v).trim()).filter(Boolean) : [],
      });
      updated.readiness = materialBriefReadiness(updated);
      json(response, 200, updated);
    } catch (error) {
      json(response, 400, { error: `提炼主线失败：${error.message}` });
    }
    return true;
  }
  const briefConfirmMatch = pathname.match(/^\/api\/writing-material-briefs\/(\d+)\/confirm$/);
  if (briefConfirmMatch && request.method === 'POST') {
    const brief = store.getWritingMaterialBrief(Number(briefConfirmMatch[1]));
    if (!brief) { json(response, 404, { error: '素材简报不存在' }); return true; }
    const input = await body(request);
    const draft = input.draft && typeof input.draft === 'object' ? input.draft : null;
    if (draft) {
      const allowed = ['factSummary', 'context', 'tension', 'whyItMatters', 'mainlineCandidates', 'selectedMainlineId', 'confirmedTopic', 'confirmedThesis', 'discussionQuestion', 'audience', 'missingEvidence', 'authorExperienceConfirmed'];
      const patch = Object.fromEntries(allowed.filter((key) => draft[key] !== undefined).map((key) => [key, draft[key]]));
      if (Object.keys(patch).length) store.updateWritingMaterialBrief(brief.id, patch);
    }
    const current = store.getWritingMaterialBrief(brief.id);
    const readiness = materialBriefReadiness(current);
    store.updateWritingMaterialBrief(brief.id, { readinessFlags: readiness.flags });
    const confirmed = store.confirmWritingMaterialBrief(brief.id, { confirmedBy: String(input.confirmedBy || 'editor').trim() });
    confirmed.readiness = materialBriefReadiness(confirmed);
    json(response, 200, confirmed); return true;
  }
  if (request.method === 'GET' && pathname === '/api/article-publications') {
    const publication = store.getArticlePublication({
      id: searchParams.get('id') || null,
      planId: searchParams.get('planId') || null,
      documentId: searchParams.get('documentId') || null,
    });
    json(response, publication ? 200 : 404, publication || { error: '发布信息不存在' }); return true;
  }
  if (request.method === 'POST' && pathname === '/api/article-publications') {
    try { json(response, 200, store.saveArticlePublication(await body(request))); }
    catch (error) { json(response, 400, { error: error.message }); }
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/hotspots') {
    json(response, 200, store.listHotspots({
      q: searchParams.get('q') ?? '',
      source: searchParams.get('source') ?? '',
      date: searchParams.get('date') ?? '',
      limit: boundedLimit(searchParams,200,500),
    }));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/artifacts') {
    json(response, 200, store.listArtifacts({
      limit: boundedLimit(searchParams,300,500),
      batchId: searchParams.get('batch_id') || undefined,
    }));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/article-artifacts') {
    const items = store.listArticleArtifacts({
      query: searchParams.get('q') || '',
      status: searchParams.get('status') || '',
      limit: boundedLimit(searchParams, 300, 1000),
    }).map((item) => ({
      ...item,
      relative_path: path.relative(root, item.file_path).replaceAll('\\', '/'),
    }));
    json(response, 200, {
      items,
      stats: store.articleArtifactStats(),
    });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/article-artifacts/reindex') {
    const indexed = indexArticleArtifacts(store, artifactRoots);
    const matches = matchWechatArticles(store, { force: false });
    json(response, 200, { ...indexed, matches });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/artifacts/reindex') {
    json(response, 200, { indexed: indexArtifacts(store, artifactRoots) });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/articles') {
    json(response, 200, store.listFinalArticles({
      week: searchParams.get('week') || undefined,
      month: searchParams.get('month') || undefined,
    }));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/calendar') {
    const insights = enrichWechatReview(store.getWechatReview()).insights;
    const feedback = store.getLatestContentFeedbackSnapshot();
    json(response, 200, store.listCalendarContent({ month: searchParams.get('month') || undefined }).map((entry) => enrichCalendarEntry(entry, insights, feedback)));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/articles/stats') {
    json(response, 200, store.articleStats());
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/logs') {
    json(response, 200, store.listLogs({
      limit: boundedLimit(searchParams,100,500),
      logType: searchParams.get('type') || undefined,
    }));
    return true;
  }

  const artifactPreviewMatch = pathname.match(/^\/api\/artifacts\/(\d+)\/preview$/);
  if (artifactPreviewMatch && request.method === 'GET') {
    const artifact = store.getArtifact(Number(artifactPreviewMatch[1]));
    if (!artifact || !isInsideRoots(artifact.file_path, artifactRoots) || !fs.existsSync(artifact.file_path)) {
      json(response, 404, { error: '产物不存在或不在允许目录内' });
      return true;
    }
    response.setHeader('content-security-policy', ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY);
    if (isImageArtifact(artifact.file_path)) {
      response.writeHead(200, { 'content-security-policy': ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(imageArtifactPreviewHtml(`/api/artifacts/${artifact.id}/content`, artifact.name));
      return true;
    }
    if (path.extname(artifact.file_path).toLowerCase() !== '.html') {
      response.writeHead(200, { 'content-security-policy': ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(textArtifactPreviewHtml(fs.readFileSync(artifact.file_path, 'utf8'), artifact.name));
      return true;
    }
    response.writeHead(302, { location: `/api/artifacts/${artifact.id}/content` });
    response.end();
    return true;
  }

  const artifactMatch = pathname.match(/^\/api\/artifacts\/(\d+)\/content$/);
  if (artifactMatch && request.method === 'GET') {
    const artifact = store.getArtifact(Number(artifactMatch[1]));
    if (!artifact || !isInsideRoots(artifact.file_path, artifactRoots) || !fs.existsSync(artifact.file_path)) {
      json(response, 404, { error: '产物不存在或不在允许目录内' });
      return true;
    }
    const extension = path.extname(artifact.file_path).toLowerCase();
    if (extension === '.html' && searchParams.get('preview') === 'phone') {
      response.writeHead(200, { 'content-security-policy': ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(injectPhonePreviewStyles(fs.readFileSync(artifact.file_path, 'utf8')));
      return true;
    }
    const contentHeaders = { 'content-type': mime[extension] ?? 'text/plain; charset=utf-8' };
    if (extension === '.html') contentHeaders['content-security-policy'] = ARTIFACT_PREVIEW_CONTENT_SECURITY_POLICY;
    response.writeHead(200, contentHeaders);
    return pipeFile(response,artifact.file_path);
  }

  const artifactAssetMatch = pathname.match(/^\/api\/artifacts\/(\d+)\/(.+)$/);
  if (artifactAssetMatch && request.method === 'GET') {
    const artifact = store.getArtifact(Number(artifactAssetMatch[1]));
    let relativePath = '';
    try {
      relativePath = decodeURIComponent(artifactAssetMatch[2]);
    } catch {
      json(response, 400, { error: '产物资源路径无效' });
      return true;
    }
    const assetPath = artifact && isInsideRoots(artifact.file_path, artifactRoots)
      ? resolveArtifactRelativeAsset(artifact.file_path, relativePath, artifactRoots)
      : null;
    if (!assetPath) {
      json(response, 404, { error: '产物资源不存在或不在允许目录内' });
      return true;
    }
    const extension = path.extname(assetPath).toLowerCase();
    response.writeHead(200, {
      'content-type': mime[extension] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    return pipeFile(response,assetPath);
  }

  return false;
}
