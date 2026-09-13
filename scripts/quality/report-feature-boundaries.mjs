import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : entry.name.endsWith('.mjs') ? [file] : [];
  });
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function imported(source, pattern) {
  return pattern.test(source);
}

const violations = [];
const featureRoot = path.join(root, 'server', 'features');
for (const file of walk(featureRoot)) {
  const name = relative(file);
  const source = fs.readFileSync(file, 'utf8');
  const featureMatch = name.match(/^server\/features\/([^/]+)\//);
  if (!featureMatch) continue;
  const feature = featureMatch[1];
  const isDomain = /\/domain\//.test(name);
  if (isDomain && imported(source, /from ['"][^'"]*(?:^|\/)platform\//m)) violations.push({ rule: 'domain-no-platform', file: name });
  if (isDomain && imported(source, /from ['"](?:node:)?fs['"]|from ['"][^'"]*\/store(?:\.mjs)?['"]|\bfetch\s*\(/)) violations.push({ rule: 'domain-no-io', file: name });
  const crossFeature = [...source.matchAll(/from ['"]([^'"]*\/features\/([^/'"]+)[^'"]*)['"]/g)]
    .filter((match) => match[2] !== feature);
  for (const match of crossFeature) violations.push({ rule: 'feature-cross-import', file: name, target: match[1] });
}

const lowerPlatformLayers = new Set(['core', 'collectors', 'connectors', 'extensions', 'persistence', 'plugin-sdk', 'plugins', 'tools']);
const platformRoot = path.join(root, 'server', 'platform');
for (const file of walk(platformRoot)) {
  const name = relative(file);
  const layer = name.split('/')[2];
  if (!lowerPlatformLayers.has(layer)) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (imported(source, /from ['"][^'"]*\/features\//)) violations.push({ rule: 'low-platform-no-feature', file: name });
}

const report = {
  mode: 'report',
  generatedAt: new Date().toISOString(),
  scanned: { features: walk(featureRoot).length, platform: walk(platformRoot).length },
  violationCount: violations.length,
  rules: [...new Set(violations.map((item) => item.rule))].sort(),
  violations,
};
console.log(JSON.stringify(report, null, 2));
