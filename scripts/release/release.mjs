// 发布打包：git archive 当前 HEAD → dist/<name>-<version>.zip，并生成 SHA256SUMS.txt。
// 完整发布、升级、降级与备份恢复流程见 docs/release.md。
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'), 'utf8'));
const releaseVersion = process.env.RELEASE_VERSION || pkg.version;
if(pkg.version!==releaseVersion)throw new Error(`工作区版本 ${pkg.version} 与本次发布版本 ${releaseVersion} 不一致，拒绝发布`);

const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty && !process.env.RELEASE_VERSION) throw new Error('工作区存在未提交改动；请先提交改动，或由 tag 构建提供 RELEASE_VERSION。');

const distDir = path.resolve(root,'dist');
if(path.dirname(distDir)!==root)throw new Error('dist 路径越界');
if(fs.existsSync(distDir))for(const name of fs.readdirSync(distDir))fs.rmSync(path.join(distDir,name),{recursive:true,force:true});
else fs.mkdirSync(distDir, { recursive: true });

const base = `${pkg.name}-${releaseVersion}`;
const zipPath = path.join(distDir, `${base}.zip`);
let archiveRef = 'HEAD';
if (process.env.RELEASE_VERSION) {
  const indexPath = path.join(os.tmpdir(), `jianzi-release-index-${process.pid}`);
  const gitEnv = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    execFileSync('git', ['read-tree', 'HEAD'], { stdio: 'inherit', env: gitEnv, cwd: root });
    execFileSync('git', ['add', '--', 'package.json', 'package-lock.json', 'agent-integrations/dsh-workbench/package.json'], { stdio: 'inherit', env: gitEnv, cwd: root });
    archiveRef = execFileSync('git', ['write-tree'], { encoding: 'utf8', env: gitEnv, cwd: root }).trim();
  } finally {
    fs.rmSync(indexPath, { force: true });
  }
}
execFileSync('git', ['archive', '--format=zip', '-o', zipPath, archiveRef], { stdio: 'inherit' });

const dshPluginDir = path.join(root, 'agent-integrations', 'dsh-workbench');
const node = process.execPath;
execFileSync(node, [path.join(dshPluginDir, 'build.mjs')], { stdio: 'inherit', cwd: root });
execFileSync(node, [path.join(root, 'scripts', 'release', 'pack-dsh-plugin.mjs'), distDir], { stdio: 'inherit', cwd: root });

const sum = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
const artifacts=fs.readdirSync(distDir).filter((name)=>name!=='SHA256SUMS.txt'&&fs.statSync(path.join(distDir,name)).isFile()).sort();
const sums=artifacts.map((name)=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(distDir,name))).digest('hex')}  ${name}`).join('\n');
const sumsPath = path.join(distDir, 'SHA256SUMS.txt');
fs.writeFileSync(sumsPath, `${sums}\n`);

console.log(`发布包：${zipPath}`);
console.log(`校验和：${sumsPath}`);
console.log(`sha256(${base}.zip) = ${sum}`);
