const SCHEME_VERSION = 1;
const FIELD_LIMIT = 120;
const MARKER_FIELDS = ['composition', 'primaryVisual', 'backgroundMode', 'accentPlacement'];
const PAGE_MARKERS = Object.freeze({
  composition: 'visualComposition',
  primaryVisual: 'primaryVisual',
  backgroundMode: 'backgroundMode',
  accentPlacement: 'accentPlacement',
});

const clean = (value) => String(value ?? '').trim();
const normalized = (value) => clean(value).toLowerCase();
const isKey = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean(value));

function addTextIssue(issues, field, value, limit = FIELD_LIMIT) {
  const text = clean(value);
  if (!text || text.length > limit) issues.push({ code: 'DESIGN_SCHEME_FIELD_INVALID', field, message: `${field} 必须为 1–${limit} 个字符` });
}

function expectedRole(page) {
  return clean(page?.role || page?.kind || 'content');
}

export function validateExternalSocialCardDesignScheme({ designScheme, storyboardPages = [] } = {}) {
  const issues = [];
  if (!designScheme || typeof designScheme !== 'object' || Array.isArray(designScheme)) {
    return { valid: false, issues: [{ code: 'DESIGN_SCHEME_REQUIRED', field: 'designScheme', message: '必须提交结构化 designScheme，先完成视觉规划再生成 HTML' }] };
  }
  if (Number(designScheme.schemaVersion) !== SCHEME_VERSION) {
    issues.push({ code: 'DESIGN_SCHEME_VERSION_INVALID', field: 'schemaVersion', message: `designScheme.schemaVersion 必须为 ${SCHEME_VERSION}` });
  }

  const contentReading = designScheme.contentReading || {};
  for (const field of ['subject', 'narrative', 'readerFeeling', 'visualAnchor']) {
    addTextIssue(issues, `contentReading.${field}`, contentReading[field]);
  }

  const designLanguage = designScheme.designLanguage || {};
  for (const field of ['colorLogic', 'typography', 'shape', 'surface', 'graphics', 'imageTreatment']) {
    addTextIssue(issues, `designLanguage.${field}`, designLanguage[field]);
  }

  const sharedAnchors = Array.isArray(designScheme.sharedAnchors) ? designScheme.sharedAnchors : [];
  if (sharedAnchors.length < 2 || sharedAnchors.length > 3) {
    issues.push({ code: 'SHARED_ANCHOR_COUNT_INVALID', field: 'sharedAnchors', message: 'sharedAnchors 必须包含 2–3 个系列共用元素' });
  }
  const anchorIds = [];
  sharedAnchors.forEach((anchor, index) => {
    const id = clean(anchor?.id);
    if (!isKey(id)) issues.push({ code: 'SHARED_ANCHOR_ID_INVALID', field: `sharedAnchors[${index}].id`, message: '共用元素 id 必须是 kebab-case 字母、数字或连字符' });
    addTextIssue(issues, `sharedAnchors[${index}].description`, anchor?.description);
    anchorIds.push(id);
  });
  if (new Set(anchorIds).size !== anchorIds.length) {
    issues.push({ code: 'SHARED_ANCHOR_ID_DUPLICATE', field: 'sharedAnchors', message: '共用元素 id 不能重复' });
  }

  const pages = Array.isArray(designScheme.pageLanguage) ? designScheme.pageLanguage : [];
  if (!Array.isArray(storyboardPages) || pages.length !== storyboardPages.length) {
    issues.push({ code: 'DESIGN_PAGE_COUNT_MISMATCH', field: 'pageLanguage', message: `pageLanguage 必须与已锁定故事板页数一致（${storyboardPages.length} 页）` });
  }
  pages.forEach((page, index) => {
    const label = `pageLanguage[${index}]`;
    if (Number(page?.page) !== index + 1) issues.push({ code: 'DESIGN_PAGE_NUMBER_INVALID', page: index + 1, field: `${label}.page`, message: `第 ${index + 1} 页规划的 page 值必须为 ${index + 1}` });
    if (clean(page?.role) !== expectedRole(storyboardPages[index])) {
      issues.push({ code: 'DESIGN_PAGE_ROLE_MISMATCH', page: index + 1, field: `${label}.role`, message: `第 ${index + 1} 页 role 必须与锁定故事板一致（${expectedRole(storyboardPages[index])}）` });
    }
    addTextIssue(issues, `${label}.visualPurpose`, page?.visualPurpose);
    for (const field of MARKER_FIELDS) {
      if (!isKey(page?.[field])) issues.push({ code: 'DESIGN_PAGE_MARKER_INVALID', page: index + 1, field: `${label}.${field}`, message: `第 ${index + 1} 页 ${field} 必须是简短 kebab-case 标记，便于和 HTML 实际页面核对` });
    }
  });

  if (pages.length >= 5) {
    const compositionCount = new Set(pages.map((page) => normalized(page?.composition)).filter(Boolean)).size;
    const backgroundCount = new Set(pages.map((page) => normalized(page?.backgroundMode)).filter(Boolean)).size;
    if (compositionCount < 3) issues.push({ code: 'DESIGN_COMPOSITION_DIVERSITY_LOW', field: 'pageLanguage', message: '5 页及以上至少需要 3 种不同构图/主视觉媒介' });
    if (backgroundCount < 2) issues.push({ code: 'DESIGN_BACKGROUND_DIVERSITY_LOW', field: 'pageLanguage', message: '5 页及以上至少需要 2 种背景或表面处理' });
    for (let index = 1; index < pages.length; index += 1) {
      const previous = pages[index - 1];
      const current = pages[index];
      if (normalized(previous?.composition) === normalized(current?.composition)) {
        issues.push({ code: 'ADJACENT_COMPOSITION_REPEATED', page: index + 1, field: `pageLanguage[${index}].composition`, message: `第 ${index} 页与上一页重复同一构图标记` });
      }
      if (normalized(previous?.primaryVisual) === normalized(current?.primaryVisual)) {
        issues.push({ code: 'ADJACENT_PRIMARY_VISUAL_REPEATED', page: index + 1, field: `pageLanguage[${index}].primaryVisual`, message: `第 ${index} 页与上一页重复同一主视觉标记` });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    diversity: {
      pageCount: pages.length,
      distinctCompositions: new Set(pages.map((page) => normalized(page?.composition)).filter(Boolean)).size,
      distinctPrimaryVisuals: new Set(pages.map((page) => normalized(page?.primaryVisual)).filter(Boolean)).size,
      distinctBackgroundModes: new Set(pages.map((page) => normalized(page?.backgroundMode)).filter(Boolean)).size,
      sharedAnchorCount: sharedAnchors.length,
    },
  };
}

export function compareExternalSocialCardDesignToMeasurements({ designScheme, storyboardPages = [], pageMeasurements = [], selectedPage = null } = {}) {
  const contract = validateExternalSocialCardDesignScheme({ designScheme, storyboardPages });
  const issues = [...contract.issues];
  const anchors = (Array.isArray(designScheme?.sharedAnchors) ? designScheme.sharedAnchors : []).map((anchor) => clean(anchor?.id)).filter(Boolean);
  const planPages = Array.isArray(designScheme?.pageLanguage) ? designScheme.pageLanguage : [];
  const pageResults = [];

  if (!selectedPage && pageMeasurements.length !== planPages.length) {
    issues.push({ code: 'RENDERED_PAGE_COUNT_MISMATCH', field: 'pageLanguage', expected: planPages.length, actual: pageMeasurements.length, message: `HTML 实际页面数（${pageMeasurements.length}）必须与视觉方案/故事板一致（${planPages.length}）` });
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
      issues.push({ code: 'RENDERED_BACKGROUND_DIVERSITY_LOW', field: 'pageLanguage', message: 'HTML 实际渲染的页面背景/表面少于 2 种；仅在方案里标不同背景不算落实' });
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
