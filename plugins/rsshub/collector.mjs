import fs from 'node:fs';
import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { feedDocumentTitle, parseFeedDocument } from '../shared/feed-normalization.mjs';
import { fetchWithBoundedRetry } from '../shared/source-http.mjs';

export function normalizeRssHubLifecycleConfig(config = {}) {
  const normalizeScript = (value) => {
    const text = String(value ?? '').trim().replace(/(?:&#x20;|\s)+$/gi, '');
    const file = path.win32.basename(text);
    const directory = path.win32.dirname(text);
    if (!['rsshub-start.ps1', 'rsshub-stop.ps1'].includes(file.toLowerCase())) return text;
    if (path.win32.basename(directory).toLowerCase() === 'runtime') return path.win32.join(directory, file);
    return path.win32.join(directory, 'runtime', file);
  };
  return {
    ...config,
    startScript: normalizeScript(config.startScript),
    stopScript: normalizeScript(config.stopScript),
  };
}
function privateIp(address){if(net.isIPv4(address)){const [a,b]=address.split('.').map(Number);return a===10||a===127||a===0||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&[0,2,168].includes(b))||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0)||a>=224;}const value=address.toLowerCase();return !/^[23][0-9a-f]{0,3}:/.test(value)||value.startsWith('2001:db8:');}

export function filterRecentItems(items, config, now = Date.now()) {
  const maxAgeMs = Math.max(1, Number(config.maxAgeHours ?? 168)) * 60 * 60 * 1000;
  const kept = []; const stale = []; const undated = [];
  for (const item of items) {
    const timestamp = Date.parse(item.publishedAt ?? '');
    if (!Number.isFinite(timestamp)) {
      if (config.allowUndated !== false) { kept.push(item); undated.push(item); }
      else stale.push(item);
    } else if (timestamp >= now - maxAgeMs && timestamp <= now + 6 * 60 * 60 * 1000) kept.push(item);
    else stale.push(item);
  }
  return { kept, stale, undated };
}

export function parseFeed(xml, route) {
  return parseFeedDocument(xml, route).items;
}

export function githubTrendingPeriod(route){return String(route).match(/^\/github\/trending\/(daily|weekly|monthly)\//i)?.[1]?.toLowerCase()||null;}
export function normalizeGitHubTrendingItem(item,route){const period=githubTrendingPeriod(route);if(!period)return item;let url;try{url=new URL(item.url);}catch{return item;}if(url.hostname.toLowerCase()!=='github.com')return item;const parts=url.pathname.split('/').filter(Boolean).slice(0,2);if(parts.length<2)return item;const repository=`${parts[0]}/${parts[1].replace(/\.git$/i,'')}`;const labels={daily:'Daily',weekly:'Weekly',monthly:'Monthly'};return {...item,id:`github:${repository.toLowerCase()}`,title:repository,url:`https://github.com/${repository}`,sourceGroup:'github',sourceType:'trending',sourceKey:'github:trending',sourceName:`GitHub Trending · ${labels[period]}`,repository,period,periods:[period],rank:item.rank||null};}

async function probe(url, timeoutMs = 5000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: response.status >= 200 && response.status < 500, status: response.status };
  } catch (error) {
    return { ok: false, error: String(error?.cause?.message || error?.message || error) };
  }
}

async function assertPublicFeedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的 RSS/Atom URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('订阅地址只支持 HTTP 或 HTTPS');
  if (url.username || url.password) throw new Error('订阅地址不能包含账号密码');
  if (['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) throw new Error('不能订阅本机地址');
  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) throw new Error('订阅地址解析到了本机或内网');
  return url;
}

export async function fetchDirectFeed(value, timeoutMs = 60000) {
  let url = await assertPublicFeedUrl(value);
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 60000);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 1000) throw new Error('TIMEOUT: RSS/Atom 请求超过总时间预算');
    const attemptTimeoutMs = Math.max(1000, Math.floor((remainingMs - 250) / 2));
    const response = await fetchWithBoundedRetry(url, {
      redirect: 'manual',
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5', 'user-agent': 'WriteAssistant/1.0 RSS Reader' },
    }, { timeoutMs: attemptTimeoutMs });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`订阅源重定向 ${response.status} 但没有 Location`);
      url = await assertPublicFeedUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`订阅源返回 HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > 12_000_000) throw new Error('订阅源超过 12 MB 安全上限');
    const xml = await response.text();
    if (xml.length > 12_000_000) throw new Error('订阅源超过 12 MB 安全上限');
    const parsed = parseFeedDocument(xml, url.href);
    return { url: url.href, title: feedDocumentTitle(xml, url.hostname), ...parsed };
  }
  throw new Error('订阅源重定向次数过多');
}

export async function testSubscription(config, input) {
  const route = String(input.value || input.route || '').trim();
  if (!route.startsWith('/')) throw new Error('RSSHub 路由必须以 / 开头');
  const response = await fetchWithBoundedRetry(new URL(route, config.baseUrl), {}, { timeoutMs: 10000 });
  const xml = await response.text();
  const parsed = parseFeedDocument(xml, route);
  return { ok: true, title: feedDocumentTitle(xml, route), itemCount: parsed.items.length, duplicateCount: parsed.duplicateCount, droppedCount: parsed.droppedCount, route };
}

function runPowerShell(scriptPath, args = [], timeoutMs = 190000) {
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    throw new Error(`RSSHub 管理脚本不存在：${scriptPath}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`RSSHub 脚本超时：${scriptPath}`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `RSSHub 脚本退出码 ${code}`));
    });
  });
}

export async function ensureStarted(config, onProgress) {
  config = normalizeRssHubLifecycleConfig(config);
  const initialProbe = await probe(config.baseUrl);
  if (initialProbe.ok) return false;
  onProgress('RSSHub 未运行，正在启动本地服务');
  const port=String(new URL(config.baseUrl).port||1200);
  const startArgs = ['-RsshubDir',config.rootDir,'-PidFile',config.pidFile,'-Port',port,'-StartupTimeoutSeconds',String(Math.ceil(config.startupTimeoutMs/1000))];
  if (process.env.WORKBENCH_NODE_PATH) startArgs.push('-NodePath', process.env.WORKBENCH_NODE_PATH);
  await runPowerShell(config.startScript, startArgs, config.startupTimeoutMs + 10000);
  onProgress('RSSHub 启动脚本已确认服务健康，正在验证采集连接');
  const finalProbe = await probe(config.baseUrl);
  if (finalProbe.ok) return true;
  const detail = finalProbe.error ? `（${finalProbe.error}）` : `（HTTP ${finalProbe.status}）`;
  throw new Error(`RSSHub 启动脚本确认服务可用，但采集进程无法访问 ${config.baseUrl}${detail}`);
}

export async function stopRssHub(config) {
  config = normalizeRssHubLifecycleConfig(config);
  const port = String(new URL(config.baseUrl).port || 1200);
  return runPowerShell(config.stopScript, ['-PidFile', config.pidFile, '-Port', port], 30000);
}

function titleOfFeed(xml, fallback) {
  return feedDocumentTitle(xml, fallback);
}

function withoutLimit(value) {
  return String(value).replace(/([?&])limit=\d+(?:&|$)/i, '$1').replace(/[?&]$/, '');
}

export function collectionScopeAllows(scope, target) {
  const group=target?.kind==='route'&&githubTrendingPeriod(String(target.value))?'github':'rsshub';
  return !scope||scope==='all'||scope===group;
}

async function mapConcurrent(items, limit, worker) {
  const results=new Array(items.length); let cursor=0;
  async function run() {
    while(cursor<items.length) { const index=cursor++; results[index]=await worker(items[index],index); }
  }
  await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length)},()=>run()));
  return results;
}

export async function collectRssHub(config, onProgress = () => {}, onSourceResult = () => {}) {
  config = normalizeRssHubLifecycleConfig(config);
  let startedHere = false;
  try {
    const disabled = new Set(config.disabledRoutes ?? []);
    const activeRoutes = (config.routes ?? []).filter((route) => !disabled.has(route));
    const targets=activeRoutes.map((value)=>({kind:'route',value})).filter((target)=>collectionScopeAllows(config.collectionScope,target));
    if (targets.length) startedHere = await ensureStarted(config, onProgress);
    const results=await mapConcurrent(targets,Number(config.concurrency||5),async(target)=>{
      const startedAt=new Date().toISOString(); const started=Date.now();
      let sourceType='rsshub',sourceKey='',sourceName='',items=[];
      try {
        if(target.kind==='route') {
          const configuredRoute=target.value;
          const route=configuredRoute.includes('limit=')?configuredRoute:`${configuredRoute}${configuredRoute.includes('?')?'&':'?'}limit=30`;
          const identity=withoutLimit(configuredRoute); sourceType=/^\/twitter\/user\//i.test(identity)?'twitter':'rsshub';
          sourceKey=`${sourceType}:${identity}`; sourceName=identity;
          onProgress(`正在读取 RSSHub ${route}`);
          // 抓取型路由（anthropic、readhub、latepost 等）需要 RSSHub 回源抓上游页面，
          // 冷缓存时经常超过 30s：超时放宽到 90s，超时后自动重试一次（此时 RSSHub 缓存通常已预热）。
          const routeTimeoutMs = Number(config.routeTimeoutMs) || 90000;
          const response = await fetchWithBoundedRetry(new URL(route, config.baseUrl), {}, { timeoutMs: Math.max(1000, Math.floor((routeTimeoutMs - 250) / 2)) });
          const xml=await response.text(); sourceName=titleOfFeed(xml,identity);
          const parsed = parseFeedDocument(xml, route);
          if (parsed.duplicateCount) onProgress(`${sourceName} 已去重 ${parsed.duplicateCount} 条重复链接`);
          if (parsed.droppedCount) onProgress(`${sourceName} 已忽略 ${parsed.droppedCount} 条缺少有效标题或链接的条目`);
          const filtered=filterRecentItems(parsed.items.slice(0,30),config); items=filtered.kept.map((item)=>normalizeGitHubTrendingItem(item,identity));
          if(filtered.stale.length)onProgress(`${sourceName} 已忽略 ${filtered.stale.length} 条过期或未来时间异常内容`);
          if(filtered.undated.length)onProgress(`${sourceName} 有 ${filtered.undated.length} 条缺少有效发布时间`);
          const trendingPeriod=githubTrendingPeriod(identity);if(trendingPeriod){sourceType='trending';sourceKey=`github:trending:${trendingPeriod}`;sourceName=`GitHub Trending · ${trendingPeriod[0].toUpperCase()+trendingPeriod.slice(1)}`;}
          items=items.map((item)=>trendingPeriod?item:({...item,sourceKey,sourceType,sourceName}));
        } else {
          const feedConfig=target.value; sourceType='direct';sourceKey=`direct:${feedConfig.url}`;sourceName=feedConfig.label||feedConfig.url;
          onProgress(`正在读取直连 RSS ${sourceName}`);
          const feed=await fetchDirectFeed(feedConfig.url); sourceName=feedConfig.label||feed.title;
          const filtered=filterRecentItems(feed.items.slice(0,30),config);items=filtered.kept;
          if(filtered.stale.length)onProgress(`${sourceName} 已忽略 ${filtered.stale.length} 条过期内容`);
          if(filtered.undated.length)onProgress(`${sourceName} 有 ${filtered.undated.length} 条缺少有效发布时间`);
          if (!filtered.kept.length) onProgress(`${sourceName} 本次没有可用的新条目`);
          if (feed.duplicateCount) onProgress(`${sourceName} 已去重 ${feed.duplicateCount} 条重复链接`);
          if (feed.droppedCount) onProgress(`${sourceName} 已忽略 ${feed.droppedCount} 条缺少有效标题或链接的条目`);
          items=items.map((item)=>({...item,route:feedConfig.url,feedLabel:sourceName,sourceKey,sourceType,sourceName}));
        }
        onSourceResult({sourceGroup:githubTrendingPeriod(String(target.value))?'github':'rsshub',sourceType,sourceKey,sourceName,status:'success',itemCount:items.length,durationMs:Date.now()-started,startedAt,endedAt:new Date().toISOString()});
        return {ok:true,items};
      } catch(error) {
        onProgress(`${sourceName||sourceKey||'RSS 来源'} 读取失败，已跳过：${error.message}`);
        onSourceResult({sourceGroup:githubTrendingPeriod(String(target.value))?'github':'rsshub',sourceType,sourceKey:sourceKey||`${sourceType}:${String(target.value?.url||target.value)}`,sourceName:sourceName||String(target.value?.label||target.value?.url||target.value),status:'failed',itemCount:0,durationMs:Date.now()-started,error:error.message,startedAt,endedAt:new Date().toISOString()});
        return {ok:false,items:[]};
      }
    });
    const successfulSources=results.filter((result)=>result.ok).length;
    const rawItems=results.flatMap((result)=>result.items);const github=new Map();const allItems=[];for(const item of rawItems){if(item.sourceGroup!=='github'){allItems.push(item);continue;}const key=item.repository.toLowerCase();const existing=github.get(key);if(!existing){github.set(key,item);continue;}existing.periods=[...new Set([...(existing.periods||[]),...(item.periods||[])])];existing.periodRanks={...(existing.periodRanks||{[existing.period]:existing.rank}),[item.period]:item.rank};existing.sourceName=`GitHub Trending · ${existing.periods.map((period)=>period[0].toUpperCase()+period.slice(1)).join(' / ')}`;}allItems.push(...github.values().map((item)=>({...item,periodRanks:item.periodRanks||{[item.period]:item.rank}})));
    if (targets.length && successfulSources === 0) throw new Error('所有 RSS 来源均未返回有效条目');
    return allItems;
  } finally {
    if (startedHere && !config.keepAlive) {
      onProgress('采集完成，正在停止本次启动的 RSSHub');
      const port=String(new URL(config.baseUrl).port||1200);
      try { await runPowerShell(config.stopScript, ['-PidFile',config.pidFile,'-Port',port], 30000); } catch (error) {
        onProgress(`RSSHub 停止失败，需要人工检查：${error.message}`);
      }
    }
  }
}

export async function checkRssHub(config) {
  const result = await probe(config.baseUrl);
  return { ...result, baseUrl: config.baseUrl };
}
