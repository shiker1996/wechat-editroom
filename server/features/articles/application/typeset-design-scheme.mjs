const HEX = /^#[\da-f]{6}$/i;
const cleanNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : NaN;

function issue(code, field, message) { return { code, field, message }; }

function validateRange(value, field, minimum, maximum, issues) {
  const number = cleanNumber(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) issues.push(issue('TOKEN_OUT_OF_RANGE', field, `数值必须在 ${minimum}–${maximum} 范围内`));
}

// Canonical magazine-design-advisor output contract, shared by internal generation
// and external Agent submissions. Rendering checks remain specific to the HTML path.
export function validateTypesetDesignScheme(designScheme) {
  const issues = [];
  if (!designScheme || typeof designScheme !== 'object' || Array.isArray(designScheme)) {
    return { valid: false, issues: [issue('DESIGN_SCHEME_REQUIRED', 'designScheme', '必须提交结构化排版设计 tokens')] };
  }
  if (Number(designScheme.schema_version) !== 1) issues.push(issue('SCHEMA_VERSION_INVALID', 'schema_version', '必须为 1'));
  const colors = designScheme.colors || {};
  for (const key of ['background', 'text', 'muted', 'accent']) if (!HEX.test(String(colors[key] || ''))) issues.push(issue('COLOR_INVALID', `colors.${key}`, '必须为六位十六进制颜色'));
  const typography = designScheme.typography || {};
  validateRange(typography.body_px, 'typography.body_px', 15, 24, issues);
  validateRange(typography.line_height, 'typography.line_height', 1.4, 2.2, issues);
  validateRange(typography.h2_px, 'typography.h2_px', 18, 36, issues);
  const spacing = designScheme.spacing || {};
  validateRange(spacing.section_px, 'spacing.section_px', 16, 64, issues);
  validateRange(spacing.paragraph_px, 'spacing.paragraph_px', 8, 32, issues);
  const image = designScheme.image || {};
  validateRange(image.radius_px, 'image.radius_px', 0, 32, issues);
  validateRange(image.caption_px, 'image.caption_px', 11, 16, issues);
  return { valid: issues.length === 0, issues };
}
