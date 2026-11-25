import { validateSocialCardDesignScheme } from './social-card-design-scheme-contract.mjs';
export { validateSocialCardDesignScheme };

const clean = (value) => String(value ?? '').trim();
const normalized = (value) => clean(value).toLowerCase();

export function compareSocialCardDesignToMeasurements({ designScheme, storyboardPages = [], pageMeasurements = [], selectedPage = null, expectedParadigmId = '' } = {}) {
  const contract = validateSocialCardDesignScheme({ designScheme, storyboardPages, expectedParadigmId });
  const issues = [...contract.issues];
  const anchors = (Array.isArray(designScheme?.sharedAnchors) ? designScheme.sharedAnchors : []).map((anchor) => clean(anchor?.id)).filter(Boolean);
  const planPages = Array.isArray(designScheme?.pages) ? designScheme.pages : [];
  const pageResults = [];

  if (!selectedPage && pageMeasurements.length !== planPages.length) {
    issues.push({ code: 'RENDERED_PAGE_COUNT_MISMATCH', field: 'pages', expected: planPages.length, actual: pageMeasurements.length, message: `HTML 实际页面数（${pageMeasurements.length}）必须与视觉方案/故事板一致（${planPages.length} 页）` });
  }

  for (const measurement of pageMeasurements) {
    const index = Number(measurement.page) - 1;
    const plan = planPages[index];
    const actual = measurement.pageStyle || {};
    const pageIssues = [];
    if (!plan) {
      pageIssues.push({ code: 'DESIGN_PAGE_MISSING', page: measurement.page, message: `第 ${measurement.page} 页没有对应的视觉规划` });
    } else {
      const expected = {
        pageNumber: String(measurement.page),
        pageRole: clean(plan.role),
        visualComposition: clean(plan.composition),
        primaryVisual: clean(plan.primaryVisual),
        backgroundMode: clean(plan.backgroundMode),
        accentPlacement: clean(plan.accentPlacement),
      };
      const actualValues = {
        pageNumber: clean(actual.pageNumber),
        pageRole: clean(actual.role),
        visualComposition: clean(actual.visualComposition),
        primaryVisual: clean(actual.primaryVisual),
        backgroundMode: clean(actual.backgroundMode),
        accentPlacement: clean(actual.accentPlacement),
      };
      for (const [field, value] of Object.entries(expected)) {
        if (!actualValues[field] || normalized(actualValues[field]) !== normalized(value)) {
          pageIssues.push({ code: 'DESIGN_PAGE_MARKER_MISMATCH', page: measurement.page, field, expected: value, actual: actualValues[field], message: `第 ${measurement.page} 页 HTML 标记 ${field} 缺失或与设计方案不一致` });
        }
      }
      const presentAnchors = new Set(Array.isArray(actual.sharedAnchorIds) ? actual.sharedAnchorIds.map(normalized) : []);
      for (const anchorId of anchors) {
        if (!presentAnchors.has(normalized(anchorId))) pageIssues.push({ code: 'SHARED_ANCHOR_MISSING', page: measurement.page, field: `sharedAnchors.${anchorId}`, message: `第 ${measurement.page} 页缺少共用视觉元素 ${anchorId}` });
      }
    }
    issues.push(...pageIssues);
    pageResults.push({ page: measurement.page, valid: pageIssues.length === 0, issues: pageIssues });
  }

  if (!selectedPage && pageMeasurements.length === planPages.length && pageMeasurements.length >= 5) {
    const backgrounds = pageMeasurements.map(({ pageStyle = {} }) => `${normalized(pageStyle.backgroundColor)}|${normalized(pageStyle.backgroundImage)}`);
    const renderedBackgroundCount = new Set(backgrounds).size;
    if (renderedBackgroundCount < 2) {
      issues.push({ code: 'RENDERED_BACKGROUND_DIVERSITY_LOW', field: 'pages', message: 'HTML 实际渲染的页面背景/表面少于 2 种；仅在方案里标不同背景不算落实' });
    }
    contract.diversity.renderedBackgrounds = renderedBackgroundCount;
  }

  return {
    valid: issues.length === 0,
    issues,
    diversity: contract.diversity,
    pages: pageResults,
    checkedPage: selectedPage || null,
  };
}
