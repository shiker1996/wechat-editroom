// 素材基础评估规则。历史表现信号由 application/route 侧注入，领域层不读取反馈、文件或数据库。

export function assessMaterial(material = {}, columns = [], context = {}, historicalSignal = {}) {
  const text = `${material.title || ''}\n${material.raw_text || ''}`.trim();
  const contextWords = [...(context.contentPillars || []), context.readerProfile, context.description].filter(Boolean);
  const fitHits = contextWords.filter((word) => String(word).length > 1 && text.includes(String(word))).length;
  const accountFit = fitHits >= 2 ? 'high' : fitHits ? 'medium' : 'medium';
  const completeHits = ['我', '问题', '结果', '所以', '但是', '后来', '判断', '建议'].filter((word) => text.includes(word)).length;
  const completeness = text.length >= 260 && completeHits >= 3 ? 'high' : text.length >= 100 && completeHits >= 1 ? 'medium' : 'low';
  const potentialHits = ['为什么', '如何', '踩坑', '失败', '成本', '效率', '选择', '变化', '对比', '影响', '反而', '没想到'].filter((word) => text.includes(word)).length;
  const topicPotential = potentialHits >= 2 || text.length >= 500 ? 'high' : potentialHits ? 'medium' : 'low';
  const directions = [];
  if (!text.includes('为什么') && !text.includes('原因')) directions.push('补一层“为什么会这样”，把经历推进到可解释的判断');
  if (!text.includes('结果') && !text.includes('后来')) directions.push('补充结果、失败或反转，避免只停留在过程记录');
  if (!text.includes('建议') && !text.includes('适合')) directions.push('补充适用边界：什么人值得用，什么情况下不建议照做');
  if (!directions.length) directions.push('可继续追问成本、替代方案和对读者选择的影响');
  const sourceColumnName = material.source_type === 'project' ? '工具与实践' : material.source_type === 'reading' ? '读书与观察' : '真实复盘';
  const column = columns.find((item) => item.name === sourceColumnName) || columns[0];
  const overall = [accountFit, completeness, topicPotential].filter((item) => item === 'high').length >= 2 ? 'A' : [accountFit, completeness, topicPotential].includes('low') ? 'C' : 'B';
  const signal = historicalSignal && typeof historicalSignal === 'object' ? historicalSignal : {};
  const recommendation = completeness === 'low' ? '整理补充' : topicPotential === 'high' && accountFit !== 'low' ? '写作候选' : Number(signal.sample_count || 0) > 0 ? '历史表现优先验证' : '继续观察';
  return {
    account_fit: { level: accountFit, reason: fitHits ? `命中账号定位中的 ${fitHits} 个内容线索` : `暂未命中明确定位词，但来源属于${sourceColumnName}，需要再做账号化包装` },
    completeness: { level: completeness, reason: text.length >= 260 ? `已有约 ${text.length} 字记录，仍需检查结果和边界` : '记录偏短，先补发生了什么、你怎么判断、最后结果如何' },
    topic_potential: { level: topicPotential, reason: potentialHits ? `包含 ${potentialHits} 个可继续追问的冲突或问题线索` : '目前更像素材片段，补出具体问题或反差后再判断传播潜力' },
    deepening_directions: directions,
    recommendation,
    historical_signal: signal,
    overall_grade: overall,
    recommended_column_id: column?.id || null,
    title_directions: [
      { intent: '搜索型', direction: `围绕“${(material.title || text.split(/[。！？\n]/)[0]).slice(0, 24)}”补充具体问题词` },
      { intent: '分享型', direction: '突出真实反差、失败代价或读者能获得的判断' },
      { intent: '系列承接', direction: '以本次复盘的下一步实验或未解决问题作为后续预告' },
    ],
  };
}
