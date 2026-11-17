import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rawVersion = process.argv[2];
const version = rawVersion?.replace(/^dsh-plugin-v/, '');
const match = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) throw new Error(`Expected a stable release version/tag, got: ${rawVersion || '(empty)'}`);
const nextVersion = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;

function updatePackage(file, { lockfile = false } = {}) {
  const absolutePath = path.join(root, file);
  let source = fs.readFileSync(absolutePath, 'utf8');
  const setFirstVersion = (text) => text.replace(/("version"\s*:\s*")[^"]+("\s*[,}])/, (_match, prefix, suffix) => `${prefix}${nextVersion}${suffix}`);
  source = setFirstVersion(source);
  if (lockfile) {
    const rootPackage = /(\"packages\"\s*:\s*\{\s*\"\"\s*:\s*\{[\s\S]*?)(\"version\"\s*:\s*\")[^\"]+(\"\s*[,}])/;
    source = source.replace(rootPackage, (_match, prefix, versionPrefix, suffix) => `${prefix}${versionPrefix}${nextVersion}${suffix}`);
  }
  JSON.parse(source);
  fs.writeFileSync(absolutePath, source);
}

updatePackage('package.json');
updatePackage('package-lock.json', { lockfile: true });
updatePackage('agent-integrations/dsh-workbench/package.json');
console.log(`Prepared next development version ${nextVersion} after release ${version}`);
