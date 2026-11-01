const RETIRED_THEME_PREFIXES = ['/api/themes', '/api/social/template-proposals'];

export async function handleThemeRoutes({ response, pathname, json }) {
  if (!RETIRED_THEME_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }

  json(response, 410, {
    error: '固定视觉主题与模板提案已停用；请在每次图文生成时使用 AI 视觉设计方案',
  });
  return true;
}
