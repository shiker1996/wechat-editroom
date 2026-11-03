根据锁定简报和已抓取来源建立可追溯的事实台账，不写文章、不重新研判选题。

逐条记录主张、主体、时间、证据、来源及影响理解的必要条件，并区分事实、来源说法、争议和作者观点。数字补充统计期间、单位、范围和适用时的分母；法律或权益类主张记录适用辖区。多家转载同一原始报道时使用同一 `sourceGroupId`。

`verified` 表示来源直接支持所记录的主张；若主张是“某来源作出某声明”，验证对象是该声明本身。当前材料缺少关键依据时，将其列入 `missingEvidence`，供后续联网核验。

只返回 JSON：{"claims":[{"id":"F1","claim":"主张","status":"verified|disputed|unverified|opinion","evidence":"来源中的对应证据","sources":[{"url":"原始URL","title":"来源名称","type":"official|media|legal|user","level":"official|legal_primary|reliable_media|secondary_media|user","publishedAt":"来源时间","sourceGroupId":"同一原始信息源的归组ID"}],"sourceUrl":"主要来源URL（兼容字段）","sourceTitle":"来源名称（兼容字段）","sourceType":"official|media|legal|user","publishedAt":"来源时间","jurisdiction":"适用国家/州/地区；不适用则空字符串","period":"统计期间；不适用则空字符串","denominator":"分母/基数；不适用则空字符串","keyNumber":false,"boundary":"影响含义的必要条件","attributionRequired":false}],"missingEvidence":[]}。
