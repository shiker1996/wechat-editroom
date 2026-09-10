#!/usr/bin/env node

/**
 * Report hard-coded CSS colors and optionally migrate the known legacy paper
 * palette to the desktop theme tokens.
 *
 * This is intentionally conservative. A blind global replacement would break
 * code previews, SVG icons, syntax highlighting and user-authored theme data.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const stylesDir = path.join(root, "public", "styles");
const shouldFix = process.argv.includes("--fix");
const strict = process.argv.includes("--strict");
const auditAll = process.argv.includes("--all");
const auditUi = process.argv.includes("--ui");

const legacyPalette = new Map([
  ["#fff", "var(--white)"],
  ["#ffffff", "var(--white)"],
  ["#fffdf7", "var(--surface)"],
  ["#f8f5ee", "var(--surface)"],
  ["#f7f3e8", "var(--surface)"],
  ["#f5f1e8", "var(--surface-hover)"],
  ["#f4efe5", "var(--surface-subtle)"],
  ["#f7f3ea", "var(--surface)"],
  ["#f4ecdc", "var(--surface)"],
  ["#f4f0e6", "var(--surface)"],
  ["#f0ebe0", "var(--surface)"],
  ["#eee8dc", "var(--surface-subtle)"],
  ["#ebe6da", "var(--surface-subtle)"],
  ["#e8e2d6", "var(--surface-subtle)"],
  ["#d7d0c3", "var(--paper-deep)"],
  ["#d4cdc0", "var(--paper-deep)"],
  ["#d8d6cf", "var(--paper-deep)"],
  ["#eee5d4", "var(--surface-subtle)"],
  ["#cbc4b7", "var(--line)"],
  ["#c8c0b3", "var(--line)"],
  ["#cfc8bb", "var(--line)"],
  ["#d0c9bc", "var(--line)"],
  ["#bfb7aa", "var(--line-strong)"],
  ["rgba(251,249,242,.52)", "var(--paper-soft)"],
  ["rgba(251,249,242,.55)", "var(--paper-soft)"],
  ["rgba(251,249,242,.7)", "var(--paper-soft)"],
  ["rgba(251,249,242,.72)", "var(--paper-soft)"],
  ["#287257", "var(--success)"],
  ["#277051", "var(--success)"],
  ["#28744d", "var(--success)"],
  ["#2c8b64", "var(--success)"],
  ["#923a2d", "var(--danger)"],
  ["#d05b42", "var(--danger)"],
  ["#fee8e4", "var(--danger-soft)"],
  ["#e5f2ea", "var(--success-soft)"],
  ["#d2982d", "var(--warning)"],
  ["#855d17", "var(--warning)"],
]);
const malformedPalette = new Map([
  ["var(--white)af8", "#fffaf8"],
  ["var(--white)1cf", "#fff1cf"],
  ["var(--white)8e9", "#fff8e9"],
  ["var(--white)2b3", "#fff2b3"],
]);

const colorPattern = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
const ignoredSelectorPattern = /(?:run-trace|adjustment-diff|data:image\/svg\+xml)/i;

function listCssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return listCssFiles(file);
    return entry.isFile() && entry.name.endsWith(".css") ? [file] : [];
  });
}

function isThemeTokenDeclaration(line, matchIndex) {
  const before = line.slice(0, matchIndex);
  const declaration = before.match(/(?:^|[;{}])\s*([\w-]+)\s*:\s*$/);
  return declaration?.[1]?.startsWith("--") ?? false;
}

function isIgnored(line, matchIndex) {
  if (line.includes("data:image/svg+xml")) return true;
  if (ignoredSelectorPattern.test(line)) return true;
  return isThemeTokenDeclaration(line, matchIndex) || declarationProperty(line, matchIndex).startsWith("--");
}

function declarationProperty(line, matchIndex) {
  const prefix = line.slice(0, matchIndex);
  const boundary = Math.max(prefix.lastIndexOf(";"), prefix.lastIndexOf("{"), prefix.lastIndexOf("}"));
  const declaration = prefix.slice(boundary + 1).match(/^\s*([\w-]+)\s*:/);
  return declaration?.[1] ?? "";
}

function isVisualProperty(property) {
  return /(?:^|-)color$|^background(?:-|$)|^border(?:-|$)|^outline(?:-|$)|shadow$|^filter$|^(?:fill|stroke|accent-color|caret-color|scrollbar-color|color-scheme)$/.test(property);
}

const files = listCssFiles(stylesDir);
const findings = [];
let fixedCount = 0;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  let original = source;
  if (shouldFix) {
    for (const [malformed, valid] of malformedPalette) {
      original = original.replaceAll(malformed, valid);
    }
  }
  const lines = original.split(/\r?\n/);
  let changed = original !== source;

  const output = lines.map((line, lineIndex) => line.replace(colorPattern, (value, ...args) => {
    const offset = args.at(-2);
    const normalized = value.toLowerCase().replace(/\s+/g, "");
    const replacement = legacyPalette.get(normalized);
    if (shouldFix && replacement && !isIgnored(line, offset)) {
      changed = true;
      fixedCount += 1;
      return replacement;
    }
    const property = declarationProperty(line, offset);
    if (!property && /^#[0-9a-f]{3,8}$/i.test(value)) return value;
    if (auditUi && !isVisualProperty(property)) return value;
    if (!replacement && !auditAll && !auditUi) return value;
    if (!isIgnored(line, offset)) {
      findings.push({
        file: path.relative(root, file),
        line: lineIndex + 1,
        value,
        property,
      });
    }
    return value;
  })).join("\n");

  if (shouldFix && changed) fs.writeFileSync(file, output);
}

if (shouldFix) {
  console.log("已迁移旧主题色 " + fixedCount + " 处。");
}

if (findings.length === 0) {
  console.log("未发现需要人工确认的 CSS 硬编码颜色。");
} else {
  const byFile = new Map();
  for (const finding of findings) {
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }
  console.log("发现 " + findings.length + " 处仍需人工确认的 CSS 硬编码颜色（按文件汇总）：");
  for (const [file, list] of byFile) {
    const values = [...new Set(list.map((item) => item.value))];
    const properties = [...new Set(list.map((item) => item.property).filter(Boolean))];
    console.log("- " + file + "：" + list.length + " 处，" + values.slice(0, 8).join(", ") + (values.length > 8 ? " …" : "") + (properties.length ? "；属性：" + properties.slice(0, 6).join(", ") : ""));
  }
  if (process.argv.includes("--verbose")) {
    for (const finding of findings) {
      console.log("  " + finding.file + ":" + finding.line + " " + finding.property + ": " + finding.value);
    }
  }
}

if (strict && findings.length > 0) process.exitCode = 1;
