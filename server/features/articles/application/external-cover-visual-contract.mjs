import { validateThemeDefinition } from '../../../shared/themes/theme-validator.mjs';
import { validateCoverSpec, checkCoverLayout } from '../../../shared/themes/cover-components.mjs';

const clean = (value) => String(value ?? '').trim();
const squash = (value) => clean(value).replace(/\s+/g, '');

function matchesPosition(component, rect, canvas = {}) {
  const width = Number(canvas.width) || 900;
  const height = Number(canvas.height) || 383;
  const centerX = (rect.x + rect.width / 2) / width;
  const centerY = (rect.y + rect.height / 2) / height;
  if (component.type === 'decoration' && component.position) {
    const horizontal = component.position.endsWith('left') ? centerX < 0.4 : component.position.endsWith('right') ? centerX > 0.6 : centerX >= 0.3 && centerX <= 0.7;
    const vertical = component.position.startsWith('top') ? centerY < 0.35 : component.position.startsWith('bottom') ? centerY > 0.65 : centerY >= 0.3 && centerY <= 0.7;
    return horizontal && vertical;
  }
  if (component.type === 'color-block') {
    if (component.position === 'left-third') return centerX < 0.4;
    if (component.position === 'left-half') return centerX < 0.5;
    if (['right-half', 'right-panel'].includes(component.position)) return centerX > 0.5;
    if (component.position === 'top-band') return centerY < 0.35;
    if (component.position === 'full') return rect.width / width > 0.7 || rect.height / height > 0.7;
  }
  if (component.type === 'giant-char' && component.position) {
    if (component.position === 'left') return centerX < 0.45;
    if (component.position === 'right') return centerX > 0.55;
    return centerX >= 0.35 && centerX <= 0.65;
  }
  return true;
}

export function validateExternalCoverDesignScheme({ designScheme, title = '' } = {}) {
  const issues = [];
  if (!designScheme || typeof designScheme !== 'object' || Array.isArray(designScheme)) {
    return { valid: false, issues: [{ code: 'DESIGN_SCHEME_REQUIRED', field: 'designScheme', message: '必须提交封面设计方案' }] };
  }
  if (Number(designScheme.schemaVersion) !== 1) issues.push({ code: 'SCHEME_VERSION_INVALID', field: 'schemaVersion', message: 'designScheme.schemaVersion 必须为 1' });
  const design = designScheme.designScheme;
  if (!design || typeof design !== 'object' || Array.isArray(design)) {
    issues.push({ code: 'SCHEME_REQUIRED', field: 'designScheme.designScheme', message: '必须包含 tokens 和 spec' });
    return { valid: false, issues };
  }
  const definition = {
    schemaVersion: 1,
    id: 'external-cover',
    label: '外部 Agent 封面方案',
    version: '1.0.0',
    description: clean(design.visualDirection) || '外部 Agent 封面方案',
    targets: ['cover'], status: 'draft', source: 'builtin', basedOn: null, tags: ['external-agent'],
    tokens: design.tokens,
    cover: { spec: design.spec },
  };
  try { validateThemeDefinition(definition, { expectedTarget: 'cover', expectedSource: 'builtin' }); }
  catch (error) { issues.push(...(error.issues || [{ code: 'SCHEME_INVALID', field: 'designScheme', message: error.message }])); }
  const spec = design.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    issues.push({ code: 'COVER_SPEC_REQUIRED', field: 'designScheme.spec', message: '必须提供封面构图组件 spec' });
  } else {
    const checked = validateCoverSpec(spec, title);
    issues.push(...checked.issues.map((item) => ({ code: 'COVER_SPEC_INVALID', ...item })));
    issues.push(...checkCoverLayout(spec.components || [], spec.layout).map((item) => ({ code: 'COVER_LAYOUT_INVALID', ...item })));
  }
  return { valid: issues.length === 0, issues };
}

export function compareExternalCoverDesignToMeasurements({ designScheme, title = '', measurements = [] } = {}) {
  const contract = validateExternalCoverDesignScheme({ designScheme, title });
  const issues = [...contract.issues];
  if (measurements.length !== 1) issues.push({ code: 'COVER_PAGE_COUNT_MISMATCH', field: 'html', message: '渲染后必须恰好有一个 .page' });
  const page = measurements[0];
  const spec = designScheme?.designScheme?.spec || {};
  if (page && (Math.round(page.pageStyle.width) !== 900 || Math.round(page.pageStyle.height) !== 383)) issues.push({ code: 'COVER_CANVAS_SIZE_MISMATCH', field: 'html .page', message: '浏览器实际渲染画布必须为 900×383' });
  if (page && page.pageStyle.coverLayout !== clean(spec.layout)) issues.push({ code: 'COVER_LAYOUT_MISMATCH', field: 'html[data-cover-layout]', message: 'HTML 的 data-cover-layout 必须与方案 spec.layout 一致' });
  const components = Array.isArray(spec.components) ? spec.components : [];
  const usedElements = new Set();
  const plannedCounts = components.reduce((counts, component) => counts.set(component.type, (counts.get(component.type) || 0) + 1), new Map());
  for (const [type, count] of plannedCounts) {
    const actualCount = (page?.coverComponents || []).filter((item) => item.component === type && item.visible).length;
    if (actualCount !== count) issues.push({ code: 'COVER_COMPONENT_COUNT_MISMATCH', field: `spec.components.${type}`, message: `方案有 ${count} 个 ${type} 组件，HTML 标记了 ${actualCount} 个可见组件` });
  }
  for (const component of components) {
    const rendered = (page?.coverComponents || []).filter((item) => item.component === component.type && item.visible && !usedElements.has(item));
    const item = rendered[0];
    if (!item) {
      issues.push({ code: 'COVER_COMPONENT_MISSING', field: `spec.components.${component.type}`, message: `方案组件 ${component.type} 未找到可见的 [data-cover-component="${component.type}"] 元素` });
      continue;
    }
    usedElements.add(item);
    if (!matchesPosition(component, item.rect, page?.pageStyle) ) issues.push({ code: 'COVER_COMPONENT_POSITION_MISMATCH', field: `spec.components.${component.type}.position`, message: `组件 ${component.type} 的实际位置与方案位置 ${component.position} 不符` });
    if (component.type === 'title') {
      if (squash(item.text) !== squash(title)) issues.push({ code: 'COVER_TITLE_MARKER_MISMATCH', field: 'html[data-cover-component="title"]', message: '标题标记元素的可见文字必须与文章原题一致' });
      const expectedSize = Number(designScheme.designScheme.tokens?.typography?.titlePx);
      if (Number.isFinite(expectedSize) && Math.abs(item.fontSize - expectedSize) > Math.max(2, expectedSize * 0.15)) issues.push({ code: 'COVER_TITLE_SIZE_MISMATCH', field: 'html[data-cover-component="title"]', message: `标题实际字号 ${item.fontSize}px 与方案 ${expectedSize}px 偏差过大` });
    }
    const role = component.type === 'title' ? 'text' : component.colorRole;
    if (role) {
      if (item.colorRole !== role) issues.push({ code: 'COVER_COLOR_ROLE_MISMATCH', field: `spec.components.${component.type}.colorRole`, message: `组件需标记 data-cover-color-role="${role}"` });
      const expected = designScheme.designScheme.tokens?.colors?.[role];
      const actualColors = [item.color, item.backgroundColor, item.backgroundImage, item.borderColor].map((value) => String(value || '').toLowerCase());
      const hex = String(expected || '').toLowerCase();
      const rgb = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
      const expectedRgb = rgb ? `rgb(${parseInt(rgb[1], 16)}, ${parseInt(rgb[2], 16)}, ${parseInt(rgb[3], 16)})` : '';
      if (!actualColors.some((value) => value.includes(hex) || value.includes(expectedRgb))) issues.push({ code: 'COVER_COLOR_NOT_RENDERED', field: `spec.components.${component.type}.colorRole`, message: `渲染样式未使用方案色彩 ${role} (${expected})` });
    }
  }
  return { valid: issues.length === 0, issues, checkedComponents: components.length, checkedLayout: clean(spec.layout) };
}
