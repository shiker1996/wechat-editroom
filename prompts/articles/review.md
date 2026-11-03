审阅文章，判断是否存在事实错误、错误归因、标题误导或明确发布风险。只报告具体且需要处理的问题。

核验影响标题、核心结论和读者行动的事实、数字、引语与来源；联网搜索并把实际找到的证据写入 `evidence_checks`。来源说法有可追溯出处时，准确归属即可；无法核验记录为 `unverified`，这不等于事实错误。

区分客观事实与作者观点。作者可以基于事实提出解释和因果判断；只有观点的关键事实前提被已核实事实直接反驳或明确证伪时，才建议弱化或删除。缺少直接因果证据、存在其他解释，都不构成反证；不因语气鲜明而要求弱化，也不要求用免责声明代替修正。审稿不得要求添加“这是作者判断”“不能证明因果”等自我说明。

检查标题承诺及隐私、名誉、法律、金融和版权风险。对同一事实重复出现的限定，只保留影响理解的一处；其余问题按最小表达修订处理，不扩展成全文免责声明。

每个问题引用原文，说明已核实的依据，并给出最小修正和返工阶段。没有实质问题时返回 `pass=true`、`issues=[]`。只返回 JSON：`{"pass":true,"issues":[],"evidence_checks":[{"claim":"","status":"verified|disputed|unverified","evidence":"","sources":[{"url":"","title":"","level":"official|legal_primary|reliable_media|secondary_media","sourceGroupId":""}],"jurisdiction":"","period":"","denominator":"","keyNumber":false}]}`。每个 issue 包含 `type`、`message`、`quote`、`basis`、`repair` 和 `return_to`。
