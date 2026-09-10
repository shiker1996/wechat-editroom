#!/usr/bin/env node

/** Remove generated palette declarations that no source stylesheet references. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tokensPath = path.join(root, 'public', 'styles', 'tokens-base.css');
const stylesDir = path.join(root, 'public', 'styles');
const generatedTokenPattern = /^\s*(--(?:production|system|editor|chrome|social|topics)-palette-[\w-]+)\s*:/;

function listCssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return listCssFiles(file);
    return entry.isFile() && entry.name.endsWith('.css') && file !== tokensPath ? [file] : [];
  });
}

const source = fs.readFileSync(tokensPath, 'utf8');
const files = listCssFiles(stylesDir);
const corpus = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const removed = [];
const next = source.split(/\r?\n/).filter((line) => {
  const token = line.match(generatedTokenPattern)?.[1];
  if (!token || corpus.includes(token)) return true;
  removed.push(token);
  return false;
}).join('\n');

fs.writeFileSync(tokensPath, next);
console.log('已移除 ' + removed.length + ' 个未被源码引用的迁移主题变量。');
if (removed.length) console.log(removed.join('\n'));
