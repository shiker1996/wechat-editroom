import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { privateIp } from './network-safety.mjs';

function fail(code,message){process.stderr.write(`${JSON.stringify({code,message})}\n`);process.exit(1);}
let config;try{config=JSON.parse(Buffer.from(process.argv[2]||'','base64url').toString('utf8'));}catch{fail('INVALID_SOURCE_CONFIG','浏览器配置无效');}
let puppeteer;try{puppeteer=(await import('puppeteer')).default;}catch{fail('DEPENDENCY_MISSING','未安装 Puppeteer 浏览器依赖');}
const publicHost=async(host)=>{const addresses=await dns.lookup(host,{all:true,verbatim:true});if(!addresses.length||addresses.some((item)=>privateIp(item.address)))throw new Error('浏览器请求解析到内网或保留地址');};
const chromeCandidates=[process.env.PUPPETEER_EXECUTABLE_PATH,process.env.ProgramFiles&&path.join(process.env.ProgramFiles,'Google','Chrome','Application','chrome.exe'),process.env['ProgramFiles(x86)']&&path.join(process.env['ProgramFiles(x86)'],'Google','Chrome','Application','chrome.exe'),process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Google','Chrome','Application','chrome.exe')].filter(Boolean);
const executablePath=chromeCandidates.find((item)=>fs.existsSync(item));if(executablePath)puppeteer.configuration.executablePath=executablePath;
const blockedPattern=/captcha|verify you are human|access denied|robot check|安全验证|人机验证/i;
let browser;
try{
  browser=await puppeteer.launch({headless:config.interactiveFallback?false:'new',userDataDir:config.profileDir,args:['--no-sandbox','--disable-setuid-sandbox','--disable-background-networking','--disable-sync','--disable-extensions']});
  const page=await browser.newPage();
  if(config.captureMode)await page.setViewport({...config.viewport,deviceScaleFactor:1});
  await page.setRequestInterception(true);
  page.on('request',async(request)=>{try{const url=new URL(request.url());if(!['http:','https:'].includes(url.protocol))return request.abort();await publicHost(url.hostname);request.continue();}catch{request.abort();}});
  const response=await page.goto(config.url,{waitUntil:'domcontentloaded',timeout:30000});if(!response)throw new Error('页面没有导航响应');
  if(config.captureMode&&[401,403,429].includes(response.status())&&!config.interactiveFallback)throw Object.assign(new Error(`来源页返回 HTTP ${response.status()}`),{code:'BROWSER_BLOCKED'});
  if(config.captureMode){
    const isBlocked=async()=>(!config.interactiveFallback&&[401,403,429].includes(response.status()))||blockedPattern.test(`${await page.title()} ${(await page.evaluate(()=>document.body?.innerText||document.body?.textContent||'').catch(()=>'' )).slice(0,800)}`);
    if(await isBlocked()){
      if(!config.interactiveFallback)throw Object.assign(new Error('页面要求验证码或人工验证'),{code:'BROWSER_BLOCKED'});
      process.stderr.write(`${JSON.stringify({code:'USER_ACTION_REQUIRED',message:'请在已打开的配图 Chrome 中完成网站要求的人工验证；页面通过验证后会自动截图。'})}\n`);
      const deadline=Date.now()+85000;while(Date.now()<deadline&&await isBlocked())await new Promise((resolve)=>setTimeout(resolve,1000));
      if(await isBlocked())throw Object.assign(new Error('仍检测到验证码或人工验证，请处理后重试'),{code:'BROWSER_BLOCKED'});
    }
    if(config.selector)await page.waitForSelector(config.selector,{timeout:12000});else await new Promise((resolve)=>setTimeout(resolve,800));
    const title=await page.title();
    const target=config.selector?await page.$(config.selector):null;
    if(config.selector&&!target)throw Object.assign(new Error('截图选择器未匹配到页面元素'),{code:'SELECTOR_MISMATCH'});
    const bytes=await (config.fullPage&&!config.selector?page.screenshot({type:'png',fullPage:true}):target?target.screenshot({type:'png'}):page.screenshot({type:'png'}));
    if(bytes.length>8*1024*1024)throw Object.assign(new Error('截图超过 8MB'),{code:'IMAGE_TOO_LARGE'});
    process.stdout.write(JSON.stringify({status:'ok',base64:Buffer.from(bytes).toString('base64'),url:page.url(),title,provenance:{fetchMethod:config.interactiveFallback?'visible-chrome-fallback':'isolated-browser'}}));
  }else if(config.analysisMode){
    await new Promise((resolve)=>setTimeout(resolve,Math.min(5000,Math.max(500,Number(config.analysisWaitMs)||2500))));
    const html=await page.content();if(Buffer.byteLength(html)>2_000_000)fail('PAGE_TOO_LARGE','渲染后的页面超过 2MB');
    process.stdout.write(JSON.stringify({status:'ok',html,url:page.url(),title:await page.title(),provenance:{fetchMethod:'isolated-browser-analysis',profileId:config.profileId}}));
  }else{
    if(config.waitForSelector)await page.waitForSelector(config.waitForSelector,{timeout:15000});
    for(const action of config.actions||[]){if(action.type==='click')await page.click(action.selector);if(action.type==='type')await page.type(action.selector,action.value);if(action.type==='wait')await new Promise((resolve)=>setTimeout(resolve,action.milliseconds));}
    if(config.loginSelector&&await page.$(config.loginSelector))fail('AUTH_REQUIRED',`检测到登录页面元素：${config.loginSelector}`);
    const result=await page.evaluate((cfg)=>{const text=(root,selector)=>selector?(root.querySelector(selector)?.textContent||'').replace(/\s+/g,' ').trim():'';const nodes=[...document.querySelectorAll(cfg.itemSelector)];const items=nodes.map((node)=>{const link=cfg.linkSelector?node.querySelector(cfg.linkSelector):node;const href=link?.getAttribute(cfg.linkAttribute||'href')||'';return {title:text(node,cfg.titleSelector),url:href?new URL(href,location.href).href:'',summary:text(node,cfg.summarySelector),author:text(node,cfg.authorSelector),publishedAt:cfg.dateSelector?(node.querySelector(cfg.dateSelector)?.getAttribute(cfg.dateAttribute||'datetime')||''):null};}).filter((item)=>item.title&&item.url);return {matched:nodes.length,items};},config);
    if(!result.matched||!result.items.length)fail('SELECTOR_MISMATCH','浏览器页面选择器未提取到有效结果');
    process.stdout.write(JSON.stringify({status:'ok',items:[...new Map(result.items.map((item)=>[item.url,item])).values()].slice(0,config.limit||30),warnings:[],provenance:{fetchMethod:'isolated-browser',matched:result.matched,profileId:config.profileId}}));
  }
}catch(error){process.stderr.write(`${JSON.stringify({code:error.code||(/login|sign.?in|unauthorized/i.test(error.message)?'AUTH_REQUIRED':'NETWORK_ERROR'),message:error.message})}\n`);process.exitCode=1;}finally{await browser?.close().catch(()=>{});}
