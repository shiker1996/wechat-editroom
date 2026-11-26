import fs from 'node:fs';
import { probeHtmlLayout } from '../../../platform/browser/html-layout-probe.mjs';
import { compareSocialCardDesignToMeasurements } from './social-card-design-conformance.mjs';

const AUDIT_SELECTORS = Object.freeze(['.page-body', '.page-content-stack']);
const MAX_CONTENT_CENTER_OFFSET_PX = 18;

function inspectDocumentStructure(html, expectedPageCount) {
  const source = String(html || '');
  const pageRoots = [...source.matchAll(/<(section|div)\b[^>]*>/gi)]
    .filter(([tag]) => (tag.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2] || '').split(/\s+/).includes('page'))
    .map((match) => ({ tag: match[0], tagName: match[1], offset: match.index }));
  const actualPageCount = pageRoots.length;
  const pageNumbers = pageRoots.map(({ tag }) => tag.match(/\bdata-page\s*=\s*(["'])(.*?)\1/i)?.[2] || null);
  const markerMatches = [...source.matchAll(/<!--\s*CARD-PAGE:(\d+):(START|END)\s*-->/g)];
  const markers = markerMatches.map(([, page, edge]) => `${page}:${edge}`);
  const expectedMarkers = Array.from({ length: actualPageCount }, (_, index) => [`${index + 1}:START`, `${index + 1}:END`]).flat();
  const expectedCount = Number(expectedPageCount) || 0;
  const pageOrderValid = pageNumbers.every((page, index) => String(page) === String(index + 1));
  const markerSequenceValid = markers.length === expectedMarkers.length
    && expectedMarkers.every((marker, index) => markers[index] === marker);
  let previousPageEnd = -1;
  const pageAnchorsValid = markerSequenceValid && pageRoots.every(({ tagName, offset, tag }, index) => {
    const start = markerMatches[index * 2];
    const end = markerMatches[index * 2 + 1];
    const elementTags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
    elementTags.lastIndex = offset + tag.length;
    let depth = 1;
    let elementEnd = -1;
    let elementTag;
    while ((elementTag = elementTags.exec(source))) {
      if (/^<\//.test(elementTag[0])) depth -= 1;
      else if (!/\/>$/.test(elementTag[0])) depth += 1;
      if (depth === 0) {
        elementEnd = elementTags.lastIndex;
        break;
      }
    }
    // 相邻页面的 END 与下一页 START 可以首尾相接，位置相同也算按序包裹。
    const wrapped = start?.index >= previousPageEnd
      && start?.index < offset
      && elementEnd > offset
      && end?.index >= elementEnd;
    if (wrapped) previousPageEnd = end.index + end[0].length;
    return wrapped;
  });
  const countValid = actualPageCount > 0 && (!expectedCount || actualPageCount === expectedCount);
  return {
    actualPageCount,
    expectedPageCount: expectedCount || undefined,
    pageOrderValid,
    markerSequenceValid,
    pageAnchorsValid,
    countValid,
  };
}

export function auditSocialCardHtmlGroup({ htmlPath, expectedPageCount = 0 } = {}) {
  const result = {
    valid: false,
    status: 'error',
    pageCount: 0,
    pages: [],
    issues: [],
  };
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    result.issues.push({ code: 'HTML_MISSING', message: '找不到待审计的 AI 图文 HTML' });
    return result;
  }
  try {
    const structure = inspectDocumentStructure(fs.readFileSync(htmlPath, 'utf8'), expectedPageCount);
    result.pageCount = structure.actualPageCount;
    if (!structure.countValid || !structure.pageOrderValid || !structure.markerSequenceValid || !structure.pageAnchorsValid) {
      result.issues.push({
        code: 'DOCUMENT_STRUCTURE_INVALID',
        expected: { pageCount: structure.expectedPageCount, pageOrder: 'DOM 顺序与 data-page 一致', pageAnchors: '每页恰有一组有序起止锚点' },
        actual: { pageCount: structure.actualPageCount, pageOrderValid: structure.pageOrderValid, pageAnchorsValid: structure.pageAnchorsValid },
        message: '整份 HTML 的页面数量、页序或页面锚点结构不符合文档要求；此阶段不定位单页，也不做浏览器布局与方案兑现检查。请修正整份文档结构后重新做整组审计。',
      });
    }
    result.valid = result.issues.length === 0;
    result.status = result.valid ? 'passed' : 'blocked';
    return result;
  } catch (error) {
    result.issues.push({ code: 'AUDIT_FAILED', message: `整组文档结构审计失败：${error.message}` });
    return result;
  }
}

export async function auditSocialCardHtmlFit({ htmlPath, width = 375, height = 667, tolerancePx = 2, page: selectedPage = null, pageRoles = [], listPageItemCounts = [], minimumContentUtilization = 0.6, minimumListItemHeight = 32, designScheme = null, storyboardPages = [], expectedParadigmId = '', requireDesignScheme = false, includeContactSheet = false } = {}) {
  const result = {
    valid: false,
    status: 'error',
    canvas: { width: Number(width) || 375, height: Number(height) || 667 },
    pageCount: 0,
    pages: [],
    checkedSelectors: [...AUDIT_SELECTORS],
    issues: [],
  };

  if (!htmlPath || !fs.existsSync(htmlPath)) {
    result.issues.push({ code: 'HTML_MISSING', message: '找不到待审计的 AI 图文 HTML' });
    return result;
  }

  try {
    const measurements = await probeHtmlLayout({
      html: fs.readFileSync(htmlPath, 'utf8'),
      width: result.canvas.width,
      height: result.canvas.height,
      pageSelector: '.page',
      selectors: AUDIT_SELECTORS,
      selectedPage,
      includeContactSheet,
    });

    result.pageCount = measurements.length;
    for (const item of measurements) {
      const pageRole = pageRoles[item.page - 1] || item.pageStyle?.role || '';
      const pageReport = { page: item.page, role: pageRole || undefined, valid: true, containers: [], listMetrics: item.listMetrics || { itemCount: 0, averageItemHeight: 0, totalHeight: 0 } };
      const pageStyle = item.pageStyle || {};
      const styleProblems = [];
      const centerOffsetPx = Number(pageStyle.contentAlignment?.verticalCenterOffsetPx);
      if (Number.isFinite(centerOffsetPx) && Math.abs(centerOffsetPx) > MAX_CONTENT_CENTER_OFFSET_PX) {
        pageReport.valid = false;
        result.issues.push({
          code: 'CONTENT_NOT_CENTERED',
          page: item.page,
          actualOffsetPx: centerOffsetPx,
          allowedOffsetPx: MAX_CONTENT_CENTER_OFFSET_PX,
          message: `第 ${item.page} 页正文整体偏离可用区垂直中心 ${Math.round(Math.abs(centerOffsetPx))}px（允许 ${MAX_CONTENT_CENTER_OFFSET_PX}px）；请调整 page-body 或 page-content-stack 的垂直布局后复审`,
        });
      }
      if (Math.abs(Number(pageStyle.width) - result.canvas.width) > tolerancePx) styleProblems.push(`画布宽度应为 ${result.canvas.width}px，实测 ${Math.round(Number(pageStyle.width) || 0)}px`);
      if (Math.abs(Number(pageStyle.height) - result.canvas.height) > tolerancePx) styleProblems.push(`画布高度应为 ${result.canvas.height}px，实测 ${Math.round(Number(pageStyle.height) || 0)}px`);
      if (pageStyle.overflow !== 'hidden') styleProblems.push(`画布 overflow 应为 hidden，实测 ${pageStyle.overflow || '未设置'}`);
      if (pageStyle.innerDisplay !== 'flex') styleProblems.push(`页面内部布局应为 flex，实测 ${pageStyle.innerDisplay || '缺少 .page-inner'}`);
      pageReport.pageStyle = pageStyle;
      if (!designScheme && !requireDesignScheme) {
        const overlappingOrnaments = (Array.isArray(pageStyle.ornaments) ? pageStyle.ornaments : [])
          .filter((ornament) => ornament.visible && ornament.textOverlaps?.length);
        for (const ornament of overlappingOrnaments) {
          pageReport.valid = false;
          result.issues.push({
            code: 'DECORATION_TEXT_OVERLAP',
            page: item.page,
            field: `ornaments.${ornament.kind}`,
            actual: ornament.textOverlaps,
            message: `第 ${item.page} 页 ${ornament.kind} 装饰与可见文字相交；请移入留白或调整内容构图后复审`,
          });
        }
      }
      if (styleProblems.length) {
        pageReport.valid = false;
        result.issues.push({
          code: 'PAGE_STYLE_DEGRADED',
          page: item.page,
          message: `第 ${item.page} 页样式或画布布局缺失：${styleProblems.join('；')}`,
        });
      }
      for (const container of item.containers) {
        if (!container.visible) continue;
        const overflowX = Math.max(0, container.scrollWidth - container.clientWidth);
        const overflowY = Math.max(0, container.scrollHeight - container.clientHeight);
        pageReport.containers.push({
          selector: container.selector,
          clientWidth: container.clientWidth,
          clientHeight: container.clientHeight,
          scrollWidth: container.scrollWidth,
          scrollHeight: container.scrollHeight,
          overflowX,
          overflowY,
        });
        if (overflowX <= tolerancePx && overflowY <= tolerancePx) continue;
        pageReport.valid = false;
        result.issues.push({
          code: 'CONTENT_OVERFLOW',
          page: item.page,
          selector: container.selector,
          overflowX,
          overflowY,
          overflowMode: { x: container.overflowX, y: container.overflowY },
          message: `第 ${item.page} 页 ${container.selector} 内容超出可用区域${overflowY > tolerancePx ? ` ${overflowY}px（纵向）` : ''}${overflowX > tolerancePx ? ` ${overflowX}px（横向）` : ''}`,
        });
      }
      const body = item.containers.find((container) => container.selector === '.page-body' && container.visible);
      const content = item.containers.find((container) => container.selector === '.page-content-stack' && container.visible);
      if (body && content && body.clientHeight > 0) {
        pageReport.contentUtilization = Number((content.clientHeight / body.clientHeight).toFixed(3));
        const isContentPage = pageRole && !['cover', 'ending'].includes(String(pageRole).toLowerCase());
        if (isContentPage && pageReport.contentUtilization < minimumContentUtilization) {
          pageReport.valid = false;
          result.issues.push({
            code: 'CONTENT_DENSITY_LOW',
            page: item.page,
            contentUtilization: pageReport.contentUtilization,
            minimumContentUtilization,
            message: `第 ${item.page} 页内容区占用率为 ${Math.round(pageReport.contentUtilization * 100)}%，低于内容页 60% 下限；请放大已有事实的视觉表达、展开信息关系或调整组件布局，不要添加占位文案`,
          });
        }
      }
      if (pageReport.listMetrics.itemCount >= 3) {
        pageReport.listMetrics.averageItemHeight = Number(pageReport.listMetrics.averageItemHeight.toFixed(1));
        pageReport.listMetrics.minItemHeight = Number(pageReport.listMetrics.minItemHeight.toFixed(1));
        pageReport.listMetrics.totalHeight = Number(pageReport.listMetrics.totalHeight.toFixed(1));
      }
      const expectedListItems = Number(listPageItemCounts[item.page - 1]) || Number(pageStyle.listItemCount) || 0;
      if (expectedListItems > 0 && pageReport.listMetrics.itemCount < expectedListItems) {
        pageReport.valid = false;
        result.issues.push({
          code: 'LIST_ITEMS_UNMEASURED',
          page: item.page,
          expectedItemCount: expectedListItems,
          measuredItemCount: pageReport.listMetrics.itemCount,
          message: `第 ${item.page} 页故事板有 ${expectedListItems} 个列表/步骤条目，但 HTML 只标记了 ${pageReport.listMetrics.itemCount} 个可测条目；请使用 li、.step、.flow-card、.list-item 或 data-list-item 标记每个条目`,
        });
      } else if (pageReport.listMetrics.itemCount >= 3 && pageReport.listMetrics.minItemHeight < minimumListItemHeight) {
        pageReport.valid = false;
        result.issues.push({
          code: 'LIST_ITEMS_TOO_DENSE',
          page: item.page,
          expectedItemCount: expectedListItems,
          minItemHeight: pageReport.listMetrics.minItemHeight,
          minimumListItemHeight,
          message: `第 ${item.page} 页列表条目高度低于 ${minimumListItemHeight}px；请用分组、编号、对比或步骤轨道改善扫读层级`,
        });
      }
      result.pages.push(pageReport);
    }
    if (requireDesignScheme || designScheme) {
      const designConformance = compareSocialCardDesignToMeasurements({
        designScheme,
        storyboardPages,
        pageMeasurements: measurements,
        selectedPage,
        expectedParadigmId,
      });
      result.designConformance = designConformance;
      result.issues.push(...designConformance.issues);
    }
    if (measurements.previewImageBase64) result.previewImageBase64 = measurements.previewImageBase64;
    if (!result.pageCount) result.issues.push({
      code: selectedPage ? 'PAGE_NOT_FOUND' : 'NO_PAGES',
      page: Number(selectedPage) || undefined,
      message: selectedPage ? `AI 图文 HTML 中没有找到第 ${selectedPage} 页` : 'AI 图文 HTML 中没有找到 .page 页面',
    });
    result.valid = result.issues.length === 0;
    result.status = result.valid ? 'passed' : 'blocked';
    return result;
  } catch (error) {
    result.issues.push({ code: 'AUDIT_FAILED', message: `浏览器视觉适配审计失败：${error.message}` });
    return result;
  }
}
