import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const publicRoot = path.join(root, "public");
const generatedStyleDir = path.join(publicRoot, "assets", "styles");
const tokenFile = path.join(publicRoot, "styles", "tokens-base.css");
const allowlistPath = path.join(root, "scripts", "quality", "page-color-allowlist.json");
const extensions = new Set([".css", ".js", ".html"]);
const colorLiteral = /#[\da-f]{3,8}\b\b|\b(?:rgb|rgba|hsl|hsla)\(\s*[^)]{1,100}\)/gi;
const variableUse = /var\(\s*(--[\w-]+)/g;
const variableDefinition = /(--[\w-]+)\s*:/g;
const colorLikeVariable = /(?:color|ink|surface|bg|background|border|line|shadow|accent|paper|red|blue|green|yellow|mint|white|black|fill|stroke|focus|muted|text|wash|danger|warning|success|palette|overlay|chrome)/i;
const valueEncodedPalette = /--(?:production|system|editor|social|topics|chrome)-palette-(?:rgb|hex)-[\w-]+|--(?:production|system|editor|social|topics|chrome)-palette-(?:white|black)\b/g;
const legacySurfacePalette = /background(?:-color)?\s*:\s*[^;{}]*var\(\s*(--(?:editor|system|production)-palette-rgb-255-255-255-[\w-]+|--system-palette-hex-fbf9f3|--production-palette-hex-edf5f0|--editor-palette-rgb-251-249-242-68)\s*\)/g;
const inverseInkBackground = /background(?:-color)?\s*:\s*var\(\s*--(?:ink|ink-strong)\s*\)/g;

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (target === generatedStyleDir) continue;
      files.push(...walk(target));
    } else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(target);
  }
  return files;
}

function lineAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

const files = walk(publicRoot);
const sources = files.map((file) => ({ file, relative: path.relative(root, file).replaceAll(path.sep, "/"), source: fs.readFileSync(file, "utf8") }));
const defined = new Set();
for (const entry of sources) for (const match of entry.source.matchAll(variableDefinition)) defined.add(match[1]);
// Runtime-created custom properties are also valid definitions.
for (const entry of sources) {
  for (const match of entry.source.matchAll(/setProperty\(\s*["'`](--[\w-]+)["'`]/g)) defined.add(match[1]);
}

const findings = [];
const allowlist = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
const allowedLiterals = new Set(Object.entries(allowlist.literalColors).flatMap(([file, colors]) => colors.map((color) => `${file}\t${color.toLowerCase()}`)));
for (const entry of sources) {
  for (const match of entry.source.matchAll(variableUse)) {
    // Social theme HTML receives --p-* plus legacy --wash/--text values from its serialized theme payload.
    if (/^--p-/.test(match[1]) || ["--wash", "--text"].includes(match[1])) continue;
    if (colorLikeVariable.test(match[1]) && !defined.has(match[1])) findings.push({ type: "undefined-token", file: entry.relative, line: lineAt(entry.source, match.index), value: match[1] });
  }
  for (const match of entry.source.matchAll(valueEncodedPalette)) {
    findings.push({ type: "value-encoded-token", file: entry.relative, line: lineAt(entry.source, match.index), value: match[0] });
  }
  for (const match of entry.source.matchAll(legacySurfacePalette)) {
    findings.push({ type: "legacy-surface-token", file: entry.relative, line: lineAt(entry.source, match.index), value: match[1] });
  }
  for (const match of entry.source.matchAll(inverseInkBackground)) {
    findings.push({ type: "ink-used-as-background", file: entry.relative, line: lineAt(entry.source, match.index), value: "--ink" });
  }
  if (entry.file === tokenFile) continue; // Canonical palette values belong in the token registry.
  for (const match of entry.source.matchAll(colorLiteral)) {
    const key = `${entry.relative}\t${match[0].toLowerCase()}`;
    if (!allowedLiterals.has(key)) findings.push({ type: "literal-color", file: entry.relative, line: lineAt(entry.source, match.index), value: match[0] });
  }
}

const literals = findings.filter((item) => item.type === "literal-color");
const undefinedTokens = findings.filter((item) => item.type === "undefined-token");
const legacySurfaces = findings.filter((item) => item.type === "legacy-surface-token");
const inverseBackgrounds = findings.filter((item) => item.type === "ink-used-as-background");
const valueEncodedTokens = findings.filter((item) => item.type === "value-encoded-token");
console.log(`扫描 ${sources.length} 个页面源文件（CSS、JS、HTML；跳过由源 CSS 生成的 public/assets/styles）`);
console.log(`发现 ${literals.length} 处未放行的硬编码颜色，${undefinedTokens.length} 处未定义的颜色变量引用，${valueEncodedTokens.length} 个名称编码色值的 palette token，${legacySurfaces.length} 处旧式浅色表面 token，${inverseBackgrounds.length} 处将前景色 token 当背景色使用。另有 ${allowlist.allowedLiteralCount} 个已登记的主题/图表色值。`);
for (const item of findings) console.log(`${item.type}\t${item.file}:${item.line}\t${item.value}`);
if (findings.length) process.exitCode = 1;
