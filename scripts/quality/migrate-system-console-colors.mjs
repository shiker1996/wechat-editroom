#!/usr/bin/env node

/**
 * Move literal visual colors from the system console stylesheet into explicit
 * desktop theme tokens. Data-URI SVGs and existing custom properties are left
 * untouched because they are assets or already part of the theme contract.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'public', 'styles', 'system-console.css');
const tokensPath = path.join(root, 'public', 'styles', 'tokens-base.css');
const colorPattern = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
const visualPropertyPattern = /(?:^|-)color$|^background(?:-|$)|^border(?:-|$)|^outline(?:-|$)|shadow$|^(?:fill|stroke|accent-color|caret-color|scrollbar-color|color-scheme)$/;

function propertyAt(line, index) {
  const prefix = line.slice(0, index);
  const boundary = Math.max(prefix.lastIndexOf(';'), prefix.lastIndexOf('{'), prefix.lastIndexOf('}'));
  return prefix.slice(boundary + 1).match(/^\s*([\w-]+)\s*:/)?.[1] ?? '';
}

function slug(value) {
  const normalized = value.toLowerCase().replace(/\s+/g, '');
  const name = normalized
    .replace(/^#/, 'hex-')
    .replace(/^rgba?\(/, 'rgb-')
    .replace(/^hsla?\(/, 'hsl-')
    .replace(/\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return name || 'value';
}

const source = fs.readFileSync(sourcePath, 'utf8');
const values = new Map();
const lines = source.split(/\r?\n/);

for (const line of lines) {
  if (line.includes('data:image/svg+xml')) continue;
  colorPattern.lastIndex = 0;
  let match;
  while ((match = colorPattern.exec(line))) {
    const property = propertyAt(line, match.index);
    if (!visualPropertyPattern.test(property) || property.startsWith('--')) continue;
    const value = match[0].toLowerCase().replace(/\s+/g, '');
    if (!values.has(value)) values.set(value, '--system-palette-' + slug(value));
  }
}

if (values.size === 0) {
  console.log('system-console.css 已没有可迁移的视觉硬编码颜色。');
  process.exit(0);
}

let migrated = '';
for (const line of lines) {
  if (line.includes('data:image/svg+xml')) {
    migrated += line + '\n';
    continue;
  }
  colorPattern.lastIndex = 0;
  migrated += line.replace(colorPattern, (value, ...args) => {
    const index = args.at(-2);
    const property = propertyAt(line, index);
    if (!visualPropertyPattern.test(property) || property.startsWith('--')) return value;
    const normalized = value.toLowerCase().replace(/\s+/g, '');
    return 'var(' + values.get(normalized) + ')';
  }) + '\n';
}

const tokenSource = fs.readFileSync(tokensPath, 'utf8');
const marker = '  /* Generated system console palette tokens. */';
const tokenLines = [...values.entries()].map(([value, token]) => '  ' + token + ': ' + value + ';').join('\n');
if (tokenSource.includes(marker)) {
  throw new Error('系统控制台主题变量块已存在，请人工检查后再运行迁移。');
}
const nextTokens = tokenSource.replace(
  /\n}\n\* \{ box-sizing: border-box; \}/,
  '\n' + marker + '\n' + tokenLines + '\n}\n* { box-sizing: border-box; }',
);

fs.writeFileSync(sourcePath, migrated);
fs.writeFileSync(tokensPath, nextTokens);
console.log('已将 system-console.css 中 ' + values.size + ' 种视觉颜色集中到主题变量。');
