import { validateThemeDefinition, colorContrast } from '../../../shared/themes/theme-validator.mjs';
import { coverSpecFromTheme, validateCoverSpec, checkCoverLayout } from '../../../shared/themes/cover-components.mjs';
import { normalizeCoverSemantics } from './cover-semantics.mjs';

const MOTIFS = new Set(['circuit', 'network', 'brackets', 'signal', 'chart', 'orbit']);

export function validateCoverDesignPayload({ payload, title = '', summary = '', brand = '', id = 'cover-design', fillFromArticle = false } = {}) {
  const issues = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { issues: [{ field: 'designScheme', code: 'SCHEME_REQUIRED', message: '必须提交封面设计方案对象' }], definition: null, spec: null, semantic: null };
  if (Number(payload.schemaVersion) !== 1) issues.push({ field: 'schemaVersion', code: 'SCHEME_VERSION_INVALID', message: '必须为 1' });
  const semantic = payload.semantic;
  if (!semantic || typeof semantic !== 'object' || Array.isArray(semantic)) issues.push({ field: 'semantic', code: 'SEMANTIC_REQUIRED', message: '必须提交内部与外部共用的语义对象' });
  else {
    for (const key of ['highlightTerms', 'visualMetaphorCandidates']) if (!Array.isArray(semantic[key]) || semantic[key].some((item) => typeof item !== 'string')) issues.push({ field: `semantic.${key}`, code: 'SEMANTIC_INVALID', message: '必须为字符串数组' });
    for (const key of ['coreSubject', 'coreAction', 'narrativeChange', 'emotionalTension', 'primaryFocus']) if (typeof semantic[key] !== 'string') issues.push({ field: `semantic.${key}`, code: 'SEMANTIC_INVALID', message: '必须为字符串' });
    if (!MOTIFS.has(semantic.motifKind)) issues.push({ field: 'semantic.motifKind', code: 'SEMANTIC_INVALID', message: '必须使用封面母题枚举值' });
  }
  const core = validateCoverDesignCore({ designScheme: payload.designScheme, semantic, title, summary, brand, id, fillFromArticle });
  return { ...core, issues: [...issues, ...core.issues] };
}

export function validateCoverDesignCore({ designScheme, semantic: rawSemantic = null, title = '', summary = '', brand = '', id = 'cover-design', fillFromArticle = false } = {}) {
  const issues = [];
  if (!designScheme || typeof designScheme !== 'object' || Array.isArray(designScheme)) {
    return { issues: [{ field: 'designScheme', code: 'SCHEME_REQUIRED', message: '必须提交 designScheme 对象' }], definition: null, spec: null, semantic: null };
  }
  const definition = {
    schemaVersion: 1,
    id,
    label: '文章封面设计',
    version: '1.0.0',
    description: String(designScheme.visualDirection || '文章封面设计').slice(0, 160),
    targets: ['cover'], status: 'draft', source: 'builtin', basedOn: null, tags: ['per-run'],
    tokens: designScheme.tokens,
    cover: { spec: designScheme.spec },
  };
  if (!String(designScheme.visualDirection || '').trim()) issues.push({ field: 'designScheme.visualDirection', code: 'VISUAL_DIRECTION_REQUIRED', message: '必须提供视觉方向说明' });
  try { validateThemeDefinition(definition, { expectedTarget: 'cover', expectedSource: 'builtin' }); }
  catch (error) { return { issues: [...issues, ...(error.issues || [{ field: 'designScheme', code: 'SCHEME_INVALID', message: error.message }])], definition, spec: null, semantic: null }; }

  const muted = definition.tokens?.colors?.muted;
  const page = definition.tokens?.colors?.page;
  if (/^#[0-9a-f]{6}$/i.test(muted || '') && /^#[0-9a-f]{6}$/i.test(page || '') && colorContrast(muted, page) < 3) {
    issues.push({ field: 'tokens.colors.muted', code: 'LOW_CONTRAST', message: '对比度必须至少为 3:1' });
  }

  const semantic = normalizeCoverSemantics(rawSemantic, { title });
  const spec = fillFromArticle
    ? coverSpecFromTheme(designScheme.spec, { title, subtitle: summary, brand, theme: definition, coverSemantics: semantic, fillDecorations: false })
    : designScheme.spec;
  if (!spec) issues.push({ field: 'designScheme.spec', code: 'COVER_SPEC_INVALID', message: '构图组件不符合封面组件契约' });
  else {
    const checked = validateCoverSpec(spec, title);
    issues.push(...checked.issues);
    issues.push(...checkCoverLayout(spec.components || [], spec.layout));
  }
  return { issues, definition, spec, semantic };
}
