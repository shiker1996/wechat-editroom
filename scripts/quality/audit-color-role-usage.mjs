import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicRoot = path.join(root, 'public');
const generatedRoot = path.join(publicRoot, 'assets', 'styles');
const allowlistPath = path.join(root, 'scripts', 'quality', 'color-role-allowlist.json');
const extensions = new Set(['.css', '.html', '.js']);
const propertyRole = new Map([
  ['color', 'text'], ['-webkit-text-fill-color', 'text'], ['text-decoration-color', 'text'], ['text-emphasis-color', 'text'],
  ['background', 'surface'], ['background-color', 'surface'],
  ['border', 'border'], ['border-color', 'border'], ['border-top', 'border'], ['border-right', 'border'], ['border-bottom', 'border'], ['border-left', 'border'],
  ['outline', 'focus'], ['outline-color', 'focus'], ['text-shadow', 'shadow'], ['box-shadow', 'shadow'],
]);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (target === generatedRoot || /(?:^|[\\/])(?:node_modules|\.git|data|articles|social-cards|output|logs)(?:[\\/]|$)/i.test(target)) continue;
      files.push(...walk(target));
    } else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(target);
  }
  return files;
}

function tokenRole(name) {
  const token = name.replace(/^--/, '').toLowerCase();
  // Component names can contain other role words; classify by final role suffix.
  if (/(?:^|-)surface$|(?:^|-)paper$|-(?:background|bg)$/.test(token)) return 'surface';
  if (/(?:^|-)border$|(?:^|-)line$|(?:^|-)edge$/.test(token)) return 'border';
  if (/(?:^|-)shadow$/.test(token)) return 'shadow';
  if (/(?:^|-)focus$|focus-ring$/.test(token)) return 'focus';
  if (/(?:^|-)white$|(?:^|-)black$|(?:^|-)ink(?:-[\w-]+)?$|(?:^|-)muted(?:-[\w-]+)?$|(?:^|-)text(?:-[\w-]+)?$|(?:^|-)foreground(?:-[\w-]+)?$/.test(token)) return 'text';
  return null;
}

function propertyOf(declaration) {
  return declaration.match(/^\s*([\w-]+)\s*:/)?.[1]?.toLowerCase() ?? null;
}

function lineAt(source, index) { return source.slice(0, index).split('\n').length; }

const files = walk(publicRoot);
const definitions = new Set();
const entries = files.map((file) => {
  const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) definitions.add(match[1]);
  return { file, relative: path.relative(root, file).replaceAll(path.sep, '/'), source };
});

const allowlist = fs.existsSync(allowlistPath) ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8')) : {};
const allowed = new Set((allowlist.allowed ?? []).map((item) => `${item.file}\t${item.property}\t${item.token}`));
const propertyCounts = new Map();
const tokenUses = new Map();
const findings = [];
const tokenFilter = process.argv.find((arg) => arg.startsWith('--token='))?.slice(8);
const summaryOnly = process.argv.includes('--summary');

for (const entry of entries) {
  // Rule bodies are enough for static role analysis; at-rules without declarations are ignored.
  for (const rule of entry.source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = rule[2];
    for (const declaration of body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) {
      const property = declaration[1].toLowerCase();
      const expectedRole = propertyRole.get(property);
      if (!expectedRole) continue;
      propertyCounts.set(property, (propertyCounts.get(property) ?? 0) + 1);
      const value = declaration[2];
      for (const variable of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        const token = variable[1];
        const role = tokenRole(token);
        tokenUses.set(`${property}\t${token}`, (tokenUses.get(`${property}\t${token}`) ?? 0) + 1);
        const compatibleRoles = (role === 'focus' && ['border', 'shadow'].includes(expectedRole));
        if (role && role !== expectedRole && !compatibleRoles) {
          const key = `${entry.relative}\t${property}\t${token}`;
          if (!allowed.has(key)) findings.push({ type: 'cross-role-token', file: entry.relative, line: lineAt(entry.source, rule.index + rule[0].indexOf(body) + declaration.index), selector: rule[1].trim(), value, property, token, actualRole: role, expectedRole });
        }
      }
    }
  }
}

const grouped = new Map();
for (const finding of findings) {
  const key = `${finding.type}\t${finding.expectedRole}\t${finding.actualRole ?? 'undefined'}\t${finding.property}\t${finding.token}`;
  if (!grouped.has(key)) grouped.set(key, { ...finding, occurrences: [] });
  grouped.get(key).occurrences.push(finding);
}

console.log(`颜色用途审计：${entries.length} 个源文件（${[...propertyCounts.values()].reduce((sum, count) => sum + count, 0)} 条颜色相关声明）`);
console.log('审计属性：color/background/border/outline/shadow。font 是字体族、字号、字重与行高简写；文字颜色由 color 单独控制。');
console.log(`发现 ${findings.length} 条跨用途引用。`);
console.log('未定义变量由 check:page-colors 校验；本脚本只报告颜色用途。');
console.log('\n声明属性分布：');
for (const [property, count] of [...propertyCounts].sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${property}: ${count}`);
console.log('\n按 token 汇总的可疑引用：');
if (!grouped.size) console.log('  未发现跨用途或未定义 token 引用。');
for (const item of [...grouped.values()].filter((item) => !tokenFilter || item.token === tokenFilter).sort((a, b) => a.expectedRole.localeCompare(b.expectedRole) || a.token.localeCompare(b.token))) {
  console.log(`  ${item.expectedRole} <- ${item.token} (${item.actualRole}); ${item.occurrences.length} 处`);
  if (!summaryOnly) {
    for (const location of item.occurrences) {
      console.log(`    ${location.file}:${location.line} ${location.selector} { ${location.property}: ${location.value} }`);
    }
  }
}

if (process.argv.includes('--strict') && findings.length) process.exitCode = 1;
