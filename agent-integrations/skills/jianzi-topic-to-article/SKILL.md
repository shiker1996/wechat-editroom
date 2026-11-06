---
name: jianzi-topic-to-article
description: 使用见字工作台完成热点采集、选题研判、文章简报和成稿。适用于用户要求找热点、筛选选题、写公众号文章或从采集到成稿完整处理。
---

# 采集、研判与文章成稿

## 工作流

1. 调用 `jianzi_batches_list` 复用用户指定的批次；没有合适批次时先创建 `jianzi_batch_create`。
2. 调用 `jianzi_batch_collect` 启动采集，再用 `jianzi_job_wait` 等待完成。报告失败来源，不要把部分成功说成完整采集。
3. 外部 Agent 路径：先调用 `jianzi_account_profile` 获取真实账号画像，再调用 `jianzi_batch_hotspots` 读取原始热点与项目发现元数据，按项目 `hotspot-tagging` Skill 执行打标；分批调用 `jianzi_batch_tags_submit` 保存标签。然后调用 `jianzi_batch_events` 获取稳定事件组，逐事件综合原文形成事件事实卡，每次最多 200 张调用 `jianzi_batch_event_cards_submit`；根据返回的 `remaining` 继续提交，直到全部覆盖。随后调用 `jianzi_research_stage_prepare` 领取原研判 pipeline 的第一项模型任务，严格按返回的 `messages`、`jsonMode`、`tools` 完成该任务，用 `jianzi_research_stage_submit` 提交 `taskId` 和原始输出。返回 `pending` 就继续执行下一项，返回 `completed` 才读取文章与图文榜单。JSON 阶段提交对象，单事件报告阶段提交 Markdown 字符串；不得用自己另算的 H/B/J 分替代 pipeline 的评分与入池逻辑。
   - 打标必须遵循 `hotspot-tagging` Skill，只处理 `researchEligible: true` 的热点：分类使用账号配置，事件要素写入 `eventParts.who/what`（系统据此生成 `eventKey`）；分数上限 conflict/audience=20、informationGain/emotion=15、timeliness/impact/sourceReliability=10。风险只标记不擅自删除热点。
   - 文章与图文分别选题：原 pipeline 会保存文章候选与图文预选；文章读取 `jianzi_batch_ranking`，图文读取 `jianzi_batch_social_ranking`，把 T/J/A/C/F 与 G_social、入池理由分别交给用户审阅。不要用文章 F 分替代图文 G_social，也不要对同一批次再调用旧的 `jianzi_batch_research_submit` 重复计算。
   - 若用户明确选择见字内部 AI 自动研判，才调用 `jianzi_batch_auto_research`。
   - 用户给定自主写作主题、教程或心得经验，而不是要求从热点池选题时，创建或复用批次后调用 `jianzi_independent_article_create`。教程需提供环境、至少两个步骤和三条带来源等级的要点；该工具只创建候选与事实基座，不启动见字内部模型。它已建立自主写作候选与锁定简报，不再执行热点候选的原文抓取、编辑判断和锁题步骤；若用户提供素材 URL，创建时会抓取并写入事实基座。外部 Agent 据事实基座写作并保存文章。
4. 对已加入候选池的选题，**必须先调用 `jianzi_candidate_source_fetch`** 抓取并保存关联原文，再读取 `jianzi_candidate_get` 获取来源、事实和现有编辑决策；读取 `jianzi_account_profile` 了解受众与账号定位。不能用外部网页搜索代替这次项目内抓取，也不能仅因候选摘要已有内容就跳过。抓取失败时，先向用户报告工具结果和证据边界；只有用户明确同意基于现有材料继续，才可继续编辑判断和写作，并在文章中标明未核验内容。
5. 先输出选题理由、事实与未知项、切入角度和风险。保存编辑决策时调用 `jianzi_candidate_editorial_update`。锁题 `jianzi_candidate_lock` 会触发门禁；若未就绪，按错误补齐事实或研判，不绕过门禁。
6. 写作前调用 `jianzi_settings_summary` 读取 `articleLength.minVisibleChars` 和 `maxVisibleChars`，把它们作为本次正文的可见字数范围；用户明确指定的范围优先。锁题通过后，读取候选的锁定简报和事实材料，直接写出含标题的完整文章。基础写作提示与项目内保持一致：`请根据写作类型、锁定简报和事实材料，写一篇事实准确、观点清晰的公众号文章，格式为 Markdown。` 根据材料自然组织文章结构。
   - 完成草稿后，必须联网核验影响标题、核心结论和读者行动的关键事实、数字、引语与来源归属；引用只能使用本次实际查阅且读者可访问的来源。无法找到直接证据时标为待核实并说明原因，不得按记忆补造来源。
   - 完成事实核验后，按项目 `article-reviewer` 标准审稿：检查简报兑现、事实与归因、论证、标题承诺、表达和明确发布风险；每项问题引用文章原文和已核实依据，给出最小修改。保留成立的作者观点；只有关键事实前提被已核实事实直接反驳或证伪时才弱化观点。对实质问题做定点修订并复审，最多两轮；仍有实质问题或材料缺口时，明确告知用户，不把它写成已通过审稿。
   - 调整前后正文可见字数。超出配置范围时，按目标范围扩写或压缩，最多两轮；保留已核实事实和论证，避免灌水或删掉关键依据。若调整了内容，再核验受影响句段。调用 `jianzi_article_local_audit` 时传入 `{min,max}` 作为 `articleLength`，让结构/字数/标题提醒采用相同范围；它不替代事实核验或审稿。若两轮后仍超范围，向用户说明实际字数与目标范围。
   - 写作、审稿和必要的长度调整完成后调用 `jianzi_article_document_save` 保存为 `draft`，再用 `jianzi_article_documents` 回读确认已落库。**编辑判断获用户确认，只代表可以开始写作，不代表用户确认了尚未生成的文章终稿。**保存草稿后明确告知仍是待审稿，并等待用户审阅；用户确认文章内容后，才以 `final` 保存。只有用户明确要求见字内部 AI 成稿时，才调用 `jianzi_article_generate`。
7. 用户要求排版或封面时，先用 `jianzi_article_documents` 核对 `final`。若只有 `draft`，解释工作台需要终稿、当前没有排版/封面产物，并请用户先审阅确认；不要提前生成 HTML 或调用提交工具。只有读回确认终稿后，才继续设计和提交。

## 面向读者的正文边界

- MCP 返回的候选字段、内部编辑决策、抓取状态、评分、工具名和工作台处理记录只用于写作判断，不能直接当作文章素材或引用来源。尤其不要在正文写“工作台采集到的摘要”“候选摘要显示”“项目内抓取结果”等内部流程表述。
- 对外引用必须归因到读者可访问的原始来源：使用来源名称/作者、发布时间和 URL；原文打不开或证据不足时，说明“目前无法核实”，不要把摘要、编辑备注或事件卡改写成来源已确认。
- 文章仅在主题本身讨论见字工作台、MCP 或采集流程时，才可将这些名称作为内容提及；也要区分公开事实与本次编辑过程。
- 保存草稿前检查正文及标题，移除内部工具名、候选 ID、批次 ID、内部评分和写作过程说明。`jianzi_article_local_audit` 返回的内部措辞提醒是修订提示，不替代事实审稿。

## 工具和模型边界

- Agent 可以自行做选题比较与编辑判断，不需要把 Codex/WorkBuddy 模型凭据写入见字。
- 外部成稿后可调用 `jianzi_article_local_audit` 检查结构、默认字数范围、标题风险及可能泄露内部流程的措辞；仍需单独完成事实核验、审稿和用户确认，字数配置以用户选定的写作要求为准。
- `jianzi_batch_auto_research`、`jianzi_article_generate` 会调用工作台已配置的模型；外部 Agent 写作后通过 `jianzi_article_document_save` 保存，不需要见字内部模型。
- 不虚构来源、事实或作者经历；无法核验的内容应保留为待核实问题。
- 不自动发布到公众号。最终选择和发布由用户完成。
