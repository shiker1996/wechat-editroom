import { validateTypesetDesignScheme } from './typeset-design-scheme.mjs';

const close = (actual, expected, tolerance = 1) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;

function issue(code, field, message) { return { code, field, message }; }

export function validateExternalTypesetDesignScheme({ designScheme } = {}) {
  return validateTypesetDesignScheme(designScheme);
}

function cssRgb(hex) {
  const value = String(hex || '').toLowerCase();
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/.exec(value);
  return match ? `rgb(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)})` : '';
}

function colorUsed(elements, color) {
  const expected = cssRgb(color);
  return Boolean(expected) && elements.some((element) => [element.color, element.backgroundColor, element.borderColor].some((actual) => String(actual || '').toLowerCase() === expected));
}

export function compareExternalTypesetDesignToMeasurements({ designScheme, measurements = [] } = {}) {
  const contract = validateExternalTypesetDesignScheme({ designScheme });
  const issues = [...contract.issues];
  const page = measurements[0];
  const metrics = page?.designMetrics;
  if (measurements.length !== 1 || !metrics) return { valid: false, issues: [...issues, issue('ARTICLE_MEASUREMENTS_MISSING', 'html', '无法读取规范化 HTML 的浏览器样式测量结果')] };
  const elements = [{ color: page.pageStyle.backgroundColor, backgroundColor: page.pageStyle.backgroundColor }, ...metrics.elements];
  const paragraphs = metrics.paragraphs;
  const bodyPx = Number(designScheme?.typography?.body_px);
  const expectedLineHeight = Number(designScheme?.typography?.line_height);
  const h2Px = Number(designScheme?.typography?.h2_px);
  if (!colorUsed(elements, designScheme?.colors?.background)) issues.push(issue('BACKGROUND_TOKEN_NOT_RENDERED', 'colors.background', '规范化后未找到与方案背景色相同的实际计算样式'));
  if (!colorUsed(paragraphs, designScheme?.colors?.text)) issues.push(issue('BODY_COLOR_MISMATCH', 'colors.text', '正文段落没有实际使用方案 text 色'));
  for (const key of ['muted', 'accent']) if (!colorUsed(elements, designScheme?.colors?.[key])) issues.push(issue('COLOR_TOKEN_NOT_RENDERED', `colors.${key}`, `规范化后的可见元素没有使用方案 ${key} 色`));
  if (!paragraphs.some((item) => close(item.fontSize, bodyPx, 1))) issues.push(issue('BODY_SIZE_MISMATCH', 'typography.body_px', `没有正文段落使用方案字号 ${bodyPx}px`));
  if (!paragraphs.some((item) => item.fontSize > 0 && close(item.lineHeight / item.fontSize, expectedLineHeight, 0.12))) issues.push(issue('BODY_LINE_HEIGHT_MISMATCH', 'typography.line_height', `没有正文段落的实际行高比例符合 ${expectedLineHeight}`));
  if (metrics.sectionHeadings.length && !metrics.sectionHeadings.some((item) => close(item.fontSize, h2Px, 1))) issues.push(issue('HEADING_SIZE_MISMATCH', 'typography.h2_px', `章节标题没有使用方案字号 ${h2Px}px`));
  if (paragraphs.length && !paragraphs.some((item) => close(item.marginBottom, Number(designScheme?.spacing?.paragraph_px), 1) || close(item.marginTop, Number(designScheme?.spacing?.paragraph_px), 1))) issues.push(issue('PARAGRAPH_SPACING_MISMATCH', 'spacing.paragraph_px', '正文段落的实际上下间距没有采用方案值'));
  if (metrics.sectionHeadings.length && !metrics.sectionHeadings.some((item) => close(item.marginBottom, Number(designScheme?.spacing?.section_px), 1) || close(item.marginTop, Number(designScheme?.spacing?.section_px), 1))) issues.push(issue('SECTION_SPACING_MISMATCH', 'spacing.section_px', '章节标题的实际上下间距没有采用方案值'));
  if (metrics.images.length && !metrics.images.some((item) => close(item.borderRadius, Number(designScheme?.image?.radius_px), 1))) issues.push(issue('IMAGE_RADIUS_MISMATCH', 'image.radius_px', '文章图片的实际圆角没有采用方案值'));
  if (metrics.captions.length && !metrics.captions.some((item) => close(item.fontSize, Number(designScheme?.image?.caption_px), 1))) issues.push(issue('CAPTION_SIZE_MISMATCH', 'image.caption_px', '图注的实际字号没有采用方案值'));
  return {
    valid: issues.length === 0,
    issues,
    checked: { colorTokens: 4, paragraphs: paragraphs.length, sectionHeadings: metrics.sectionHeadings.length, images: metrics.images.length, captions: metrics.captions.length },
  };
}
