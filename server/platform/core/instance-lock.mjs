import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function processAlive(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}

function processStartedAt(pid){
  try {
    if(process.platform==='win32'){
      const command=`$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){[Console]::Out.Write($p.StartTime.ToUniversalTime().ToString('o'))}`;
      const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:3000,windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
      const timestamp=Date.parse(output);
      return Number.isFinite(timestamp)?timestamp:null;
    }
    const output=execFileSync('ps',['-o','lstart=','-p',String(pid)],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']}).trim();
    const timestamp=Date.parse(output);
    return Number.isFinite(timestamp)?timestamp:null;
  } catch { return null; }
}

function ownerProcessAlive(owner){
  const pid=Number(owner?.pid);
  if(!Number.isInteger(pid)||pid<=0)return false;
  if(pid===process.pid)return true;
  if(!processAlive(pid))return false;

  const lockStartedAt=Date.parse(owner?.startedAt??'');
  if(!Number.isFinite(lockStartedAt))return true;
  const actualStartedAt=processStartedAt(pid);
  // If inspection is unavailable, preserve the lock rather than risk allowing
  // a second workbench instance to mutate the same workspace.
  if(!Number.isFinite(actualStartedAt))return true;
  // The lock is written after its owning process starts. A later process start
  // therefore means Windows (or the OS) has reused the PID from a stale lock.
  return actualStartedAt<=lockStartedAt+2000;
}

export function acquireInstanceLock(root,{name='workbench'}={}){
  const file=path.join(root,'data',`${name}.lock`);fs.mkdirSync(path.dirname(file),{recursive:true});
  for(let attempt=0;attempt<2;attempt+=1){
    try{const fd=fs.openSync(file,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));fs.closeSync(fd);let released=false;return {file,release(){if(released)return;released=true;try{const owner=JSON.parse(fs.readFileSync(file,'utf8'));if(owner.pid===process.pid)fs.unlinkSync(file);}catch{}}};}
    catch(error){if(error.code!=='EEXIST')throw error;let owner={};try{owner=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}if(ownerProcessAlive(owner))throw Object.assign(new Error(`工作台已有实例运行（PID ${owner.pid}）`),{code:'INSTANCE_ALREADY_RUNNING'});try{fs.unlinkSync(file);}catch{} }
  }
  throw new Error('无法取得工作台实例锁');
}
