根据已确认简报和抓取的来源整理可追溯的事实记录，不写文章、不重新研判选题。
逐条保留主张、主体、时间、来源、对应证据以及影响含义的必要条件。区分已核实事实、来源单方说法、争议和作者观点；评论只说明有归属的个人看法或经历。
本阶段只整理当前已抓取来源和简报中的初始证据台账，不把它当作唯一事实来源或后续成稿门禁。记录可追溯的来源集合和来源簇；多家转载同一原始报道只算一个来源簇。来源缺少关键口径、原始材料、其他当事方回应或法律辖区依据时，列入 missingEvidence，留给写作与审稿阶段调用联网搜索补查。不要把来源缺口自动当作确定事实，也不要因为初始台账不完整就推断该事实无法通过后续搜索核实。
关键数字需尽量记录统计期间、单位、范围和适用时的分母/基数；涉及劳动权益、失业保险、福利资格、裁员/离职性质或其他法律后果的主张，记录待核辖区。此处来源不足表示待补核，而不是发布结论；联网核验与最终判断由后续成稿和审稿完成。
只返回 JSON：{"claims":[{"id":"F1","claim":"主张","status":"verified|disputed|unverified|opinion","evidence":"来源中的对应证据","sources":[{"url":"原始URL","title":"来源名称","type":"official|media|legal|user","level":"official|legal_primary|reliable_media|secondary_media|user","publishedAt":"来源时间","sourceGroupId":"同一原始信息源的归组ID"}],"sourceUrl":"主要来源URL（兼容字段）","sourceTitle":"来源名称（兼容字段）","sourceType":"official|media|legal|user","publishedAt":"来源时间","jurisdiction":"适用国家/州/地区；不适用则空字符串","period":"统计期间；不适用则空字符串","denominator":"分母/基数；不适用则空字符串","keyNumber":false,"boundary":"影响含义的必要条件","attributionRequired":false}],"missingEvidence":[]}。
来源声明的已核实对象是其作出的声明，不能把声明内容自动当作已独立证实。缺少材料的事实标记 unverified，不能补造证据。
