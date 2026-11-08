import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rawVersion = process.argv[2];
const version = rawVersion?.replace(/^dsh-plugin-v/, '');
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid release version/tag: ${rawVersion || '(empty)'}`);
}

function updatePackage(file, { lockfile = false } = {}) {
  const absolutePath = path.join(root, file);
  let source = fs.readFileSync(absolutePath, 'utf8');
  const setFirstVersion = (text) => text.replace(/("version"\s*:\s*")[^"]+("\s*[,}])/, (_match, prefix, suffix) => `${prefix}${version}${suffix}`);
  source = setFirstVersion(source);
  if (lockfile) {
    const rootPackage = /("packages"\s*:\s*\{\s*""\s*:\s*\{[\s\S]*?)("version"\s*:\s*")[^"]+("\s*[,}])/;
    source = source.replace(rootPackage, (_match, prefix, versionPrefix, suffix) => `${prefix}${versionPrefix}${version}${suffix}`);
  }
  JSON.parse(source);
  fs.writeFileSync(absolutePath, source);
}

updatePackage('package.json');
updatePackage('package-lock.json', { lockfile: true });
updatePackage('agent-integrations/dsh-workbench/package.json');
console.log(`Prepared application and DSH plugin version ${version}`);
