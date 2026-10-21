export const EDITORIAL_CATEGORIES = Object.freeze([
  '产品与技术动态',
  '大厂与商业战略',
  '职场与组织变化',
  '开源项目与开发者生态',
  '行业趋势与市场变化',
  '政策与公共议题',
]);

const LEGACY_TOPIC_CATEGORY_MAP = Object.freeze({
  '🤖 AI/技术动态': '产品与技术动态',
  '🏢 大厂战略': '大厂与商业战略',
  '📈 行业趋势': '行业趋势与市场变化',
  '💼 职场生态': '职场与组织变化',
});

export function normalizeEditorialCategory(value, { repository = false, event = null } = {}) {
  if (event && isMultiSourceRepositoryEvent(event)) return '产品与技术动态';
  if (repository) return '开源项目与开发者生态';
  const category = String(value || '').trim();
  if (EDITORIAL_CATEGORIES.includes(category)) return category;
  return LEGACY_TOPIC_CATEGORY_MAP[category] || '';
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
