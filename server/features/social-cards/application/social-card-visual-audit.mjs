import fs from 'node:fs';
import { probeHtmlLayout } from '../../../platform/browser/html-layout-probe.mjs';
import { compareExternalSocialCardDesignToMeasurements } from './social-card-external-visual-contract.mjs';

const AUDIT_SELECTORS = Object.freeze(['.page-body', '.page-content-stack']);

export async function auditSocialCardHtmlFit({ htmlPath, width = 375, height = 667, tolerancePx = 2, page: selectedPage = null, pageRoles = [], listPageItemCounts = [], minimumContentUtilization = 0.6, minimumListItemHeight = 32, designScheme = null, storyboardPages = [], requireDesignScheme = false, includeContactSheet = false } = {}) {
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
      if (Math.abs(Number(pageStyle.width) - result.canvas.width) > tolerancePx) styleProblems.push(`画布宽度应为 ${result.canvas.width}px，实测 ${Math.round(Number(pageStyle.width) || 0)}px`);
      if (Math.abs(Number(pageStyle.height) - result.canvas.height) > tolerancePx) styleProblems.push(`画布高度应为 ${result.canvas.height}px，实测 ${Math.round(Number(pageStyle.height) || 0)}px`);
      if (pageStyle.overflow !== 'hidden') styleProblems.push(`画布 overflow 应为 hidden，实测 ${pageStyle.overflow || '未设置'}`);
      if (pageStyle.innerDisplay !== 'flex') styleProblems.push(`页面内部布局应为 flex，实测 ${pageStyle.innerDisplay || '缺少 .page-inner'}`);
      pageReport.pageStyle = pageStyle;
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
      const designConformance = compareExternalSocialCardDesignToMeasurements({
        designScheme,
        storyboardPages,
        pageMeasurements: measurements,
        selectedPage,
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
