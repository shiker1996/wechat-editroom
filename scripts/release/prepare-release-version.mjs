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
  const value = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  value.version = version;
  if (lockfile && value.packages?.['']) value.packages[''].version = version;
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

updatePackage('package.json');
updatePackage('package-lock.json', { lockfile: true });
updatePackage('agent-integrations/dsh-workbench/package.json');
console.log(`Prepared application and DSH plugin version ${version}`);
