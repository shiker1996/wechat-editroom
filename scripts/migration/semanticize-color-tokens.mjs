import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const stylesRoot = path.join(root, 'public', 'styles');
const tokenFile = path.join(stylesRoot, 'tokens-base.css');
const legacyName = /^--(production|system|editor|social|topics|chrome)-palette-(?:rgb|hex)-[\w-]+$/;
const sourceFiles = fs.readdirSync(stylesRoot)
  .filter((name) => name.endsWith('.css') && name !== 'tokens-base.css')
  .map((name) => path.join(stylesRoot, name));
const contextByName = new Map();

function roleFor(property) {
  if (property === 'background' || property === 'background-color') return 'surface';
  if (property === 'color' || property === 'fill') return 'text';
  if (property === 'stroke' || property.startsWith('border')) return 'border';
  if (property.includes('shadow')) return 'shadow';
  if (property.startsWith('outline')) return 'focus';
  if (property.includes('stop-color')) return 'accent';
  if (property === 'caret-color') return 'caret';
  return 'detail';
}

function semanticName(oldName, fileName, selector, property) {
  const family = oldName.match(legacyName)?.[1];
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  const ids = [...selector.matchAll(/#([\w-]+)/g)].map((match) => match[1]);
  const component = [...ids, ...classes].slice(-4).join('-') || path.basename(fileName, '.css').replace(/[^\w-]/g, '-');
  const state = /:hover|\.hover\b/.test(selector) ? 'hover' : /:focus/.test(selector) ? 'focus' : '';
  const role = roleFor(property);
  return `--${family}-${component}-${state ? `${state}-` : ''}${role}`;
}

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].split('}').at(-1).trim();
    const body = rule[2];
    for (const variable of body.matchAll(/var\(\s*(--(?:production|system|editor|social|topics|chrome)-palette-(?:rgb|hex)-[\w-]+)/g)) {
      if (contextByName.has(variable[1])) continue;
      const before = body.slice(0, variable.index);
      const declaration = before.slice(Math.max(before.lastIndexOf(';'), before.lastIndexOf('{')) + 1);
      const property = declaration.split(':')[0].trim().replace(/[^\w-]/g, '');
      contextByName.set(variable[1], {
        file,
        selector,
        property,
        semantic: semanticName(variable[1], file, selector, property),
      });
    }
  }
}

const definitions = fs.readFileSync(tokenFile, 'utf8');
const valueByName = new Map();
for (const match of definitions.matchAll(/^\s*(--(?:production|system|editor|social|topics|chrome)-palette-(?:rgb|hex)-[\w-]+):\s*([^;]+);\s*$/gm)) {
  valueByName.set(match[1], match[2].trim());
}
if (valueByName.size === 0) {
  console.log('没有待迁移的数值命名 palette token。');
  process.exit(0);
}

const collisions = new Map();
const variantsByBase = new Map();
for (const [name, context] of contextByName) {
  const base = context.semantic;
  const previous = collisions.get(base);
  if (previous && valueByName.get(previous) !== valueByName.get(name)) {
    const nextVariant = (variantsByBase.get(base) || 1) + 1;
    variantsByBase.set(base, nextVariant);
    context.semantic = `${base}-variant-${nextVariant}`;
  }
  collisions.set(context.semantic, name);
}

const semanticValues = new Map();
for (const [name, context] of contextByName) {
  const value = valueByName.get(name);
  if (!value) throw new Error(`Missing value for ${name}`);
  const previous = semanticValues.get(context.semantic);
  if (previous && previous !== value) throw new Error(`Semantic token collision: ${context.semantic}`);
  semanticValues.set(context.semantic, value);
}

for (const file of sourceFiles) {
  let source = fs.readFileSync(file, 'utf8');
  for (const [name, context] of [...contextByName].sort(([left], [right]) => right.length - left.length)) {
    source = source.replaceAll(name, context.semantic);
  }
  fs.writeFileSync(file, source);
}

let updatedDefinitions = definitions.replace(/^\s*--(?:production|system|editor|social|topics|chrome)-palette-(?:rgb|hex)-[\w-]+:\s*[^;]+;\s*\r?\n/gm, '');
const semanticBlock = `  /* Component color roles migrated from value-encoded palette tokens. */\n${[...semanticValues].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n`;
updatedDefinitions = updatedDefinitions.replace(/(  \/\* Shared contrast overlays used on colored and dark surfaces\. \*\/\r?\n)/, `$1${semanticBlock}`);
fs.writeFileSync(tokenFile, updatedDefinitions);

const unused = [...valueByName.keys()].filter((name) => !contextByName.has(name));
console.log(`迁移 ${contextByName.size} 个在用数值命名 token 为组件/用途语义 token；清理 ${unused.length} 个无引用旧 token；新增 ${semanticValues.size} 个保留原色值的语义角色。`);
