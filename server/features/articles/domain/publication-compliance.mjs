const HIGH_IMPACT_DEFINITIONS = Object.freeze([
  { category: 'financial', label: '财经/资本市场', pattern: /IPO|上市|估值|融资|募资|市值|破产|债务|清算|投资回报|回购/i },
  { category: 'reputation', label: '名誉/负面指控', pattern: /诈骗|造假|违法|违规|骗局|跑路|欺诈|行贿|贿赂|侵占|偷税|割韭菜|压榨|剥削|性骚扰|霸凌|犯罪/i },
  { category: 'employment_legal', label: '劳动权益/福利资格', pattern: /失业金|失业保险|福利资格|法定资格|领不到|无权领取|劳动权益|劳动权利|失去.{0,8}资格/i },
  { category: 'sensitive_event', label: '伤害/敏感事件', pattern: /伤亡|死亡|自杀|事故|灾难|暴力|未成年人|个人隐私|隐私泄露/i },
  { category: 'sensational', label: '绝对化/煽动性表述', pattern: /最后一次|梦碎|彻底失败|必然|一定会|注定|崩盘|毁灭|惊天|实锤/i },
]);

const NUMBER_PATTERN = /\d+(?:\.\d+)?\s*(?:万亿美元|亿美元|万亿|亿元|万元|万美元|人民币|元|亿|美元|万人|人次|人|个月|周|天|年|次|%|％)/g;
const US_STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];
const US_STATE_ALIASES = Object.freeze({ California: ['加利福尼亚州','加利福尼亚','加州'], 'New York': ['纽约州'], Washington: ['华盛顿州'], Texas: ['得克萨斯州','德克萨斯州','德州'], Florida: ['佛罗里达州'], Illinois: ['伊利诺伊州'], Massachusetts: ['马萨诸塞州'], 'New Jersey': ['新泽西州'], 'North Carolina': ['北卡罗来纳州'], 'South Carolina': ['南卡罗来纳州'], Virginia: ['弗吉尼亚州'], Pennsylvania: ['宾夕法尼亚州'], Ohio: ['俄亥俄州'], Georgia: ['佐治亚州'], Hawaii: ['夏威夷州'], Nevada: ['内华达州'], Oregon: ['俄勒冈州'], Michigan: ['密歇根州'], Minnesota: ['明尼苏达州'], Colorado: ['科罗拉多州'], Arizona: ['亚利桑那州'], Alabama: ['阿拉巴马州'], Alaska: ['阿拉斯加州'], Arkansas: ['阿肯色州'], Connecticut: ['康涅狄格州'], Delaware: ['特拉华州'], Idaho: ['爱达荷州'], Indiana: ['印第安纳州'], Iowa: ['艾奥瓦州','爱荷华州'], Kansas: ['堪萨斯州'], Kentucky: ['肯塔基州'], Louisiana: ['路易斯安那州'], Maine: ['缅因州'], Maryland: ['马里兰州'], Mississippi: ['密西西比州'], Missouri: ['密苏里州'], Montana: ['蒙大拿州'], Nebraska: ['内布拉斯加州'], 'New Hampshire': ['新罕布什尔州'], 'New Mexico': ['新墨西哥州'], 'North Dakota': ['北达科他州'], Oklahoma: ['俄克拉何马州'], 'Rhode Island': ['罗得岛州'], 'South Dakota': ['南达科他州'], Tennessee: ['田纳西州'], Utah: ['犹他州'], Vermont: ['佛蒙特州'], 'West Virginia': ['西弗吉尼亚州'], Wisconsin: ['威斯康星州'], Wyoming: ['怀俄明州'] });

function text(value) { return String(value ?? '').trim(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function normalizedSourceKey(item) {
  return text(item?.sourceGroupId || item?.source_group_id || item?.sourceUrl || item?.source_url || item?.sourceTitle || item?.source_title || item?.sourceType || item?.source_type).toLowerCase();
}

function sourceLevelOf(item) {
  const explicit = text(item?.sourceLevel || item?.source_level || item?.level);
  if (explicit) return explicit;
  const source = `${text(item?.sourceType || item?.source_type || item?.type)} ${text(item?.sourceUrl || item?.source_url || item?.url)}`.toLowerCase();
  if (/x\.com|twitter|个人|social|社交/.test(source)) return 'personal_social';
  if (/github|arxiv|paper|技术文档|technical/.test(source)) return 'technical_primary';
  if (/官方|公告|财报|政府|监管|official|\.gov(?:\.|\/|$)|\.gov\.\w{2,}/.test(source)) return 'official';
  if (/媒体|news|报|记者|reliable/.test(source)) return 'reliable_media';
  return explicit || 'community';
}

export function extractArticleTitle(article = '') {
  return text(text(article).match(/^#\s+(.+)$/m)?.[1] || '');
}

function claimText(item) {
  if (typeof item === 'string') return text(item);
  return text(item?.claim || item?.text || item?.statement);
}

function claimsOf(factBase = {}) {
  return Array.isArray(factBase?.claims) ? factBase.claims : [];
}

function verifiedClaims(factBase = {}) {
  return claimsOf(factBase).filter((item) => item && item.status === 'verified');
}

function normalizedClaimCorpus(factBase = {}) {
  return verifiedClaims(factBase).map(claimText).filter(Boolean).join('\n').replace(/\s+/g, '');
}

function numberTokens(value) {
  return [...text(value).matchAll(NUMBER_PATTERN)].map((match) => text(match[0]).replace(/\s+/g, ''));
}

function hasStateJurisdiction(value) {
  const normalized = text(value).toLowerCase();
  return US_STATES.some((state) => normalized.includes(state.toLowerCase()) || (US_STATE_ALIASES[state] || []).some((alias) => normalized.includes(alias.toLowerCase())));
}

function titleNamesState(title, jurisdiction) {
  const normalizedTitle = text(title).toLowerCase();
  const normalizedJurisdiction = text(jurisdiction).toLowerCase();
  const state = US_STATES.find((name) => normalizedJurisdiction.includes(name.toLowerCase()) || (US_STATE_ALIASES[name] || []).some((alias) => normalizedJurisdiction.includes(alias.toLowerCase())));
  return Boolean(state && (normalizedTitle.includes(state.toLowerCase()) || (US_STATE_ALIASES[state] || []).some((alias) => normalizedTitle.includes(alias.toLowerCase()))));
}

function isLegalAuthoritySource(source) {
  const level = sourceLevelOf(source);
  let host = '';
  try { host = new URL(text(source?.sourceUrl || source?.source_url || source?.url)).hostname.toLowerCase(); } catch { return false; }
  const publicAuthorityHost = /(?:^|\.)gov(?:\.|$)|\.ca\.gov$|\.gc\.ca$|\.gov\.uk$|\.gov\.au$|\.gov\.in$|\.leginfo\./.test(host);
  return publicAuthorityHost && ['legal_primary', 'official'].includes(level);
}

function legalJurisdictionComplete(item, claim = claimText(item)) {
  const jurisdiction = text(item?.jurisdiction || item?.scope || item?.applicableRegion || item?.applicable_region);
  if (!jurisdiction) return false;
  if (/失业金|失业保险/.test(claim) && /美国|united states|\busa\b/i.test(jurisdiction)) return hasStateJurisdiction(jurisdiction);
  return true;
}

export function enrichFactBaseClaims(factBase = {}, { citationPolicy = 'cluster' } = {}) {
  const claims = claimsOf(factBase);
  const groups = new Map();
  return {
    ...factBase,
    claims: claims.map((item, index) => {
      const sourceKey = normalizedSourceKey(item) || `claim-${index + 1}`;
      if (!groups.has(sourceKey)) groups.set(sourceKey, `source-group-${groups.size + 1}`);
      const status = text(item?.status || (typeof item === 'string' ? 'unverified' : 'unverified')) || 'unverified';
      const sourceLevel = sourceLevelOf(item);
      const sourceUrl = text(item?.sourceUrl || item?.source_url);
      const evidenceKind = text(item?.evidenceKind || item?.evidence_kind) || (status === 'opinion' ? 'author_material' : 'source_observation');
      return {
        ...(typeof item === 'object' && item ? item : { claim: item }),
        source_group_id: text(item?.sourceGroupId || item?.source_group_id) || groups.get(sourceKey),
        source_level: sourceLevel,
        evidence_kind: evidenceKind,
        attribution_required: item?.attributionRequired ?? item?.attribution_required ?? Boolean(sourceUrl || sourceLevel === 'personal_social'),
        visible_citation: citationPolicy,
      };
    }),
  };
}

export function buildPublicationClaimRegister(factBase = {}, { citationPolicy = 'cluster' } = {}) {
  return enrichFactBaseClaims(factBase, { citationPolicy }).claims.map((item, index) => {
    const claim = claimText(item);
    const status = text(item?.status || (typeof item === 'string' ? 'unverified' : 'unverified')) || 'unverified';
    return {
      id: text(item?.id) || `claim-${index + 1}`,
      claim,
      status,
      evidence: text(item?.evidence),
      sourceUrl: text(item?.sourceUrl || item?.source_url),
      sources: Array.isArray(item?.sources) ? item.sources.map((source) => ({
        url: text(source?.url || source?.sourceUrl || source?.source_url),
        title: text(source?.title || source?.sourceTitle || source?.source_title),
        type: text(source?.type || source?.sourceType || source?.source_type),
        level: text(source?.level || source?.sourceLevel || source?.source_level),
        publishedAt: text(source?.publishedAt || source?.published_at),
        sourceGroupId: text(source?.sourceGroupId || source?.source_group_id),
      })).filter((source) => source.url || source.title) : [],
      sourceTitle: text(item?.sourceTitle || item?.source_title),
      sourceType: text(item?.sourceType || item?.source_type),
      publishedAt: text(item?.publishedAt || item?.published_at),
      boundary: text(item?.boundary),
      jurisdiction: text(item?.jurisdiction || item?.scope || item?.applicableRegion || item?.applicable_region),
      period: text(item?.period || item?.referencePeriod || item?.reference_period),
      denominator: text(item?.denominator),
      keyNumber: Boolean(item?.keyNumber || item?.key_number),
      sourceGroupId: text(item?.sourceGroupId || item?.source_group_id) || `source-group-${index + 1}`,
      sourceLevel: sourceLevelOf(item),
      evidenceKind: text(item?.evidenceKind || item?.evidence_kind) || 'source_observation',
      attributionRequired: item?.attributionRequired ?? item?.attribution_required ?? Boolean(item?.sourceUrl),
      visibleCitation: text(item?.visibleCitation || item?.visible_citation) || citationPolicy,
      publicationRule: status === 'verified'
        ? '可作为已核实事实表述，并准确归因来源'
        : status === 'opinion'
          ? '作为作者观点呈现；仅在关键事实前提被已核实事实反驳时才削弱'
          : '准确归属为来源说法；核验状态留在记录中，不自动扩写成免责声明',
    };
  }).filter((item) => item.claim);
}

export function publicationFactBaseIssues(factBase = {}) {
  return claimsOf(factBase).filter((item) => {
    if (!item || item.status !== 'verified') return false;
    const claim = claimText(item);
    const legalEmployment = HIGH_IMPACT_DEFINITIONS.some((definition) => definition.category === 'employment_legal' && definition.pattern.test(claim));
    const keyNumber = Boolean(item.keyNumber || item.key_number);
    const highImpact = legalEmployment || keyNumber || HIGH_IMPACT_DEFINITIONS.some((definition) => ['financial', 'reputation', 'sensitive_event'].includes(definition.category) && definition.pattern.test(claim));
    if (!highImpact) return false;
    const sources = [item, ...(Array.isArray(item.sources) ? item.sources : [])];
    const hasTraceableSource = sources.some((source) => text(source?.sourceUrl || source?.source_url || source?.url));
    const hasOfficialSource = sources.some(isLegalAuthoritySource);
    if (legalEmployment) {
      return !hasTraceableSource || !hasOfficialSource || !legalJurisdictionComplete(item, claim);
    }
    if (keyNumber && !hasTraceableSource) return true;
    if (keyNumber && /%|％|百分之/.test(claim) && !text(item.denominator || item.boundary)) return true;
    const sourceType = text(item.sourceType || item.source_type);
    const evidence = text(item.evidence);
    return !hasTraceableSource && !/用户提供|内部材料/.test(`${sourceType} ${evidence}`);
  }).map((item) => {
    const claim = claimText(item);
    const legal = HIGH_IMPACT_DEFINITIONS.some((definition) => definition.category === 'employment_legal' && definition.pattern.test(claim));
    return legal
      ? `劳动权益/福利资格事实“${claim}”要标为 verified，必须登记可追溯的官方或法律原始来源及适用地区（美国失业保险须具体到州）；否则应降为 attributed/unverified`
      : (item.keyNumber || item.key_number) && /%|％|百分之/.test(claim) && !text(item.denominator || item.boundary)
        ? `关键比例“${claim}”已标为 verified，但缺少分母/统计口径`
      : `高影响事实“${claim}”已标为 verified，但没有直接来源 URL`;
  });
}

export function scanPublicationRisk({ article = '', title = '', factBase = {} } = {}) {
  const articleText = text(article);
  const titleText = text(title) || extractArticleTitle(articleText);
  const leadText = articleText.split(/\n\s*\n/).slice(0, 3).join('\n').slice(0, 700);
  const verifiedCorpus = normalizedClaimCorpus(factBase);
  const indicators = [];

  for (const region of [
    { name: 'title', value: titleText },
    { name: 'lead', value: leadText },
    { name: 'body', value: articleText },
  ]) {
    for (const definition of HIGH_IMPACT_DEFINITIONS) {
      if (!definition.pattern.test(region.value)) continue;
      indicators.push({ region: region.name, category: definition.category, label: definition.label });
    }
  }

  const titleNumbers = numberTokens(titleText);
  const unsupportedTitleNumbers = titleNumbers.filter((value) => !verifiedCorpus.includes(value));
  const titleDefinitions = HIGH_IMPACT_DEFINITIONS.filter((definition) => definition.pattern.test(titleText));
  const legalTitle = titleDefinitions.some((definition) => definition.category === 'employment_legal');
  const legalClaims = claimsOf(factBase).filter((item) => HIGH_IMPACT_DEFINITIONS.some((definition) => definition.category === 'employment_legal' && definition.pattern.test(claimText(item))));
  const legalTitleSupported = legalClaims.some((item) => {
    if (item?.status !== 'verified') return false;
    const sources = [item, ...(Array.isArray(item.sources) ? item.sources : [])];
    const jurisdiction = item.jurisdiction || item.scope || item.applicableRegion || item.applicable_region;
    const jurisdictionCovered = legalJurisdictionComplete(item) && (!/失业金|失业保险/.test(claimText(item)) || !/美国|united states|\busa\b/i.test(text(jurisdiction)) || titleNamesState(titleText, jurisdiction));
    return jurisdictionCovered && sources.some(isLegalAuthoritySource);
  });
  const unsupportedTitleCategories = titleDefinitions
    .filter((definition) => !verifiedCorpus || !definition.pattern.test(verifiedCorpus))
    .map((definition) => definition.category);

  const titleBlockers = unique([
    ...unsupportedTitleNumbers.map((value) => `标题数字“${value}”未出现在已核验事实中`),
    ...unsupportedTitleCategories
      .filter((category) => category === 'financial' || category === 'reputation')
      .map((category) => `标题包含${category === 'financial' ? '财经/资本市场' : '名誉负面'}高影响主张，但事实基座没有对应已核验事实`),
    ...(legalTitle && !legalTitleSupported ? ['联网事实核验没有找到与标题适用范围匹配的官方或法律原始依据；应改为准确归因或收窄结论'] : []),
  ]);

  return {
    title: titleText,
    categories: unique(indicators.map((item) => item.category)),
    indicators: indicators.slice(0, 24),
    titleNumbers,
    unsupportedTitleNumbers,
    titleBlockers,
    requiresModelReview: indicators.length > 0,
    requiresHumanConfirmation: titleDefinitions.some((definition) => ['financial', 'reputation', 'sensitive_event', 'employment_legal'].includes(definition.category)),
  };
}

export function publicationCompliancePrompt({ factBase = {}, claimRegister = [], scan = {}, writingStance = 'analysis', citationPolicy = 'cluster' } = {}) {
  return `发布合规专项要求：
- 当前写作立场为 ${writingStance}，内部引用策略为 ${citationPolicy}。事实基座和主张登记是核验起点；使用联网搜索核验影响标题、核心结论和读者行动的事实，并将真实找到的证据及来源写入 evidence_checks。事实状态留在核验记录中，不自动扩写成正文限定。
- 区分客观事实、来源转述和作者观点。可追溯来源支持的报道应准确归属一次；未核实不等于错误，也不要求反复声明“尚未确认”。同一来源支撑的连续事实可在首次出现时归因。
- 作者可以基于事实提出解释和因果判断。只有观点的关键事实前提被已核实事实直接反驳或明确证伪时，才建议弱化或删除；缺少直接因果证据、存在其他解释、语气鲜明，都不构成反证。
- 核验关键数字、统计期间、范围和适用时的分母。劳动权益、失业保险、福利资格及法律性质等客观法律主张，写明适用辖区并通过本次联网搜索核对该辖区的官方或法律原始来源；无法核实时，将具体事实作为准确归属的来源说法，不能包装成已核实的法律结论。
- 标题、摘要和前 200 字单独审核；正文中的限定语不能自动修复一个把未经支持的事实写成确定结论的标题。检查隐私、名誉、法律、金融误导及版权风险。

程序风险扫描（只作为需要重点核查的信号，不是程序对文章的最终定性）：
${JSON.stringify(scan)}

可用的事实主张登记：
${JSON.stringify(claimRegister)}

请把需要处理的问题写入门禁 issues，并区分：publication_compliance、fact、title、citation、reputation、financial、privacy、copyright。只有事实被已核实来源直接反驳、来源说法被误写成确定事实、标题作出未经支持的高影响事实承诺，或存在明确的法律/隐私/侵权风险时才阻止 pass。事实基座缺少证据、观点没有直接因果证明、存在其他解释，都不足以单独阻止 pass。高影响客观事实无法核验时不得按已核实事实通过；若正文准确呈现为可追溯来源的说法，来源层级较低或未能独立核实不单独阻断。仅“建议追溯更早来源”属于 citation 改进建议。`;
}

export function publicationComplianceIssue({ scan = {}, gate = {} } = {}) {
  const issues = [];
  for (const blocker of scan.titleBlockers || []) issues.push(blocker);
  if (gate && gate.pass === false) {
    for (const issue of Array.isArray(gate.issues) ? gate.issues : []) {
      const value = typeof issue === 'string' ? issue : issue?.message;
      if (value) issues.push(value);
    }
  }
  return unique(issues);
}
