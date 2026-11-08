import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read=(file)=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');

test('R6 构建扫描真实插件目录且不依赖旧根 collectors',()=>{
  const source=read('scripts/build/build.mjs');
  assert.match(source,/walk\(path\.join\(root, "plugins"\)\)/);
  assert.doesNotMatch(source,/walk\(path\.join\(root, "collectors"\)\)/);
});

test('R6 发布脚本清理受限 dist 并覆盖全部发布物校验和',()=>{
  const source=read('scripts/release/release.mjs');
  assert.match(source,/path\.resolve\(root,'dist'\)/);
  assert.match(source,/path\.dirname\(distDir\)!==root/);
  assert.match(source,/GIT_INDEX_FILE/);
  assert.match(source,/if \(dirty && !process\.env\.RELEASE_VERSION\)/);
  assert.match(source,/const artifacts=fs\.readdirSync\(distDir\)/);
  assert.match(source,/dsh-workbench/);
  assert.match(source,/pack-dsh-plugin\.mjs/);
  assert.match(read('.github/workflows/desktop-release.yml'),/dist\/\*\.tgz/);
  assert.match(read('.github/workflows/desktop-release.yml'),/sync-release-version-to-master\.mjs/);
  assert.match(read('scripts/release/pack-dsh-plugin.mjs'),/stagedPackage\.version = appPackage\.version/);
  assert.match(read('.github/workflows/publish-dsh-plugin.yml'),/prepare-release-version\.mjs/);
  assert.match(read('.github/workflows/publish-dsh-plugin.yml'),/"\[0-9\]\*"/);
  assert.match(read('.github/workflows/publish-dsh-plugin.yml'),/npm view "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}" version/);
  assert.match(read('scripts/release/prepare-release-version.mjs'),/updatePackage\('package\.json'\)/);
  assert.match(read('scripts/release/prepare-release-version.mjs'),/updatePackage\('package-lock\.json', \{ lockfile: true \}\)/);
});

test('R6 安全支持版本、所有权和威胁模型路径已更新',()=>{
  assert.match(read('SECURITY.md'),/当前为 `0\.5\.x`/);
  const owners=read('.github/CODEOWNERS');
  assert.match(owners,/\/plugins\/rsshub\//);
  assert.match(owners,/\/server\/platform\/agent\//);
  assert.doesNotMatch(owners,/\/collectors\/rsshub\.mjs/);
  const threat=read('docs/threat-model.md');
  assert.match(threat,/plugins\/local-project-reader\/implementation\.mjs/);
  assert.match(threat,/plugins\/rsshub\/collector\.mjs/);
});
