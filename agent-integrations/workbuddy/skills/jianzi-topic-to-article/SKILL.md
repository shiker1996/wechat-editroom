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
4. 对已加入候选池的选题，**必须先调用 `jianzi_candidate_source_fetch`** 抓取并保存关联原文，再读取 `jianzi_candidate_get` 获取来源、事实和现有编辑决策；读取 `jianzi_account_profile` 了解受众与账号定位。不能用外部网页搜索代替这次项目内抓取，也不能仅因候选摘要已有内容就跳过。抓取失败时，先向用户报告工具结果和证据边界；只有用户明确同意基于现有材料继续，才可继续编辑判断和写作，并在文章中标明未核验内容。
5. 先输出选题理由、事实与未知项、切入角度和风险。保存编辑决策时调用 `jianzi_candidate_editorial_update`。锁题 `jianzi_candidate_lock` 会触发门禁；若未就绪，按错误补齐事实或研判，不绕过门禁。
6. 锁题通过后，读取候选的锁定简报和事实材料，直接写出含标题的完整文章。写作要求保持简洁：`请根据写作类型、锁定简报和事实材料，写一篇事实准确、观点清晰的公众号文章，格式为 Markdown。` 根据材料自然组织文章结构。
   - 自审只处理确有问题的内容：核对影响标题、核心结论和读者行动的关键事实、来源归属与明确发布风险。只有观点的关键事实前提被已核实事实直接反驳时才弱化观点；来源暂未核实、缺少直接因果证据或存在其他解释，不自动要求删观点或添加免责声明。保留成立的判断和自然表达，删除重复的审稿说明与内部过程话术。
   - 可调用 `jianzi_article_local_audit` 检查结构、长度和标题风险；它只提供确定性提醒，不替代事实核验或自审。写作和自审完成后调用 `jianzi_article_document_save` 保存为 `draft`，再用 `jianzi_article_documents` 回读确认已落库。**编辑判断获用户确认，只代表可以开始写作，不代表用户确认了尚未生成的文章终稿。**保存草稿后明确告知仍是待审稿，并等待用户审阅；用户确认文章内容后，才以 `final` 保存。只有用户明确要求见字内部 AI 成稿时，才调用 `jianzi_article_generate`。
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
