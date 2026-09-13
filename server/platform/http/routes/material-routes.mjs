import { buildContentPlanningRecommendation, sortMaterialsByPlanningRecommendation } from '../../../features/content-planning/index.mjs';
import { buildWechatInsights, classifyWechatArticle, matchWechatPerformance } from '../../../features/content-feedback/index.mjs';
import { getAccountContext } from '../../application/account-context-service.mjs';
import { boundedLimit } from '../route-helpers.mjs';

function materialInsights(store) {
  const review = store.getWechatReview();
  const matches = store.listWechatArticleMetricMatches({ limit: 1000 });
  const metricIds = new Set();
  for (const match of matches || []) {
    if (!['confirmed', 'auto_confirmed', 'rejected'].includes(match?.status) || !match.metric_id) continue;
    if (match.content_type === 'social' || match.artifact_type === '图文发布文案' || match.content_type === 'article' || match.artifact_type) {
      metricIds.add(Number(match.metric_id));
    }
  }
  return buildWechatInsights((review.articles || []).map(classifyWechatArticle).filter((item) => metricIds.has(Number(item.id))));
}

function assessmentContext(store, root, material) {
  const insights = materialInsights(store);
  const title = material?.title ?? material?.titleText ?? '';
  const rawText = material?.raw_text ?? material?.rawText ?? '';
  return {
    columns: store.listContentColumns(),
    accountContext: getAccountContext({ workspaceRoot: root }),
    historicalSignal: matchWechatPerformance(`${title}\n${rawText}`, insights),
  };
}

function enrichMaterial(material, insights, feedback) {
  if (!material) return material;
  const assessment = material.assessment?.account_fit
    ? { ...material.assessment, historical_signal: matchWechatPerformance(`${material.title || ''}\n${material.raw_text || ''}`, insights) }
    : material.assessment;
  return {
    ...material,
    ...(assessment ? { assessment } : {}),
    planning_recommendation: buildContentPlanningRecommendation(material, { feedback, insights }),
  };
}

function attachMainlineStatus(store, materials) {
  if (!Array.isArray(materials) || !materials.length) return materials || [];
  const statuses = store.mainlineBriefStatuses(materials.map((item) => Number(item.id)).filter(Boolean));
  return materials.map((material) => {
    const line = statuses.get(Number(material.id));
    return { ...material, mainline_status: line?.mainline_status || '未提炼', active_brief_id: line?.brief_id || null };
  });
}

// 素材查询、写入与评估路由。规划推荐仍复用 content-planning 的确定性能力；
// 素材核心用例通过 Store 暴露的 materials application 执行。
export async function handleMaterialRoutes(context) {
  const { request, response, pathname, searchParams, store, json, body, root } = context;

  if (request.method === 'GET' && pathname === '/api/writing-materials') {
    const insights = materialInsights(store);
    const feedback = store.getLatestContentFeedbackSnapshot();
    let materials = store.listWritingMaterials({
      status: searchParams.get('status') || '',
      sourceType: searchParams.get('source_type') || '',
      query: searchParams.get('q') || '',
      limit: boundedLimit(searchParams, 200, 500),
    }).map((material) => enrichMaterial(material, insights, feedback));
    materials = attachMainlineStatus(store, materials);
    if (searchParams.get('sort') === 'feedback') materials = sortMaterialsByPlanningRecommendation(materials);
    json(response, 200, materials);
    return true;
  }

  const materialMatch = pathname.match(/^\/api\/writing-materials\/(\d+)$/);
  if (materialMatch && ['PATCH', 'PUT'].includes(request.method)) {
    json(response, 200, store.updateWritingMaterial(Number(materialMatch[1]), await body(request)));
    return true;
  }
  if (materialMatch && request.method === 'GET') {
    const insights = materialInsights(store);
    const material = enrichMaterial(store.getWritingMaterial(Number(materialMatch[1])), insights, store.getLatestContentFeedbackSnapshot());
    json(response, material ? 200 : 404, material ? attachMainlineStatus(store, [material])[0] : { error: '素材不存在' });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/writing-materials') {
    const input = await body(request);
    const material = store.captureWritingMaterial(input, assessmentContext(store, root, input));
    json(response, 201, material);
    return true;
  }
  const assessmentMatch = pathname.match(/^\/api\/writing-materials\/(\d+)\/assessment$/);
  if (assessmentMatch && request.method === 'POST') {
    const material = store.getWritingMaterial(Number(assessmentMatch[1]));
    if (!material) { json(response, 404, { error: '素材不存在' }); return true; }
    json(response, 200, store.reassessWritingMaterial(material.id, assessmentContext(store, root, material)));
    return true;
  }
  return false;
}
