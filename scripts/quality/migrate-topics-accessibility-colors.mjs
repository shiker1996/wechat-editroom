#!/usr/bin/env node

/** Centralize topic, graph, accessibility and run-trace UI colors. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'public', 'styles', 'topics-accessibility.css');
const tokensPath = path.join(root, 'public', 'styles', 'tokens-base.css');
const colorPattern = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/gi;
const visualPropertyPattern = /(?:^|-)color$|^background(?:-|$)|^border(?:-|$)|^outline(?:-|$)|shadow$|^(?:fill|stroke|accent-color|caret-color|scrollbar-color|color-scheme)$/;

function propertyAt(line, index) {
  const prefix = line.slice(0, index);
  const boundary = Math.max(prefix.lastIndexOf(';'), prefix.lastIndexOf('{'), prefix.lastIndexOf('}'));
  return prefix.slice(boundary + 1).match(/^\s*([\w-]+)\s*:/)?.[1] ?? '';
}

function insideThemeReference(line, index) {
  return /var\(\s*--[^)]*$/.test(line.slice(0, index));
}

function slug(value) {
  return value.toLowerCase().replace(/\s+/g, '')
    .replace(/^#/, 'hex-').replace(/^rgba?\(/, 'rgb-').replace(/^hsla?\(/, 'hsl-')
    .replace(/\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'value';
}

const source = fs.readFileSync(sourcePath, 'utf8');
const lines = source.split(/\r?\n/);
const values = new Map();
for (const line of lines) {
  if (line.includes('data:image/svg+xml')) continue;
  colorPattern.lastIndex = 0;
  let match;
  while ((match = colorPattern.exec(line))) {
    if (insideThemeReference(line, match.index)) continue;
    const property = propertyAt(line, match.index);
    if (!visualPropertyPattern.test(property) || property.startsWith('--')) continue;
    const value = match[0].toLowerCase().replace(/\s+/g, '');
    if (!values.has(value)) values.set(value, '--topics-palette-' + slug(value));
  }
}

if (values.size === 0) {
  console.log('topics-accessibility.css 已没有可迁移的视觉硬编码颜色。');
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
    if (insideThemeReference(line, index)) return value;
    const property = propertyAt(line, index);
    if (!visualPropertyPattern.test(property) || property.startsWith('--')) return value;
    return 'var(' + values.get(value.toLowerCase().replace(/\s+/g, '')) + ')';
  }) + '\n';
}

const tokenSource = fs.readFileSync(tokensPath, 'utf8');
const marker = '  /* Generated topics palette tokens. */';
if (tokenSource.includes(marker)) throw new Error('热点与日志主题变量块已存在，请人工检查后再运行迁移。');
const tokenLines = [...values.entries()].map(([value, token]) => '  ' + token + ': ' + value + ';').join('\n');
const nextTokens = tokenSource.replace(
  /\n}\n\* \{ box-sizing: border-box; \}/,
  '\n' + marker + '\n' + tokenLines + '\n}\n* { box-sizing: border-box; }',
);
fs.writeFileSync(sourcePath, migrated.trimEnd() + '\n');
fs.writeFileSync(tokensPath, nextTokens);
console.log('已将 topics-accessibility.css 中 ' + values.size + ' 种视觉颜色集中到主题变量。');
