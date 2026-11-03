import { executeCapability } from '../../tools/capability-runtime.mjs';
import { createStoreExecutionLogger } from '../../tools/execution-log.mjs';
import { auditExternalArticleLocally, generateArticleImage, registerGeneratedSlotImage, renderCover, validateGeneratedCoverHtml } from '../../../features/articles/index.mjs';
import { pipeFile } from '../route-helpers.mjs';
import { createRequestHarnessGateway } from '../../skills/pipeline-runtime.mjs';
import { deriveWritingStance, visualPolicyForStance } from '../../../shared/domain/writing-stance.mjs';
import { htmlPreservesStructure } from '../../../shared/rendering/typeset-output.mjs';
import { loadSkillBundle, resolveSkillFile } from '../../llm/skill-runtime.mjs';

// capability-call: cap_diagram_mermaid_render, cap_diagram_echarts_render

export async function handleMediaRoutes(context) {
  const { request, response, pathname, searchParams, store, config, json, body, path, fs, os, mime, root, execFileAsync, isInsideRoots, getImageWorkspace, getCdnUploadConfiguration, batchArticlesDir, saveLocalImage, uploadImageToCdn, articleWorkdir, models, planImagePlaceholders, writeUtf8, saveImageMetadata, imageManifestFile, aiJobs, planArticleVisuals, analyzeVisualComplexity } = context;
  if (pathname === '/api/external/article/local-audit' && request.method === 'POST') {
    const input = await body(request) || {};
    if (typeof input.article !== 'string' || !input.article.trim() || input.article.length > 1000000) {
      return json(response, 400, { error: '文章正文须为非空字符串，且不超过 100 万字符' });
    }
    return json(response, 200, auditExternalArticleLocally({ article: input.article, factBase: input.factBase || {} }));
  }
  const imageWorkspaceResponse = async (workdir, extras = {}) => {
    const cdn = await getCdnUploadConfiguration();
    return { ...getImageWorkspace(workdir), ...cdn, deliveryMode:cdn.cdnConfigured === true ? 'cdn' : 'local', ...extras };
  };
  const coverStatus = (coverPath) => {
    const imageDir = path.dirname(coverPath);
    const reportPath = path.join(imageDir, 'cover-ai-generation.json');
    const htmlPath = path.join(imageDir, 'ai-cover.html');
    const legacy = { mode: 'legacy', aiVisualFallback: false, aiVisualError: '', aiVisualHtmlAvailable: false };
    if (!fs.existsSync(reportPath) || !fs.existsSync(coverPath)) return legacy;
    try {
      const reportStat = fs.statSync(reportPath);
      const coverStat = fs.statSync(coverPath);
      if (reportStat.mtimeMs < coverStat.mtimeMs) return legacy;
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      const fallback = report.status === 'fallback';
      return {
        mode: report.mode === 'ai-visual' && !fallback ? 'ai-visual' : 'legacy',
        aiVisualFallback: fallback,
        aiVisualError: fallback ? String(report.fallbackReason || '') : '',
        aiVisualHtmlAvailable: fs.existsSync(htmlPath),
      };
    } catch {
      return legacy;
    }
  };
  const dailyImageMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/images$/);
  if (dailyImageMatch && request.method === 'GET') {
    const batch = store.getBatch(decodeURIComponent(dailyImageMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    return json(response, 200, await imageWorkspaceResponse(path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily'), { planned:true }));
  }
  const dailyImageGenerateMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/images\/([^/]+)\/generate$/);
  if (dailyImageGenerateMatch && request.method === 'POST') {
    const batch = store.getBatch(decodeURIComponent(dailyImageGenerateMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    const id = decodeURIComponent(dailyImageGenerateMatch[2]);
    const item = getImageWorkspace(workdir).items.find((entry) => entry.id === id);
    if (!item?.generate) return json(response, 400, { error:'该占位未标记为可生成' });
    try {
      const input = await body(request);
      const { localPath } = await generateArticleImage({ workspaceRoot:root, workdir, slotId:id, generate:item.generate, ratio:item.ratio });
      const updated = registerGeneratedSlotImage(workdir, id, localPath);
      const manifestPath = imageManifestFile(workdir); const stat = fs.statSync(manifestPath);
      store.upsertArtifact({ batchId:batch.id, kind:'配图资产清单', name:path.basename(manifestPath), path:manifestPath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
      return json(response, 200, updated);
    } catch (error) {
      return json(response, 422, { error:`配图生成失败：${error.message}` });
    }
  }
  const dailyImageItemMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/images\/([^/]+)$/);
  if (dailyImageItemMatch && request.method === 'POST') {
    const batch = store.getBatch(decodeURIComponent(dailyImageItemMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    return json(response, 200, saveLocalImage(workdir, decodeURIComponent(dailyImageItemMatch[2]), await body(request)));
  }
  const dailyImageLocalMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/images\/([^/]+)\/local$/);
  if (dailyImageLocalMatch && request.method === 'GET') {
    const batch = store.getBatch(decodeURIComponent(dailyImageLocalMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    const item = getImageWorkspace(workdir).items.find((entry) => entry.id === decodeURIComponent(dailyImageLocalMatch[2]));
    if (!item?.localPath || !isInsideRoots(item.localPath, [workdir]) || !fs.existsSync(item.localPath)) return json(response, 404, { error:'本地图片不存在' });
    response.writeHead(200, { 'content-type':item.mimeType || mime[path.extname(item.localPath)] || 'application/octet-stream', 'cache-control':'no-store' });
    return pipeFile(response,item.localPath);
  }
  const dailyImageCdnMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/images\/([^/]+)\/cdn$/);
  if (dailyImageCdnMatch && request.method === 'POST') {
    const batch = store.getBatch(decodeURIComponent(dailyImageCdnMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    return json(response, 200, await uploadImageToCdn(workdir, decodeURIComponent(dailyImageCdnMatch[2]), {
      authorizedExternalWrite:true,store,batchId:batch.id,skillId:'wechat-article-typeset',
    }));
  }
  const dailyCoverGenerateMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/cover\/generate$/);
  if (dailyCoverGenerateMatch && request.method === 'POST') {
    const batch = store.getBatch(decodeURIComponent(dailyCoverGenerateMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    if (!store.getDocument(batch.id, null, 'daily-final')) return json(response, 409, { error:'缺少早报终稿，请先完成批次早报' });
    const input = await body(request);
    if (input.mode && input.mode !== 'ai-visual') return json(response, 400, { error:'标准封面已停用，封面仅支持 AI 视觉生成' });
    return json(response, 202, aiJobs.start({ batchId:batch.id, candidateId:null, provider:input.provider||null, type:'cover-image', mode:'ai-visual' }));
  }
  const dailyCoverLocalMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/cover\/local$/);
  if (dailyCoverLocalMatch && request.method === 'GET') {
    const batch = store.getBatch(decodeURIComponent(dailyCoverLocalMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    const coverPath = path.join(workdir, 'images', 'cover.png');
    if (!isInsideRoots(coverPath, [workdir]) || !fs.existsSync(coverPath)) return json(response, 404, { error:'封面图不存在' });
    response.writeHead(200, { 'content-type':'image/png', 'cache-control':'no-store' });
    return pipeFile(response,coverPath);
  }
  const dailyCoverHtmlMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/cover\/ai-html$/);
  if (dailyCoverHtmlMatch && request.method === 'GET') {
    const batch = store.getBatch(decodeURIComponent(dailyCoverHtmlMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    const htmlPath = path.join(workdir, 'images', 'ai-cover.html');
    if (!isInsideRoots(htmlPath, [workdir]) || !fs.existsSync(htmlPath)) return json(response, 404, { error:'AI 封面 HTML 不存在' });
    response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:;" });
    return pipeFile(response,htmlPath);
  }
  const dailyCoverMatch = pathname.match(/^\/api\/batches\/([^/]+)\/daily\/cover$/);
  if (dailyCoverMatch && request.method === 'GET') {
    const batch = store.getBatch(decodeURIComponent(dailyCoverMatch[1]));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const workdir = path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily');
    const coverPath = path.join(workdir, 'images', 'cover.png');
    if (!fs.existsSync(coverPath)) return json(response, 200, { exists:false });
    const stat = fs.statSync(coverPath);
    const doc = store.getDocument(batch.id, null, 'daily-final');
    return json(response, 200, { exists:true, size:stat.size, modifiedAt:stat.mtime.toISOString(), title:doc?.title || '批次早报', ...coverStatus(coverPath) });
  }
  const imageWorkspaceMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images$/);
  if (imageWorkspaceMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(imageWorkspaceMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id);
    return json(response, 200, await imageWorkspaceResponse(articleWorkdir(batch, candidate)));
  }
  const imagePlanMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/plan$/);
  if (imagePlanMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(imagePlanMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const finalPath = path.join(workdir, '09-FINAL.md');
    if (!fs.existsSync(finalPath)) return json(response, 409, { error:'缺少 09-FINAL.md，请先完成成稿链' });
    const input = await body(request); const provider = input.provider || models.config.defaultProvider;
    const providerConfig = models.config.providers[provider];
    if (!providerConfig) return json(response, 400, { error:'未知模型服务商' });
    const original = fs.readFileSync(finalPath, 'utf8');
    const harness=createRequestHarnessGateway({gateway:models,store,entryPoint:'article-image-plan',skillId:'article-image-plan',provider,batchId:batch.id,candidateId:candidate.id,stageId:'article-image-plan'});
    let content; try { content=await planImagePlaceholders({ gateway:harness.gateway, store, batchId:batch.id, candidateId:candidate.id,
      provider, markdown:original, maxOutputTokens:Math.min(3000, providerConfig.maxOutputTokens) }); harness.finish('completed'); } catch (error) { harness.finish('failed',error.message); throw error; }
    const file = writeUtf8(finalPath, content);
    const existing = store.listDocuments(batch.id).find((item) => item.candidate_row_id === candidate.id && item.kind === 'final');
    store.saveDocument({ batchId:batch.id, candidateId:candidate.id, kind:'final', title:existing?.title || candidate.hotspot_title,
      content, filePath:finalPath, status:'finalized' });
    store.upsertArtifact({ batchId:batch.id, kind:'文章终稿', name:'09-FINAL.md', path:finalPath, ...file });
    return json(response, 200, await imageWorkspaceResponse(workdir));
  }
  const imageLocalMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/([^/]+)\/local$/);
  if (imageLocalMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(imageLocalMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const id = decodeURIComponent(imageLocalMatch[2]); const item = getImageWorkspace(workdir).items.find((entry) => entry.id === id);
    if (!item?.localPath || !isInsideRoots(item.localPath, [workdir]) || !fs.existsSync(item.localPath)) return json(response, 404, { error:'本地图片不存在' });
    response.writeHead(200, { 'content-type':item.mimeType || mime[path.extname(item.localPath)] || 'application/octet-stream', 'cache-control':'no-store' });
    return pipeFile(response,item.localPath);
  }
  const imageItemMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/([^/]+)$/);
  if (imageItemMatch && ['PUT','POST'].includes(request.method)) {
    const candidate = store.getCandidate(Number(imageItemMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const id = decodeURIComponent(imageItemMatch[2]); const input = await body(request);
    const item = request.method === 'POST' ? saveLocalImage(workdir, id, input) : saveImageMetadata(workdir, id, input);
    const manifestPath = imageManifestFile(workdir); const stat = fs.statSync(manifestPath);
    store.upsertArtifact({ batchId:batch.id, kind:'配图资产清单', name:path.basename(manifestPath), path:manifestPath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
    return json(response, 200, item);
  }
  const imageGenerateMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/([^/]+)\/generate$/);
  if (imageGenerateMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(imageGenerateMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const id = decodeURIComponent(imageGenerateMatch[2]);
    const item = getImageWorkspace(workdir).items.find((entry) => entry.id === id);
    if (!item?.generate) return json(response, 400, { error:'该占位未标记为可生成' });
    try {
      const input = await body(request);
      const { localPath } = await generateArticleImage({ workspaceRoot: root, workdir, slotId: id, generate: item.generate, ratio: item.ratio });
      const updated = registerGeneratedSlotImage(workdir, id, localPath);
      const manifestPath = imageManifestFile(workdir); const stat = fs.statSync(manifestPath);
      store.upsertArtifact({ batchId:batch.id, kind:'配图资产清单', name:path.basename(manifestPath), path:manifestPath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
      return json(response, 200, updated);
    } catch (error) {
      return json(response, 422, { error:`配图生成失败：${error.message}` });
    }
  }
  const coverGenerateMatch = pathname.match(/^\/api\/candidates\/(\d+)\/cover\/generate$/);
  if (coverGenerateMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(coverGenerateMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id);
    if (!store.getDocument(batch.id, candidate.id, 'final')) return json(response, 409, { error:'缺少成稿终稿，请先完成成稿链' });
    const input = await body(request);
    if (input.mode && input.mode !== 'ai-visual') return json(response, 400, { error:'标准封面已停用，封面仅支持 AI 视觉生成' });
    return json(response, 202, aiJobs.start({ batchId:batch.id, candidateId:candidate.id, provider:input.provider||null, type:'cover-image', mode:'ai-visual' }));
  }
  const externalCoverMatch = pathname.match(/^\/api\/candidates\/(\d+)\/cover\/external$/);
  if (externalCoverMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(externalCoverMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id);
    const document = store.getDocument(batch.id, candidate.id, 'final');
    if (!document) return json(response, 409, { error:'缺少成稿终稿，请先完成成稿链' });
    const input = await body(request);
    const html = String(input.html || '');
    if (!html || html.length > 2_000_000) return json(response, 400, { error:'html 必须为非空字符串且不超过 2 MB' });
    if (input.designScheme && Buffer.byteLength(JSON.stringify(input.designScheme)) > 250_000) return json(response,400,{error:'designScheme 不得超过 250 KB'});
    const issues = validateGeneratedCoverHtml(html, document.title || candidate.hotspot_title || '');
    if (issues.length) return json(response, 422, { error:'封面 HTML 未通过门禁', issues });
    const workdir = articleWorkdir(batch, candidate);
    const imageDir = path.join(workdir, 'images');
    const aiHtmlPath = path.join(imageDir, 'ai-cover.html');
    const htmlPath = path.join(imageDir, 'cover.html');
    const pendingHtmlPath = path.join(imageDir, '.external-ai-cover.pending.html');
    fs.mkdirSync(imageDir, { recursive:true });
    writeUtf8(pendingHtmlPath, html);
    try {
      const produced = await renderCover({ workspaceRoot:root, htmlPath:pendingHtmlPath, imageDir });
      const coverPath = path.join(imageDir, 'cover.png');
      fs.renameSync(pendingHtmlPath,aiHtmlPath);
      fs.copyFileSync(aiHtmlPath,htmlPath);
      fs.rmSync(coverPath, { force:true });
      fs.renameSync(produced, coverPath);
      fs.rmSync(path.join(imageDir,'ai-cover-output'),{recursive:true,force:true});
      const stat = fs.statSync(coverPath);
      if (!stat.size) throw new Error('封面截图为空');
      if (input.designScheme && typeof input.designScheme === 'object') writeUtf8(path.join(imageDir,'external-cover-design-scheme.json'),JSON.stringify(input.designScheme,null,2));
      const gatePath=path.join(imageDir,'cover-ai-delivery-gate.json');
      const reportPath=path.join(imageDir,'cover-ai-generation.json');
      writeUtf8(gatePath,JSON.stringify({schemaVersion:1,gate:{status:'passed'},registered:true,source:'external-agent',checkedAt:new Date().toISOString(),checks:{html:{valid:true,issues:[]},image:{valid:true,size:stat.size,width:900,height:383}},artifacts:{html:'ai-cover.html',image:'cover.png'}},null,2));
      writeUtf8(reportPath,JSON.stringify({schemaVersion:1,status:'passed',mode:'ai-visual',source:'external-agent',generatedAt:new Date().toISOString(),title:document.title||candidate.hotspot_title||'',designScheme:input.designScheme||null,artifacts:{html:'ai-cover.html',image:'cover.png',deliveryGate:'cover-ai-delivery-gate.json'}},null,2));
      const files=[['AI 视觉封面 HTML','ai-cover.html',aiHtmlPath],['封面图','cover.png',coverPath],['AI 视觉运行记录','cover-ai-delivery-gate.json',gatePath],['AI 视觉运行记录','cover-ai-generation.json',reportPath]];
      if(input.designScheme&&typeof input.designScheme==='object')files.push(['封面设计方案','external-cover-design-scheme.json',path.join(imageDir,'external-cover-design-scheme.json')]);
      for (const [kind, name, filePath] of files) {
        const artifact = fs.statSync(filePath);
        store.upsertArtifact({ batchId:batch.id,candidateId:candidate.id,track:'article',kind,name,path:filePath,size:artifact.size,modifiedAt:artifact.mtime.toISOString() });
      }
      return json(response, 200, { candidateId:candidate.id, status:'passed', width:900, height:383, html:'ai-cover.html', image:'cover.png', size:stat.size });
    } catch (error) {
      return json(response, 422, { error:`封面渲染失败：${error.message}` });
    } finally { fs.rmSync(pendingHtmlPath,{force:true});fs.rmSync(path.join(imageDir,'ai-cover-output'),{recursive:true,force:true}); }
  }
  const coverLocalMatch = pathname.match(/^\/api\/candidates\/(\d+)\/cover\/local$/);
  if (coverLocalMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(coverLocalMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const coverPath = path.join(workdir, 'images', 'cover.png');
    if (!isInsideRoots(coverPath, [workdir]) || !fs.existsSync(coverPath)) return json(response, 404, { error:'封面图不存在' });
    response.writeHead(200, { 'content-type':'image/png', 'cache-control':'no-store' });
    return pipeFile(response,coverPath);
  }
  const coverHtmlMatch = pathname.match(/^\/api\/candidates\/(\d+)\/cover\/ai-html$/);
  if (coverHtmlMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(coverHtmlMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const htmlPath = path.join(workdir, 'images', 'ai-cover.html');
    if (!isInsideRoots(htmlPath, [workdir]) || !fs.existsSync(htmlPath)) return json(response, 404, { error:'AI 封面 HTML 不存在' });
    response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:;" });
    return pipeFile(response,htmlPath);
  }
  const coverMatch = pathname.match(/^\/api\/candidates\/(\d+)\/cover$/);
  if (coverMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(coverMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const coverPath = path.join(workdir, 'images', 'cover.png');
    if (!fs.existsSync(coverPath)) return json(response, 200, { exists:false });
    const stat = fs.statSync(coverPath);
    const doc = store.getDocument(batch.id, candidate.id, 'final');
    return json(response, 200, { exists:true, size:stat.size, modifiedAt:stat.mtime.toISOString(), title:doc?.title || candidate.hotspot_title || '', ...coverStatus(coverPath) });
  }
  const imageCdnMatch = pathname.match(/^\/api\/candidates\/(\d+)\/images\/([^/]+)\/cdn$/);
  if (imageCdnMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(imageCdnMatch[1]));
    if (!candidate) return json(response, 404, { error:'候选不存在' });
    const batch = store.getBatch(candidate.batch_id); const workdir = articleWorkdir(batch, candidate);
    const item = await uploadImageToCdn(workdir, decodeURIComponent(imageCdnMatch[2]), {
      authorizedExternalWrite:true,store,batchId:batch.id,candidateId:candidate.id,
    });
    const manifestPath = imageManifestFile(workdir); const stat = fs.statSync(manifestPath);
    store.upsertArtifact({ batchId:batch.id, kind:'配图资产清单', name:path.basename(manifestPath), path:manifestPath, size:stat.size, modifiedAt:stat.mtime.toISOString() });
    return json(response, 200, item);
  }
  const typesetMatch = pathname.match(/^\/api\/batches\/([^/]+)\/ai\/typeset$/);
  if (typesetMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(typesetMatch[1]);
    const input = await body(request);
    const requestedMode = String(input.imageDeliveryMode || 'auto');
    if (!['auto', 'cdn', 'local'].includes(requestedMode)) return json(response, 400, { error:'图片排版模式必须是 auto、cdn 或 local' });
    const daily=input.documentKind==='daily-final';
    const candidate = daily?null:store.getCandidate(Number(input.candidateId));
    if ((!daily&&(!candidate||candidate.batch_id!==batchId))||(daily&&!store.getDocument(batchId,null,'daily-final'))) return json(response, 404, { error: '待排版文稿不存在或不属于当前批次' });
    // 排版是用户主动发起的交付动作，应默认读取当前模型/阶段路由。
    // 历史快照会冻结当时的 typeset.design 模型；只有明确要求复用时才恢复，
    // 否则切换模型后再次点击排版仍会被旧模型接管。
    const reusePreviousSnapshot=input.reuseSnapshot===true||input.useLatestSkill===false;
    const previousSnapshot=reusePreviousSnapshot?store.findLatestGenerationSnapshot({
      batchId,candidateId:candidate?.id??null,purposes:['typeset'],
    }):null;
    const cdnConfiguration = await getCdnUploadConfiguration();
    // 排版只依据系统设置中的配置状态决定交付方式；健康检查属于配置流程。
    const imageDeliveryMode = requestedMode === 'local' || cdnConfiguration.cdnConfigured !== true ? 'local' : 'cdn';
    return json(response, 202, aiJobs.start({ batchId, candidateId: candidate?.id??null,documentKind:daily?'daily-final':null,
      provider:previousSnapshot?null:input.provider,type:'typeset',snapshotId:previousSnapshot?.id||null,
      imageDeliveryMode }));
  }
  const documentsMatch = pathname.match(/^\/api\/batches\/([^/]+)\/documents$/);
  if (documentsMatch && request.method === 'GET') {
    const batchId=decodeURIComponent(documentsMatch[1]); const cId=searchParams.get('candidateId'); const kind=searchParams.get('kind'); if(cId&&kind){var doc=store.getDocument(batchId,cId==='daily'?null:Number(cId),kind);if(!doc&&kind==='draft'){var arts=store.listArtifacts({batchId:batchId});var da=arts.find(function(a){return a.kind==='文章初稿'&&a.file_path&&a.file_path.toLowerCase().includes(cId.toLowerCase());});if(da&&fs.existsSync(da.file_path)){doc={title:da.name,content:fs.readFileSync(da.file_path,'utf-8')};}}return json(response,doc?200:404,doc||{error:'文档不存在'});} return json(response,200,store.listDocuments(batchId));
  }
  const visualPlanMatch = pathname.match(/^\/api\/batches\/([^/]+)\/visual-plan$/);
  if (visualPlanMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(visualPlanMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const input = await body(request);
    const daily = input.documentKind === 'daily-final';
    const candidate = daily ? null : store.getCandidate(Number(input.candidateId));
    if (!daily && (!candidate || candidate.batch_id !== batchId)) return json(response, 404, { error:'文章不存在或不属于当前批次' });
    const markdown = String(input.content || '');
    if (!markdown.trim()) return json(response, 400, { error:'文章内容为空' });
    const provider = input.provider || models.config.defaultProvider;
    const providerConfig = models.config.providers[provider];
    if (!providerConfig) return json(response, 400, { error:'未知模型服务商' });
    const workdir = daily ? path.join(batchArticlesDir(config.workspaceRoot, batch), 'daily') : articleWorkdir(batch, candidate);
    const materialBrief = candidate?.editorial?.material_brief && typeof candidate.editorial.material_brief === 'object' ? candidate.editorial.material_brief : {};
    const stanceDecision = deriveWritingStance({ articleType: materialBrief.article_type || (daily ? 'wechat-mp-daily' : ''), materialBrief, editorial: candidate?.editorial || {} });
    const visualDecision = visualPolicyForStance({ stance: stanceDecision.stance, articleType: materialBrief.article_type || (daily ? 'wechat-mp-daily' : '') });
    const factCandidates = daily
      ? ['01-news-items.json']
      : ['02-fact-base.json', '01-tutorial-fact-base.json', 'article-brief.md'];
    const factBase = factCandidates.map((name) => path.join(workdir, name)).find((file) => fs.existsSync(file));
    const harness=createRequestHarnessGateway({gateway:models,store,entryPoint:'article-visual-plan',skillId:'article-visual-plan',provider,batchId,candidateId:candidate?.id??null,stageId:'article-visual-plan'});
    let result; try { result = await planArticleVisuals({
      gateway:harness.gateway, provider, batchId, candidateId:candidate?.id ?? null, markdown,
      factBase:factBase ? fs.readFileSync(factBase, 'utf8') : '',
      preferences:store.visualDecisionStats(),
      maxOutputTokens:Math.min(5000, providerConfig.maxOutputTokens), workspaceRoot:config.workspaceRoot, visualPolicy: visualDecision.policy,
    }); harness.finish('completed'); } catch (error) { harness.finish('failed',error.message); throw error; }
    return json(response, 200, { ...result, writingStance: stanceDecision.stance, visualPolicy: visualDecision.policy });
  }
  if (pathname === '/api/visual-decisions' && request.method === 'POST') {
    const input = await body(request);
    const batch = store.getBatch(String(input.batchId || ''));
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const candidate = input.candidateId ? store.getCandidate(Number(input.candidateId)) : null;
    if (input.candidateId && (!candidate || candidate.batch_id !== batch.id)) return json(response, 404, { error:'文章不存在' });
    return json(response, 200, store.saveVisualDecision({
      batchId:batch.id, candidateId:candidate?.id ?? null, visualType:input.visualType,
      action:input.action, heading:input.heading, purpose:input.purpose,
    }));
  }
  if (pathname === '/api/visual-preview' && request.method === 'POST') {
    const input = await body(request);
    const type = input.type === 'mermaid' || input.type === 'echarts' ? input.type : '';
    const code = String(input.code || '').trim();
    if (!type || !code) return json(response, 400, { error:'图表类型或代码为空' });
    if (type === 'mermaid' && !/^(?:flowchart\s+(?:TB|LR)|sequenceDiagram|stateDiagram-v2)\b/i.test(code)) return json(response, 400, { error:'支持 flowchart、sequenceDiagram 和 stateDiagram-v2' });
    if (type === 'echarts') {
      try { JSON.parse(code); } catch { return json(response, 400, { error:'ECharts 配置必须是严格 JSON' }); }
    }
    const complexity = analyzeVisualComplexity(type, code);
    if (!complexity.mobileReady) return json(response, 422, { error:`移动端复杂度门禁未通过：${complexity.warning}` });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-preview-'));
    try {
      const source = path.join(tempDir, 'input.md');
      const output = path.join(tempDir, 'output.md');
      const imageDir = path.join(tempDir, 'images');
      const tokensPath = path.join(tempDir, 'tokens.json');
      fs.writeFileSync(source, `\`\`\`${type}\n${code}\n\`\`\`\n`, 'utf8');
      fs.writeFileSync(tokensPath, JSON.stringify(input.tokens || {}), 'utf8');
      const rendered = await executeCapability({consumerId:'feature.diagram-preview',capability:`cap_diagram_${String(type).replace(/[^A-Za-z0-9_]/g,'_')}_render`,input:{
        inputPath:source, outputPath:output, imageDir, tokensPath,
      },context:{allowedRoots:[tempDir],cwd:root,timeoutMs:180000,executionLog:createStoreExecutionLogger(store,{skillId:'visual-preview'})}});
      if (rendered.status === 'error') throw new Error(rendered.error.message);
      const imagePath = path.join(imageDir, `${type}-1.png`);
      if (!fs.existsSync(imagePath)) throw new Error('预览图片未生成');
      return json(response, 200, { image:`data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`, complexity });
    } catch (error) {
      return json(response, 422, { error:`图表预览失败：${String(error.stderr || error.stdout || error.message).trim().slice(0, 500)}` });
    } finally {
      fs.rmSync(tempDir, { recursive:true, force:true });
    }
  }
  if (documentsMatch && request.method === 'PUT') {
    const batchId = decodeURIComponent(documentsMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error: '批次不存在' });
    const input = await body(request);
    const candidate = input.candidateId ? store.getCandidate(Number(input.candidateId)) : null;
    if (input.candidateId && !candidate) return json(response, 404, { error: '候选不存在' });
    if (!['draft','final','daily-draft','daily-final'].includes(input.kind)) return json(response, 400, { error: '未知文稿类型' });
    const daily=input.kind.startsWith('daily-');
    if(daily&&candidate)return json(response,400,{error:'批次早报不能关联单选题候选'});
    const fileName = input.kind === 'final' ? '09-FINAL.md' : input.kind === 'draft' ? '04-draft.md' : input.kind === 'daily-final' ? '03-FINAL.md' : '02-draft.md';
    const targetDir = candidate ? articleWorkdir(batch, candidate) : daily ? path.join(batchArticlesDir(config.workspaceRoot,batch),'daily') : batchArticlesDir(config.workspaceRoot, batch);
    const filePath = path.join(targetDir, fileName);
    const file = writeUtf8(filePath, String(input.content ?? ''));
    const document = store.saveDocument({ batchId, candidateId: candidate?.id ?? null, kind: input.kind,
      title: input.title ?? '', content: String(input.content ?? ''), filePath, status: input.status ?? 'draft', reviewState: input.reviewState ?? null });
    store.upsertArtifact({ batchId, kind: input.kind.endsWith('final') ? (daily?'早报终稿':'文章终稿') : (daily?'早报初稿':'文章初稿'), name: fileName, path: filePath, ...file });
    store.updateBatch(batchId, { stage: input.kind.endsWith('final') ? 'review' : 'drafting', status: 'running' });
    return json(response, 200, document);
  }
  const externalTypesetMatch = pathname.match(/^\/api\/batches\/([^/]+)\/external\/typeset$/);
  if (externalTypesetMatch && request.method === 'POST') {
    const batchId = decodeURIComponent(externalTypesetMatch[1]);
    const batch = store.getBatch(batchId);
    if (!batch) return json(response, 404, { error:'批次不存在' });
    const input = await body(request);
    const candidate = store.getCandidate(Number(input.candidateId));
    if (!candidate || candidate.batch_id !== batchId) return json(response, 404, { error:'候选不存在或不属于该批次' });
    const source = store.getDocument(batchId, candidate.id, 'final');
    if (!source) return json(response, 409, { error:'缺少文章终稿；请先保存 Markdown 终稿' });
    const html = String(input.html || '');
    if (!html || html.length > 8_000_000) return json(response, 400, { error:'html 必须为非空字符串且不超过 8 MB' });
    if (input.designScheme && Buffer.byteLength(JSON.stringify(input.designScheme)) > 250_000) return json(response,400,{error:'designScheme 不得超过 250 KB'});
    if (/<script\b|<iframe\b|<object\b|<embed\b|\son[a-z]+\s*=|javascript:|<form\b|@import|<link\b/i.test(html)) return json(response, 422, { error:'HTML 含有脚本、嵌入、表单、事件处理器或外部样式资源' });
    if (!htmlPreservesStructure(source.content, html)) return json(response, 422, { error:'HTML 未完整保留终稿中的标题、章节、链接或图片' });
    const workdir = articleWorkdir(batch, candidate);
    const draftPath = path.join(workdir, 'article.ai.draft.html');
    const finalPath = path.join(workdir, 'article.ai.html');
    writeUtf8(draftPath, html);
    try {
      const normalizer = loadSkillBundle({ workspaceRoot:root, skillName:'wechat-html-normalizer' });
      const checker = loadSkillBundle({ workspaceRoot:root, skillName:'wechat-html-check-no-div' });
      if (normalizer.fallback || checker.fallback) throw new Error('公众号 HTML 规范化或门禁技能不可用');
      const normalizeScript = resolveSkillFile({ workspaceRoot:root, skillName:'wechat-html-normalizer', relativePath:'scripts/normalize-html.mjs' });
      const checkScript = resolveSkillFile({ workspaceRoot:root, skillName:'wechat-html-check-no-div', relativePath:'scripts/check-html.mjs' });
      await execFileAsync(process.execPath, [normalizeScript, draftPath, finalPath], { cwd:root, windowsHide:true, timeout:120_000, maxBuffer:2_000_000 });
      const normalized = fs.readFileSync(finalPath, 'utf8');
      if (!htmlPreservesStructure(source.content, normalized)) throw new Error('规范化后 HTML 未保留文章结构');
      await execFileAsync(process.execPath, [checkScript, finalPath], { cwd:root, windowsHide:true, timeout:120_000, maxBuffer:2_000_000 });
      const stat = fs.statSync(finalPath);
      store.upsertArtifact({ batchId,candidateId:candidate.id,track:'article',kind:'AI 排版 HTML',name:'article.ai.html',path:finalPath,size:stat.size,modifiedAt:stat.mtime.toISOString() });
      const result={ batchId,candidateId:candidate.id,status:'passed',html:'article.ai.html',size:stat.size };
      if(input.designScheme&&typeof input.designScheme==='object'){
        const schemePath=path.join(workdir,'external-typeset-design-scheme.json');
        const schemeFile=writeUtf8(schemePath,JSON.stringify(input.designScheme,null,2));
        store.upsertArtifact({batchId,candidateId:candidate.id,track:'article',kind:'文章排版设计方案',name:path.basename(schemePath),path:schemePath,...schemeFile});
        result.designScheme=path.basename(schemePath);
      }
      return json(response, 200, result);
    } catch (error) {
      fs.rmSync(finalPath, { force:true });
      return json(response, 422, { error:`排版 HTML 未通过规范化或门禁：${String(error.stderr || error.message).trim().slice(0, 1000)}` });
    }
  }
  return false;
}
