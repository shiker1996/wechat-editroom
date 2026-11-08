import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid release version: ${version || '(empty)'}`);
}

const files = ['package.json', 'package-lock.json', 'agent-integrations/dsh-workbench/package.json'];
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzi-release-master-'));
const masterWorktree = path.join(tempRoot, 'master');
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'inherit' });

try {
  git(['fetch', 'origin', 'master'], root);
  git(['worktree', 'add', '-B', 'master', masterWorktree, 'origin/master'], root);
  for (const file of files) fs.copyFileSync(path.join(root, file), path.join(masterWorktree, file));
  git(['config', 'user.name', 'github-actions[bot]'], masterWorktree);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], masterWorktree);
  git(['add', '--', ...files], masterWorktree);

  let hasChanges = true;
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: masterWorktree, stdio: 'ignore' });
    hasChanges = false;
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (hasChanges) {
    git(['commit', '-m', `chore(release): sync package versions to ${version}`], masterWorktree);
    git(['push', 'origin', 'master'], masterWorktree);
    console.log(`Synced release version ${version} to master.`);
  } else {
    console.log(`Master already contains release version ${version}.`);
  }
} finally {
  try { git(['worktree', 'remove', '--force', masterWorktree], root); } catch {}
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
