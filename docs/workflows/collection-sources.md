# 采集来源当前流程契约

> 描述来源配置、连接测试、批次采集与候选交付的当前行为。采集来源不构成事实确认或发布授权。

## 用户目标与范围

- 用户在“采集源”台账管理 Feed、RSSHub、GitHub 等来源；批次采集读取已启用的来源并产出可追溯候选。
- 本流程到候选入库为止。研究、选题准入和文章事实核验仍由各自下游流程处理。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 采集源 UI | `public/src/views/subscriptions.js` | 调用来源列表、创建、更新、连接测试和启停接口。 |
| 来源 HTTP API | `server/platform/http/routes/system-routes.mjs` | 将来源输入规范化到统一来源仓库；连接测试调用采集器 `adapter.test` 并持久化最近结果。 |
| 批次采集 API | `server/platform/http/routes/batch-routes.mjs` | 只选择台账中已启用的来源，启动采集任务。 |
| 批次采集任务 | `server/features/collection/application/collection-job-manager.mjs` | 创建插件运行时，执行来源采集，过滤、去重后写入热点候选。 |
| 外部扩展来源入口 | `server/features/collection/application/source-service.mjs` | 验证插件和来源配置并生成稳定 `source_key`。 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 配置来源 | 插件 ID、来源配置、标签 | 校验配置后写入 `collection_sources`；URL/路由被映射为来源类型和稳定键。 | `source-service.mjs`、`subscriptions.mjs`、`collection-source-repository.mjs` |
| 连接测试 | 已保存来源或表单配置 | 采集器探测外部连接；保存来源的测试结果为 `success` 或 `failed`，错误消息包含可读分类。有效空 Feed 返回成功和 0 条，解析错误、认证和限流以错误分类呈现。 | `system-routes.mjs`、`plugins/feed/collector.mjs`、`plugins/rsshub/collector.mjs`、`plugins/github-discovery/adapter.mjs` |
| 来源采集 | 批次 ID、已启用来源、超时/条数上限 | Feed/RSSHub/GitHub Search 采集文章或项目条目；网络暂错和 5xx 有限重试，认证/限流不会快速重打。 | `collection-runner.mjs`、`plugins/shared/source-http.mjs`、`server/platform/plugin-sdk/github-client.mjs` |
| 标准化和记录 | 插件返回条目 | 校验标题、HTTP(S) URL、摘要、来源身份和原始元数据；每源记录成功/失败、条目数和错误码。RSS/Atom 会逐条隔离无效条目并按规范 URL 去重。 | `server/platform/collectors/contracts.mjs`、`store-collection-runner.mjs`、`plugins/shared/feed-normalization.mjs` |
| 候选入库 | 已标准化的采集结果 | 候选归并后写入批次热点，后续研判仍需独立研究依据与事实门禁。来源成功不等于事实成立。 | `collection-job-manager.mjs`、`server/features/collection/index.mjs`、`server/features/research/application/research-pipeline.mjs` |

## 失败处理与数据记录

- 单个来源失败不阻断同批次其他来源；失败通过来源运行记录和 `pipeline_failures` 保留。
- `collection_sources.last_test_status/last_test_error` 记录最近手动连接测试；`subscription_runs` 记录批次执行状态、条目数和错误。失败分类在消息中标出 `AUTH_REQUIRED`、`RATE_LIMITED`、`TIMEOUT`、`OUTPUT_INVALID` 或 `NETWORK_ERROR`。
- Feed/RSSHub 使用有限超时与最多一次退避重试。GitHub Search 按响应头识别主/次限流；仅短 `Retry-After` 和暂时 5xx 会在当前请求内重试，较长限流窗口由后续任务再试。
- 空 Feed 与成功采集 0 条通过 `item_count=0` 区分；格式不可识别或条目没有可用标题/链接时作为解析/输出错误处理。
- Feed/RSSHub 在插件打包时把仓库中的 `plugins/shared` 公共运行模块复制到对应独立包，并将包内相对引用改写到包内路径；用户安装的采集器不依赖工作树目录。

## 入口间差异

- UI、旧订阅兼容接口和外部来源 API 最终写入同一 `collection_sources` 台账。
- 单源连接测试直接调用 `adapter.test`，只更新最近测试状态，不建立批次或候选；批次任务调用 `CollectionRunner`，记录 `subscription_runs` 并把可用条目送入候选归并。
- RSSHub 路由与直连 Feed 共用字段归一化，但路由由本地 RSSHub 服务代取上游内容；Feed 直接请求配置的公开 URL。GitHub Search 单独使用 GitHub API 客户端与搜索配额处理。

## 产物与验证

- 产物：`collection_sources`、`subscription_runs`、`pipeline_failures` 与批次候选。
- 相关测试：`test/feed.test.mjs`、`test/rsshub.test.mjs`、`test/github-api.test.mjs`、`test/github-discovery.test.mjs`、`test/collector-contracts.test.mjs`、`test/collection-run-trace.test.mjs`、`test/subscriptions.test.mjs`。

## 变更触点

- 来源输入与列表：`server/features/collection/application/source-service.mjs`、`server/features/collection/application/subscriptions.mjs`、`server/platform/http/routes/system-routes.mjs`、`public/src/views/subscriptions.js`。
- 来源实现与结果标准化：`plugins/feed/collector.mjs`、`plugins/rsshub/collector.mjs`、`plugins/github-discovery/adapter.mjs`、`plugins/shared/`、`server/platform/plugin-sdk/github-client.mjs`、`server/platform/collectors/contracts.mjs`。
- 批次和研究交付：`server/features/collection/application/collection-job-manager.mjs`、`server/features/collection/application/store-collection-runner.mjs`、`server/features/research/application/research-pipeline.mjs`。
