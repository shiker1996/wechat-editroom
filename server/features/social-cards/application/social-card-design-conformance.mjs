import { validateSocialCardDesignScheme } from './social-card-design-scheme-contract.mjs';
export { validateSocialCardDesignScheme };

const clean = (value) => String(value ?? '').trim();
const normalized = (value) => clean(value).toLowerCase();

function ornamentDiagnostic(ornament) {
  return Object.fromEntries(['tag', 'className', 'kind', 'placement', 'visible', 'hasVisualTreatment', 'ancestorsVisible', 'display', 'visibility', 'opacity', 'rect', 'clippedRect']
    .filter((key) => ornament?.[key] !== undefined)
    .map((key) => [key, ornament[key]]));
}

function ornamentSpaceOptions(ornament, contentRegion, gapPx = 8) {
  const obstacle = ornament?.rect;
  const stack = contentRegion?.stack;
  if (![obstacle?.x, obstacle?.y, obstacle?.width, obstacle?.height, stack?.x, stack?.y, stack?.width, stack?.height].every((value) => Number.isFinite(Number(value)))) return null;
  const contentRight = Number(stack.x) + Number(stack.width);
  const contentBottom = Number(stack.y) + Number(stack.height);
  const obstacleRight = Number(obstacle.x) + Number(obstacle.width);
  const obstacleBottom = Number(obstacle.y) + Number(obstacle.height);
  const intersection = {
    x: Math.max(Number(stack.x), Number(obstacle.x)),
    y: Math.max(Number(stack.y), Number(obstacle.y)),
    width: Math.max(0, Math.min(contentRight, obstacleRight) - Math.max(Number(stack.x), Number(obstacle.x))),
    height: Math.max(0, Math.min(contentBottom, obstacleBottom) - Math.max(Number(stack.y), Number(obstacle.y))),
  };
  if (intersection.width <= 0 || intersection.height <= 0) return null;
  const leftWidth = Math.max(0, Number(obstacle.x) - gapPx - Number(stack.x));
  const rightX = obstacleRight + gapPx;
  const rightWidth = Math.max(0, contentRight - rightX);
  const aboveHeight = Math.max(0, Number(obstacle.y) - gapPx - Number(stack.y));
  const belowY = obstacleBottom + gapPx;
  const belowHeight = Math.max(0, contentBottom - belowY);
  const roundedRect = (x, y, width, height) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  return {
    contentRect: roundedRect(Number(stack.x), Number(stack.y), Number(stack.width), Number(stack.height)),
    obstacleRect: roundedRect(Number(obstacle.x), Number(obstacle.y), Number(obstacle.width), Number(obstacle.height)),
    intersectionRect: roundedRect(intersection.x, intersection.y, intersection.width, intersection.height),
    gapPx,
    options: {
      left: roundedRect(Number(stack.x), Number(stack.y), leftWidth, Number(stack.height)),
      right: roundedRect(rightX, Number(stack.y), rightWidth, Number(stack.height)),
      above: roundedRect(Number(stack.x), Number(stack.y), Number(stack.width), aboveHeight),
      below: roundedRect(Number(stack.x), belowY, Number(stack.width), belowHeight),
    },
  };
}

function missingOrnamentMessage(page, planned, candidates) {
  if (!candidates.length) return `第 ${page} 页方案要求 ${planned.kind} 装饰放在 ${planned.placement}，但页面中未找到带 data-ornament="${planned.kind}" 的元素；请添加标记正确且实际可见的元素。`;
  const expectedPlacementExists = candidates.some((item) => normalized(item.placement) === normalized(planned.placement));
  if (!expectedPlacementExists) {
    const actualPlacements = [...new Set(candidates.map((item) => item.placement || '未设置'))].join('、');
    return `第 ${page} 页找到了 ${planned.kind} 装饰，但 data-ornament-placement 实测为「${actualPlacements}」，方案要求「${planned.placement}」；请修正标记并确认元素位于规划区域。`;
  }
  const matching = candidates.filter((item) => normalized(item.placement) === normalized(planned.placement));
  const diagnostics = matching.slice(0, 3).map((item) => {
    const rect = item.clippedRect || item.rect || {};
    return `${item.tag || '元素'}${item.className ? `.${item.className.split(/\s+/).join('.')}` : ''}：可见=${item.visible === true}、视觉样式=${item.hasVisualTreatment === true}、祖先可见=${item.ancestorsVisible !== false}、display=${item.display || '未知'}、visibility=${item.visibility || '未知'}、opacity=${Number.isFinite(Number(item.opacity)) ? Number(item.opacity) : '未知'}、画布内矩形=${Math.round(Number(rect.x) || 0)},${Math.round(Number(rect.y) || 0)} ${Math.round(Number(rect.width) || 0)}×${Math.round(Number(rect.height) || 0)}`;
  }).join('；');
  return `第 ${page} 页找到了带正确标记的 ${planned.kind} 装饰，但浏览器没有将其判定为可见。data-ornament 标记本身不算装饰已呈现；元素须有可见视觉样式、有效尺寸并落在画布内。实测候选：${diagnostics}。请修复这些候选元素，不要只添加无样式占位元素。`;
}

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
      const candidateDiagnostics = renderedOrnaments.map(ornamentDiagnostic);
      const renderedKeys = new Set(visibleOrnaments.map((ornament) => `${normalized(ornament.kind)}|${normalized(ornament.placement)}`));
      ornamentSummary = {
        planned: plannedOrnaments.length,
        rendered: visibleOrnaments.length,
        distinctRenderedKinds: new Set(visibleOrnaments.map((ornament) => normalized(ornament.kind)).filter(Boolean)).size,
      };
      for (const ornament of plannedOrnaments) {
        const key = `${normalized(ornament.kind)}|${normalized(ornament.placement)}`;
        const rendered = visibleOrnaments.find((item) => `${normalized(item.kind)}|${normalized(item.placement)}` === key);
        if (!renderedKeys.has(key)) {
          const candidates = renderedOrnaments.filter((item) => normalized(item.kind) === normalized(ornament.kind));
          pageIssues.push({
            code: 'DECORATION_PLAN_NOT_RENDERED',
            page: measurement.page,
            field: `pages[${index}].ornaments.${ornament.kind}`,
            expected: { kind: ornament.kind, placement: ornament.placement },
            actual: { candidateCount: candidates.length, candidates: candidates.slice(0, 3).map(ornamentDiagnostic), ornamentsOnPage: candidateDiagnostics.length },
            message: missingOrnamentMessage(measurement.page, ornament, candidates),
          });
        }
        else {
          const spaceOptions = ornamentSpaceOptions(rendered, actual.contentRegion);
          if (!ornamentPlacementMatches(rendered, Number(actual.width) || 0, Number(actual.height) || 0)) pageIssues.push({
            code: 'DECORATION_PLACEMENT_MISMATCH',
            page: measurement.page,
            field: `pages[${index}].ornaments.${ornament.kind}.placement`,
            expected: ornament.placement,
            actual: {
              ...ornamentDiagnostic(rendered),
              ...(spaceOptions ? { contentRegion: actual.contentRegion, spaceOptions } : {}),
            },
            message: `第 ${measurement.page} 页 ${ornament.kind} 装饰实际坐标 x=${Math.round(Number(rendered.rect?.x) || 0)}、y=${Math.round(Number(rendered.rect?.y) || 0)}、宽=${Math.round(Number(rendered.rect?.width) || 0)}、高=${Math.round(Number(rendered.rect?.height) || 0)}，不符合 ${ornament.placement} 区域；${placementGuide(ornament.placement, Number(actual.width) || 0, Number(actual.height) || 0)}${spaceOptions ? `；装饰与正文区域相交，建议同步调整正文版心，实际相交框 ${JSON.stringify(spaceOptions.intersectionRect)}，可选正文区域见 actual.spaceOptions.options` : ''}`,
          });
          if (rendered.textOverlaps?.length) pageIssues.push({
            code: 'DECORATION_TEXT_OVERLAP',
            page: measurement.page,
            field: `pages[${index}].ornaments.${ornament.kind}`,
            actual: {
              ornament: ornamentDiagnostic(rendered),
              contentRegion: actual.contentRegion,
              overlapCount: rendered.textOverlaps.length,
              overlaps: rendered.textOverlaps.slice(0, 4),
              ...(spaceOptions ? { spaceOptions } : {}),
            },
            message: `第 ${measurement.page} 页 ${ornament.kind} 装饰与正文文字相交；实测正文区域、装饰区域和安全版心选项已附在 actual 中。请同步重排正文容器，为装饰预留宽度或高度；若可用区域无法容纳正文，再移动或缩小装饰，不要只把装饰平移到另一段文字上。`,
          });
        }
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
