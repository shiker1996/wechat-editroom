# X 与微信公众号采集

当前项目已经把 X 和微信公众号接入统一采集器体系，不再依赖外部推送接口才能进入热点批次。

## 配置顺序

1. 打开“系统配置”，为“微信公众号账号”填写极致了 / 大佳拉 API Key；需要 X 时，为“X 搜索 / 趋势”填写 TwitterAPI API Key。由 TwexAPI 切换后，需要在此处把原密钥替换为 TwitterAPI 的密钥。
2. 打开“采集源”，选择“更多采集器”。
3. 选择“微信公众号账号”，填写标识类型和标识；或选择“X 搜索 / 趋势”，选择采集模式后填写搜索条件或趋势筛选。
4. 先点击测试，确认返回文章/动态，再保存来源。
5. 创建批次并执行采集。批次会分别显示“X”和“微信公众号”来源组，采集结果随后进入统一质量过滤、身份去重和事件聚合链路。

## 公众号参数

公众号采集器调用 Dajiala 的 `post_history` 接口。`identifierType` 支持 `ghid`、`nickname`、`wxid` 和 `url`；默认保留最近 168 小时、最多 30 篇，可在来源配置中调整。接口返回的标题、摘要、发布时间、文章 URL 和阅读/点赞等指标会被标准化为统一热点条目。

## X 参数

X 采集器现在统一调用 TwitterAPI，默认地址为 `https://api.twitterapi.io`，使用 `x-api-key` 请求头鉴权。搜索模式使用 `GET /twitter/tweet/advanced_search`，`query` 支持 X 搜索语法，`searchType` 支持 `Latest` 和 `Top`；默认保留最近 168 小时、最多 20 条动态。动态会被转换为统一条目，并保留作者、发布时间、互动指标和原始提供方信息。

来源表单现在支持两种模式：

- 固定搜索：每次批次重复执行一条搜索条件，例如 `from:OpenAI -filter:replies`。
- 查询词池增强：每行填写一条搜索条件，单次批次最多执行 8 条，结果合并并按 X 动态 ID 去重。这是类似 GitHub Search 的多查询发现模式。
- TwitterAPI 趋势：调用 `GET /twitter/trends` 获取 WOEID 地区的趋势话题，再用高级搜索取相关推文。默认全球 WOEID 为 `1`；也可填写 Twitter/X 地区 WOEID。趋势模式不需要填写 `query`。

TwitterAPI 趋势接口返回趋势话题而非推文，因此采集器会搜索排名靠前的最多 5 个话题并合并去重；最终仍输出 X 动态，进入现有质量过滤、事件聚合和热点排行链路。原始条目的 `raw.provider` 会记录为 `twitterapi`，采集结果 provenance 会记录为 `TwitterAPI`。

推文评论模式使用 `GET /twitter/tweet/replies/v2`，可按 `Relevance`、`Latest` 或 `Likes` 排序；每页最多 20 条，编辑室按需取样。

## TechTwitter 全面精选

TechTwitter 作为独立只读采集器接入，不依赖 TwitterAPI，也不需要 API Key。每个批次会依次读取 Trending (`/api/tweets/trending`)、五类 Streams (`/api/command/streams`：`ai-ml`、`startups`、`coding`、`product`、`platform`) 和 Articles (`/api/articles`)；每个内容面按配置的 limit 限制最多条数（1–20）。这些内容面使用 TechTwitter 的 JSON 接口。单个内容面失败会记录在采集批次 provenance 中，并继续收集其他面；若所有内容面都没有有效结果才判定采集失败。

采集记录进入现有 X 流程，并在 `raw.surface` / `raw.category` 中保留 Trending、Streams、Articles 来源面，便于区分与后续筛选；推文保留原始 X 地址，文章保留 TechTwitter 阅读链接。该源覆盖的是 TechTwitter 已监测并发布的精选内容，不代表全量 X。遇到 429 会遵从 `Retry-After` 提示且不做紧密重试。

## 运行失败处理

密钥缺失、鉴权失败、限流和接口返回空结果都会记录为来源级失败，不会阻断同一批次的其他来源。外部导入接口仍保留，适合作为供应商不可用时的备用通道。
