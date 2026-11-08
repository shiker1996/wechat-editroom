import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDir = path.join(root, 'agent-integrations', 'dsh-workbench');
const appPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const pluginPackage = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
const outputDir = path.resolve(process.cwd(), process.argv[2] || path.join(root, 'dist'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzi-dsh-plugin-'));
const stagedDir = path.join(tempRoot, pluginPackage.name);

try {
  fs.cpSync(sourceDir, stagedDir, {
    recursive: true,
    filter: (source) => !['node_modules', 'artifacts'].includes(path.basename(source)),
  });
  const stagedPackagePath = path.join(stagedDir, 'package.json');
  const stagedPackage = JSON.parse(fs.readFileSync(stagedPackagePath, 'utf8'));
  stagedPackage.version = appPackage.version;
  fs.writeFileSync(stagedPackagePath, `${JSON.stringify(stagedPackage, null, 2)}\n`);
  fs.mkdirSync(outputDir, { recursive: true });

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['pack', stagedDir, '--pack-destination', outputDir], {
    stdio: 'inherit', cwd: root, shell: process.platform === 'win32',
  });
  const tarball = path.join(outputDir, `${pluginPackage.name}-${appPackage.version}.tgz`);
  if (!fs.existsSync(tarball)) throw new Error(`DSH plugin tarball was not created: ${tarball}`);
  console.log(`DSH 插件包：${tarball}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
