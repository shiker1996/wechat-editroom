import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let health={status:'idle',authenticated:false,limit:null,remaining:null,resetAt:'',resource:'core',retryAfter:null,lastRequestAt:'',lastError:'',cacheHits:0,networkRequests:0};
function header(response,name){return response.headers?.get?.(name)??null;}
function updateHealth(response,authenticated){const reset=Number(header(response,'x-ratelimit-reset'));health={...health,status:response.ok||response.status===304?'ok':'degraded',authenticated,limit:Number(header(response,'x-ratelimit-limit'))||health.limit,remaining:Number(header(response,'x-ratelimit-remaining'))||0,resetAt:Number.isFinite(reset)&&reset>0?new Date(reset*1000).toISOString():health.resetAt,resource:header(response,'x-ratelimit-resource')||health.resource,retryAfter:Number(header(response,'retry-after'))||null,lastRequestAt:new Date().toISOString(),lastError:response.ok||response.status===304?'':`HTTP ${response.status}`,networkRequests:health.networkRequests+1};}
function cacheFile(cacheDir,apiPath){return path.join(cacheDir,`${crypto.createHash('sha256').update(apiPath).digest('hex')}.json`);}
function readCache(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function writeCache(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;fs.writeFileSync(temp,JSON.stringify(value),'utf8');fs.renameSync(temp,file);}
const delay=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
function githubError(response,detail=''){
  const status=Number(response?.status||0),remaining=header(response,'x-ratelimit-remaining'),retryAfter=Number(header(response,'retry-after')||0);
  const limited=status===429||(status===403&&(remaining==='0'||/rate.?limit|secondary rate/i.test(detail)));
  const code=status===401?'AUTH_REQUIRED':limited?'RATE_LIMITED':status===403?'BLOCKED':status>=500?'NETWORK_ERROR':'BLOCKED';
  const error=new Error(`${code}: GitHub API HTTP ${status||'network error'}`);error.code=code;error.retryable=code==='RATE_LIMITED'||code==='NETWORK_ERROR';error.retryAfter=retryAfter;return error;
}
function githubApiBaseUrl(){
  const configured=String(process.env.WORKBENCH_GITHUB_API_BASE_URL||process.env.GITHUB_API_BASE_URL||'https://api.github.com').trim();
  return configured.replace(/\/+$/,'');
}

export async function requestGitHubJson(apiPath,{fetchImpl=fetch,token=process.env.GITHUB_ACCESS_TOKEN,cacheDir=null,ttlMs=15*60*1000,optional=false}={}){
  const authenticated=Boolean(token);const file=cacheDir?cacheFile(cacheDir,apiPath):null;const cached=file?readCache(file):null;
  if(cached&&Date.now()-Date.parse(cached.fetchedAt)<ttlMs){health={...health,status:'ok',authenticated,cacheHits:health.cacheHits+1};return cached.data;}
  const headers={'accept':'application/vnd.github+json','user-agent':'write-assistant/0.1','x-github-api-version':'2022-11-28'};if(token)headers.authorization=`Bearer ${token}`;if(cached?.etag)headers['if-none-match']=cached.etag;
  let lastError;
  for(let attempt=0;attempt<2;attempt+=1){
    let response;
    try{response=await fetchImpl(`${githubApiBaseUrl()}${apiPath}`,{headers,signal:AbortSignal.timeout(15000)});}
    catch(error){
      lastError=new Error(/timeout|aborted/i.test(String(error?.name||'')+' '+String(error?.message||error))?'TIMEOUT: GitHub API 请求超时':'NETWORK_ERROR: GitHub API 网络请求失败');
      lastError.code=lastError.message.split(':')[0];lastError.retryable=true;
      if(attempt===0){await delay(300);continue;}
      break;
    }
    updateHealth(response,authenticated);
    if(response.status===304&&cached){health.cacheHits+=1;writeCache(file,{...cached,fetchedAt:new Date().toISOString()});return cached.data;}
    if(optional&&response.status===404)return null;
    if(response.ok){const data=await response.json();if(file)writeCache(file,{etag:header(response,'etag')||'',fetchedAt:new Date().toISOString(),data});return data;}
    const detail=response.status===403?await response.clone().text().catch(()=> ''):'';
    lastError=githubError(response,detail);
    const retryAfter=lastError.retryAfter;
    if(attempt===0&&response.status>=500){await delay(300);continue;}
    if(attempt===0&&lastError.code==='RATE_LIMITED'&&retryAfter>0&&retryAfter<=2){await delay(retryAfter*1000);continue;}
    break;
  }
  health={...health,status:'failed',lastError:lastError?.message||'NETWORK_ERROR: GitHub API 请求失败'};
  if(lastError&&cached){health={...health,status:'degraded',cacheHits:health.cacheHits+1};return cached.data;}
  throw lastError;
}

export function getGitHubApiHealth(){return {...health};}
