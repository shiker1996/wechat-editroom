import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestGitHubJson, getGitHubApiHealth } from '../server/platform/connectors/github-client.mjs';

function response(status,data,headers={}){const value={status,ok:status>=200&&status<300,headers:{get(name){return headers[name.toLowerCase()]??null;}},async json(){return data;},async text(){return JSON.stringify(data);}};value.clone=()=>value;return value;}
test('GitHub REST 使用 ETag 缓存并记录配额',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'github-cache-'));let calls=0;try{const fetchImpl=async()=>{calls+=1;return response(200,{id:1},{etag:'"abc"','x-ratelimit-limit':'5000','x-ratelimit-remaining':'4999','x-ratelimit-reset':'1780000000','x-ratelimit-resource':'core'});};const first=await requestGitHubJson('/repos/o/r',{fetchImpl,token:'token',cacheDir:dir,ttlMs:60000});const second=await requestGitHubJson('/repos/o/r',{fetchImpl,token:'token',cacheDir:dir,ttlMs:60000});assert.deepEqual(first,{id:1});assert.deepEqual(second,{id:1});assert.equal(calls,1);const health=getGitHubApiHealth();assert.equal(health.remaining,4999);assert.equal(health.authenticated,true);assert.ok(health.cacheHits>=1);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('GitHub Search 命中限流时识别状态且不在重试窗口前重打', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600), 'x-ratelimit-resource': 'search' }); };
  await assert.rejects(requestGitHubJson('/search/repositories?q=one', { fetchImpl, token: '' }), (error) => error.code === 'RATE_LIMITED');
  assert.equal(calls, 1);
  assert.equal(getGitHubApiHealth().remaining, 0);
});

test('GitHub REST 对短暂 5xx 执行一次有限重试', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return calls === 1 ? response(503, {}) : response(200, { ok: true }); };
  assert.deepEqual(await requestGitHubJson('/repos/o/r', { fetchImpl, token: '' }), { ok: true });
  assert.equal(calls, 2);
});
