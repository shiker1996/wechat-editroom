import { validateSocialCardDesignScheme } from './social-card-design-scheme-contract.mjs';
export { validateSocialCardDesignScheme };

const clean = (value) => String(value ?? '').trim();
const normalized = (value) => clean(value).toLowerCase();

function placementGuide(placement, pageWidth, pageHeight) {
  const x15 = Math.round(pageWidth * 0.15);
  const x85 = Math.round(pageWidth * 0.85);
  const y15 = Math.round(pageHeight * 0.15);
  const y85 = Math.round(pageHeight * 0.85);
  switch (normalized(placement)) {
    case 'behind-focus': return `整块元素须位于画布中心区：左边缘不小于 ${x15}px、右边缘不大于 ${x85}px、上边缘不小于 ${y15}px、下边缘不大于 ${y85}px`;
    case 'inline': return '整块元素须位于正文带：左右边缘在画布宽度 10%–90% 内，上下边缘在画布高度 15%–85% 内';
    case 'header': return `整块元素须位于画布顶部 28% 范围内（底边不超过 ${Math.round(pageHeight * 0.28)}px）`;
    case 'footer': return `整块元素须位于画布底部 28% 范围内（顶边不低于 ${Math.round(pageHeight * 0.72)}px）`;
    case 'corner': return '元素须靠近画布任一角落，距对应两条边均不超过画布尺寸的 12%';
    case 'edge':
    case 'margin': return '元素须靠近画布任一边缘，距对应边不超过画布尺寸的 12%';
    default: return '';
  }
}

function ornamentPlacementMatches(ornament, pageWidth, pageHeight) {
  const rect = ornament?.rect || {};
  const x = Number(rect.x) || 0;
  const y = Number(rect.y) || 0;
  const width = Number(rect.width) || 0;
  const height = Number(rect.height) || 0;
  if (!(pageWidth > 0 && pageHeight > 0 && width > 0 && height > 0)) return false;
  const nearLeft = x <= pageWidth * 0.12;
  const nearRight = x + width >= pageWidth * 0.88;
  const nearTop = y <= pageHeight * 0.12;
  const nearBottom = y + height >= pageHeight * 0.88;
  switch (normalized(ornament?.placement)) {
    case 'corner': return (nearLeft || nearRight) && (nearTop || nearBottom);
    case 'edge': return nearLeft || nearRight || nearTop || nearBottom;
    case 'header': return y + height <= pageHeight * 0.28;
    case 'footer': return y >= pageHeight * 0.72;
    case 'inline': return x >= pageWidth * 0.1 && x + width <= pageWidth * 0.9 && y >= pageHeight * 0.15 && y + height <= pageHeight * 0.85;
    case 'behind-focus': return x >= pageWidth * 0.15 && x + width <= pageWidth * 0.85 && y >= pageHeight * 0.15 && y + height <= pageHeight * 0.85;
    case 'margin': return nearLeft || nearRight || nearTop || nearBottom;
    default: return false;
  }
}

export function compareSocialCardDesignToMeasurements({ designScheme, storyboardPages = [], pageMeasurements = [], selectedPage = null, expectedParadigmId = '' } = {}) {
  const contract = validateSocialCardDesignScheme({ designScheme, storyboardPages, expectedParadigmId });
  contract.warnings ||= [];
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
    let ornamentSummary = { planned: 0, rendered: 0, distinctRenderedKinds: 0 };
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
      const plannedOrnaments = Array.isArray(plan.ornaments) ? plan.ornaments : [];
      const renderedOrnaments = Array.isArray(actual.ornaments) ? actual.ornaments : [];
      const visibleOrnaments = renderedOrnaments.filter((ornament) => ornament.visible === true);
      const renderedKeys = new Set(visibleOrnaments.map((ornament) => `${normalized(ornament.kind)}|${normalized(ornament.placement)}`));
      ornamentSummary = {
        planned: plannedOrnaments.length,
        rendered: visibleOrnaments.length,
        distinctRenderedKinds: new Set(visibleOrnaments.map((ornament) => normalized(ornament.kind)).filter(Boolean)).size,
      };
      for (const ornament of plannedOrnaments) {
        const key = `${normalized(ornament.kind)}|${normalized(ornament.placement)}`;
        const rendered = visibleOrnaments.find((item) => `${normalized(item.kind)}|${normalized(item.placement)}` === key);
        if (!renderedKeys.has(key)) pageIssues.push({
          code: 'DECORATION_PLAN_NOT_RENDERED',
          page: measurement.page,
          field: `pages[${index}].ornaments.${ornament.kind}`,
          expected: { kind: ornament.kind, placement: ornament.placement },
          message: `第 ${measurement.page} 页方案中的 ${ornament.kind} 装饰未以可见的 data-ornament / data-ornament-placement 元素呈现`,
        });
        else if (!ornamentPlacementMatches(rendered, Number(actual.width) || 0, Number(actual.height) || 0)) pageIssues.push({
          code: 'DECORATION_PLACEMENT_MISMATCH',
          page: measurement.page,
          field: `pages[${index}].ornaments.${ornament.kind}.placement`,
          expected: ornament.placement,
          actual: rendered.rect,
          message: `第 ${measurement.page} 页 ${ornament.kind} 装饰实际坐标 x=${Math.round(Number(rendered.rect?.x) || 0)}、y=${Math.round(Number(rendered.rect?.y) || 0)}、宽=${Math.round(Number(rendered.rect?.width) || 0)}、高=${Math.round(Number(rendered.rect?.height) || 0)}，不符合 ${ornament.placement} 区域；${placementGuide(ornament.placement, Number(actual.width) || 0, Number(actual.height) || 0)}`,
        });
        else if (rendered.textOverlaps?.length) pageIssues.push({
          code: 'DECORATION_TEXT_OVERLAP',
          page: measurement.page,
          field: `pages[${index}].ornaments.${ornament.kind}`,
          actual: rendered.textOverlaps,
          message: `第 ${measurement.page} 页 ${ornament.kind} 装饰与正文文字发生重叠；请移到留白区域，保证标题、正文和注释清晰可读`,
        });
      }
    }
    issues.push(...pageIssues);
    pageResults.push({ page: measurement.page, valid: pageIssues.length === 0, ornaments: ornamentSummary, issues: pageIssues });
  }

  if (!selectedPage && pageMeasurements.length === planPages.length && pageMeasurements.length >= 5) {
    const backgrounds = pageMeasurements.map(({ pageStyle = {} }) => `${normalized(pageStyle.backgroundColor)}|${normalized(pageStyle.backgroundImage)}`);
    const renderedBackgroundCount = new Set(backgrounds).size;
    if (renderedBackgroundCount < 2) {
      contract.warnings.push({ code: 'RENDERED_BACKGROUND_DIVERSITY_LOW', field: 'pages', message: 'HTML 实际渲染的页面背景/表面少于 2 种；仅在方案里标不同背景不算落实。此项为设计建议，不阻断交付' });
    }
    contract.diversity.renderedBackgrounds = renderedBackgroundCount;
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings: contract.warnings,
    diversity: contract.diversity,
    pages: pageResults,
    checkedPage: selectedPage || null,
  };
}
