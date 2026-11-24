import path from 'node:path';import { discoverGitHubRepositories } from './collector.mjs';import { ok } from './result.mjs';
export function createAdapter({config,onProgress=()=>{},githubQueries=[],configuration={},github:githubService}={}){
  const github={...config.githubDiscovery,...configuration};
  const request=githubService?.requestGitHubJson;
  return {
    test:async()=>{
      if(typeof request!=='function')throw new Error('DEPENDENCY_MISSING: GitHub 宿主服务未注入');
      const result=await request('/search/repositories?q=stars%3A%3E%3D1&sort=stars&order=desc&per_page=1',{token:github.token??process.env.GITHUB_ACCESS_TOKEN,ttlMs:0});
      return {ok:true,title:'GitHub Search',itemCount:Array.isArray(result?.items)?result.items.length:0,authenticated:Boolean(github.token??process.env.GITHUB_ACCESS_TOKEN)};
    },
    collect:async(source)=>ok(await discoverGitHubRepositories([],{...github,...source,requestGitHubJson:request,searchEnabled:github.enabled,aiQueries:githubQueries,cacheDir:path.join(config.workspaceRoot,'data','github-cache')},onProgress),{fetchMethod:'github-api'}),
  };
}
