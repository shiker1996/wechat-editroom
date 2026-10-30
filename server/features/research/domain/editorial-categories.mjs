export const EDITORIAL_CATEGORIES = Object.freeze([
  '产品与技术动态',
  '大厂与商业战略',
  '职场与组织变化',
  '开源项目与开发者生态',
  '行业趋势与市场变化',
  '政策与公共议题',
]);

export const DEFAULT_EDITORIAL_CATEGORY_CONFIG = Object.freeze([
  { name: '产品与技术动态', description: '产品发布、技术变化与具体技术事件' },
  { name: '大厂与商业战略', description: '大厂业务布局、竞争、合作、收购与经营决策' },
  { name: '职场与组织变化', description: '岗位、薪酬、裁员、管理制度和工作方式变化' },
  { name: '开源项目与开发者生态', description: '开源项目、开发者社区和生态变化' },
  { name: '行业趋势与市场变化', description: '跨主体或跨时间的行业发展、市场结构与采用信号' },
  { name: '政策与公共议题', description: '监管、公共治理及对目标读者有明确影响的公共事件' },
]);

export function editorialCategoriesFor(context = {}) {
  const configured = Array.isArray(context?.editorialCategories) ? context.editorialCategories : [];
  const categories = configured.map((item) => typeof item === 'string' ? item.trim() : String(item?.name || '').trim())
    .filter(Boolean);
  return categories.length ? [...new Set(categories)] : [...EDITORIAL_CATEGORIES];
}

export function editorialCategoryConfigFor(context = {}) {
  const configured = Array.isArray(context?.editorialCategories) ? context.editorialCategories : [];
  const valid = configured.map((item) => typeof item === 'string'
    ? { name: item.trim(), description: item.trim() }
    : { name: String(item?.name || '').trim(), description: String(item?.description || '').trim() })
    .filter((item) => item.name);
  return valid.length ? valid : DEFAULT_EDITORIAL_CATEGORY_CONFIG.map((item) => ({ ...item }));
}

const LEGACY_TOPIC_CATEGORY_MAP = Object.freeze({
  '🤖 AI/技术动态': '产品与技术动态',
  '🏢 大厂战略': '大厂与商业战略',
  '📈 行业趋势': '行业趋势与市场变化',
  '💼 职场生态': '职场与组织变化',
});

export function normalizeEditorialCategory(value, { repository = false, event = null, categories = EDITORIAL_CATEGORIES } = {}) {
  if (event && isMultiSourceRepositoryEvent(event) && categories.includes('产品与技术动态')) return '产品与技术动态';
  if (repository) return '开源项目与开发者生态';
  const category = String(value || '').trim();
  if (categories.includes(category)) return category;
  const legacy = LEGACY_TOPIC_CATEGORY_MAP[category] || '';
  return categories.includes(legacy) ? legacy : category;
}

function repositoryArticles(event = {}) {
  return (Array.isArray(event.articles) ? event.articles : []).filter((article) => {
    const source = [article?.source, article?.channel, article?.source_group].map((value) => String(value || '').toLowerCase()).join(' ');
    const url = String(article?.url || '').toLowerCase();
    return source.includes('github') || /github\.com\//.test(url);
  });
}

function independentSourceCount(event = {}) {
  return new Set((Array.isArray(event.articles) ? event.articles : []).map((article) =>
    String(article?.source_group || article?.source || article?.channel || article?.url || '').trim().toLowerCase(),
  ).filter(Boolean)).size;
}

export function isMultiSourceRepositoryEvent(event = {}) {
  return repositoryArticles(event).length > 0 && independentSourceCount(event) > 1;
}

export function isRepositoryEvent(event = {}) {
  const articles = Array.isArray(event.articles) ? event.articles : [];
  if (articles.length) {
    return repositoryArticles(event).length === 1 && independentSourceCount(event) === 1;
  }
  const contentClass = String(event.contentClass || event.content_class || event.classification?.contentClass || event.classification?.content_class || event.classification_snapshot?.content_class || '');
  if (contentClass === 'github_project') return true;
  if (event.material_type === 'repository' || event.materialType === 'repository' || event.repositoryMeta || event.repository_meta) return true;
  return repositoryArticles(event).length === 1 || String(event.source_group || event.source_type || event.source || '').toLowerCase().includes('github') || /github\.com\//i.test(String(event.url || ''));
}
