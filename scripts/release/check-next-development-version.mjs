import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const parseStableVersion = (value) => {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
};
const compareVersions = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
};

const tags = execFileSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .map((tag) => ({ tag, version: parseStableVersion(tag) }))
  .filter((item) => item.version)
  .sort((left, right) => compareVersions(right.version, left.version));
if (!tags.length) throw new Error('No stable release tags found; cannot validate the next development version.');

const [major, minor, patch] = tags[0].version;
const expected = `${major}.${minor}.${patch + 1}`;
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const rootPackage = readJson('package.json');
const lockfile = readJson('package-lock.json');
const dshPackage = readJson('agent-integrations/dsh-workbench/package.json');
const versions = {
  'package.json': rootPackage.version,
  'package-lock.json': lockfile.version,
  'package-lock.json packages[""]': lockfile.packages?.['']?.version,
  'agent-integrations/dsh-workbench/package.json': dshPackage.version,
};
const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
if (mismatches.length) {
  const details = mismatches.map(([file, version]) => `- ${file}: ${version || '(missing)'}`).join('\n');
  throw new Error(`Version manifests must be set to ${expected}, the patch version after latest release tag ${tags[0].tag}.\n${details}`);
}
console.log(`Version manifests match next development version ${expected} after release ${tags[0].tag}.`);
