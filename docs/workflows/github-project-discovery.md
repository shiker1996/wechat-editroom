# GitHub 项目发现当前流程契约

> 本文描述当前实现，随行为变化同步更新。未来方案另放在 `docs/design/`。

## 用户目标与范围

- 在内容采集批次中发现新项目、近期活跃项目和成熟项目，并补充与账号兴趣相关的仓库。
- 不负责自动定时启动采集；每日汇总以用户或既有调度启动的 GitHub 采集批次为单位。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 采集批次 | `server/features/collection/application/collection-job-manager.mjs` | 生成/读取兴趣主题，调用统一采集器，执行筛选和历史覆盖过滤后入批次 |
| GitHub 采集插件 | `plugins/github-discovery/adapter.mjs`、`plugins/github-discovery/collector.mjs` | 调用 GitHub Search、三类查询展开、仓库去重和命中元数据归并 |
| 兴趣查询规划 | `server/features/collection/llm/repo-discovery.mjs`、`prompts/collection/repo-discovery-queries.md` | 只规划主题、关键词、场景、项目类型、用途和可选语言；按 1 天默认缓存，生成时参考缓存中的最近 7 天查询历史避重 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 规划主题 | 账号上下文、查询组缓存 | 生成或复用主题查询组；缓存结构版本变化时重新生成 | `server/features/collection/llm/repo-discovery.mjs` |
| 分类搜索 | 每个主题关键词、GitHub 分类配置 | 新项目用 `created` 窗口；活跃和成熟项目用 `pushed` 窗口，并分别使用 Star 门槛；可选语言与 `fork:false archived:false` 由系统追加 | `plugins/github-discovery/collector.mjs`、`plugins/github-discovery/manifest.json` |
| 合并去重 | Trending、常规 Search、AI 兴趣分类命中及热点提及 | 每仓库保留一条记录；`discoveryContexts` 保存主题、类别、实际查询和分类门槛，`discoveryModes` 汇总类别；下游研判最多保留 18 个主题/类别上下文，项目价值输入按主题聚合类别 | `plugins/github-discovery/collector.mjs`、`server/features/research/llm/tasks.mjs`、`server/features/research/domain/hotspot-clustering.mjs`、`server/features/research/domain/event-resolution-shadow.mjs`、`server/features/research/domain/project-reader-value.mjs` |
| 批次筛选 | 去重候选仓库 | AI 兴趣相关度评分、过滤和排序（启用且模型可用时），再过滤已发布过的同仓库项目 | `server/features/collection/application/collection-job-manager.mjs` |
| 每批汇总与入库 | 通过筛选的仓库 | 汇总唯一仓库数、三类命中数和逐主题分类数；作为 `github.discovery.summary` 事件保存，再写入 GitHub 批次热点 | `server/features/collection/application/collection-job-manager.mjs` |

采集器最多返回 100 条记录。为避免批次上限只保留一种项目类别，GitHub 记录按新、活跃、成熟和其他来源轮转排序；同一个仓库仍只返回一次，并保留多类别命中。GitHub Search 请求串行节流：认证请求至少间隔 2.1 秒，未认证请求至少间隔 6.1 秒，以适配 Search API 的每分钟请求限额；插件执行超时设为 5 分钟。

## 入口间差异

兴趣查询规划和筛选由采集批次统一调用；失败时查询规划使用内置场景，相关度过滤失败时放行该分片。采集器重试沿用原主题标签，从缓存计划中恢复主题，并重新展开为启用的项目类别查询。GitHub 类别开关关闭时，相应 AI 分类查询也不执行。

## 产物与验证

- 产物：批次中的 GitHub 仓库记录及其 `discoveryContexts`；Agent Run 中的 `github.discovery.summary` 汇总事件。
- GitHub Search 使用 `created`、`pushed` 和 `stars` 仓库搜索限定符，参考 [GitHub 搜索仓库文档](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)；Search API 有独立速率限制，参考 [GitHub REST Search 文档](https://docs.github.com/en/rest/search)。
- 相关静态校验：Node.js 模块语法检查、`git diff --check`。

## 变更触点

- Prompt 与计划缓存：`prompts/collection/repo-discovery-queries.md`、`server/features/collection/llm/repo-discovery.mjs`。
- 查询执行与类别门槛：`plugins/github-discovery/collector.mjs`、`plugins/github-discovery/manifest.json`。
- 采集筛选、历史覆盖、批次汇总：`server/features/collection/application/collection-job-manager.mjs`。
- 用户配置说明：`docs/configuration.md`。
