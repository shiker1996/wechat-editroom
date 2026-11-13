# 文章配图能力技术方案（提案）

## 目标

让工作台和外部 Agent 可以围绕一篇文章的既有配图占位，自动从选题已采集的关联来源中匹配报道并截图，或用已核验的数据制作时间轴、数据卡和 ECharts 图表；将成品保存到占位对应的本地配图工作区，预览后再按现有授权流程上传 CDN 并排版。

本方案不改变终稿正文，不自动发布公众号，也不把未核验的数据画成事实图表。

## 现状与缺口

- `GET /api/candidates/:id/images` 已返回占位、状态及 CDN 配置状态；`POST /api/candidates/:id/images/:imageId` 可保存本地图片，单张最大 8MB；`POST .../:imageId/cdn` 负责上传。
- `image-workflow.mjs` 维护 `image-assets.json`，支持本地图片登记、来源与版权元数据。现有 `generate` API 仅接受终稿占位中预先声明的 `timeline` 或 `datacard` 规格。
- `wechat-echarts-blocks-to-images` 已能把受限 JSON ECharts 配置渲染为 PNG，但它处理排版工作文件中的 ECharts 围栏，不会把图片登记到文章占位。
- `browser-web-page` 已有 Puppeteer 隔离执行、页面访问校验和网页内容提取，但没有截图输出模式。
- 两份外部 Agent 工具入口（`scripts/agent-integration/tools.mjs` 与 `agent-integrations/dsh-workbench/shared/tools.mjs`）提供读取、规划、生成和上传，缺少截图及自定义图表数据的入口。

因此，占位、保存、清单、上传等基础设施已存在；工作重点是补齐生成入口，并将新生成结果统一登记到既有占位。

## 统一自动配图流水线

自动配图由服务端候选级流水线统一编排，工作台按钮和外部 Agent 均调用 `POST /api/candidates/:id/images/run`。流水线在没有已完成图片时可清理旧占位并重新规划；已有图片时保留占位并处理缺失项。

流水线按以下顺序运行：

1. 检查终稿，并在需要时规划配图占位。
2. 对来源类占位调用 `article-image-agent`，让 Agent 只从当前候选的已采集来源中选择 `sourceId`。无直接证据时返回待人工确认，不接受模型自造 URL。
3. 先截图可匹配的来源页，再生成占位中已声明数据的时间轴/数据卡；单项失败或需确认不会阻止其他图片。
4. 每项更新 `image-assets.json` 和候选工作目录中的 `article-image-pipeline.json` 检查点。再次运行跳过已就绪图片并重试缺失项。

`jianzi_article_image_create` 和 `jianzi_article_image_generate` 仍保留为单项人工重做入口；CDN 上传仍需显式调用现有接口。

## 方案概览

外部 Agent 看到一个统一的创建入口 `jianzi_article_image_create`，用 `mode` 选择生成方式：

| `mode` | 必需输入 | 产物 |
|---|---|---|
| `auto` | 无需 URL；候选需有已采集的关联来源 | 按配图占位内容匹配的报道页截图，并记录实际来源 |
| `capture` | `url` | 页面截图或指定元素截图 |
| `timeline` | `spec.title`、`spec.items` | 工作台样式的时间轴 PNG |
| `datacard` | `spec.title`、`spec.items` | 工作台样式的数据卡 PNG |
| `echarts` | `spec.option`、`spec.width`、`spec.height` | ECharts PNG |

所有模式还需要 `candidateId`、`imageId`。`imageId` 必须来自当前配图工作区，且必须是未解决或可替换的占位。每次调用只生成一张图片，避免一个请求内有多项部分成功而无法判断最终状态。

创建后返回占位 ID、图片状态、预览接口、来源摘要、生成方式和警告。外部 Agent 先用现有配图读取工具检查结果；用户明确要求上传时再调用现有 CDN 上传工具。

## 组件与职责

### 外部 Agent 工具层

在两份工具注册表中同步声明 `jianzi_article_image_create`，共用相同的 schema 和输入约束。Dispatcher 调用工作台候选图片 API，不直接访问文章目录、读取本机任意路径或读取 CDN 凭据。

工具说明要求 Agent：

1. 先读取占位并确认 `imageId`。
2. 来源报道配图优先使用 `mode: auto`，无需向用户索要网页 URL；其他情况选择对应生成模式。
3. 对事实图表提交来源可追溯且已核验的数据。
4. 生成后再次读取配图状态，检查预览和来源信息。
5. CDN 上传仍遵守用户明确授权门槛。

### HTTP 与应用层

在 `media-routes.mjs` 增加候选配图创建路由，例如：

```http
POST /api/candidates/:id/images/:imageId/create
```

路由验证候选、终稿、占位及模式输入后调用文章应用服务。应用层负责运行选定 renderer、校验图片输出、将图片保存到占位工作区，并通过现有资产登记函数更新 `image-assets.json`。

路由只调用应用服务；文章业务层不直接导入 Puppeteer。浏览器截图通过浏览器工具运行时执行，图表渲染复用现有 ECharts/Chromium renderer。

### 渲染器

- `capture`：先复用 `browser-web-page` 的隔离浏览器运行时；若页面被拦截或渲染不完整，再按 Reddit 的 CDP 生命周期启动/连接配图专用、有界面且使用独立持久 Profile 的 Chrome 兜底截图（不复用 Reddit 登录 Profile）。支持视口截图或可选 CSS 元素截图、有限等待条件和最大输出尺寸；遇到验证码或人工验证时暂停并提示用户处理，不尝试绕过。截图结果作为受限图片字节返回给应用层，不返回本地文件路径。
- `timeline` / `datacard`：将 API 提交的结构化规格送入现有确定性绘图逻辑；解除只能从终稿注释读取数据的限制，但保留相同 schema 校验和尺寸样式。
- `echarts`：复用 ECharts PNG renderer。接收 JSON 对象，不执行 JavaScript；仅开放支持的图表选项和数据长度上限。生成后等待 ECharts 完成渲染，再由 Puppeteer 截图。

## 输入、保存与资产来源

统一请求的概念 schema：

```json
{
  "mode": "capture | timeline | datacard | echarts",
  "url": "capture 模式必填",
  "selector": "可选 CSS 选择器",
  "viewport": { "width": 1200, "height": 900 },
  "spec": "时间轴、数据卡或 ECharts 的结构化数据"
}
```

通用限制建议：每次仅生成一张 PNG；截图及渲染最长 60 秒；输出最大 8MB；默认图像宽度不超过 2400px、高度不超过 4000px。服务端最终校验实际 MIME、文件签名、尺寸和体积，不信任调用方声明。

登记到 `image-assets.json` 时保留现有占位字段，并补充 `generation` 元数据：

- `mode`、`generatedAt`、`rendererVersion`；
- `sourceUrl`、最终跳转 URL、页面标题（截图模式）；
- `dataSources` 或来源说明（时间轴、数据卡、ECharts）；
- 图表规格摘要或其哈希，不默认保存整份可能很大的输入；
- `copyright` 初始为待确认，除非来源与许可被明确核验。

新图片替换旧图片时，清空旧 CDN URL、Key 和上传时间，沿用现有“本地新版本必须重新上传”的规则。

## 安全与事实边界

### 网页截图

- 仅允许 HTTP/HTTPS；校验初始 URL 和每次跳转的主机，拒绝 localhost、私有/链路本地地址、云元数据地址和非公网 DNS 结果，防止 SSRF。
- 禁用文件、扩展、开发工具协议；不传递登录态、Cookie 或工作台凭据；不自动点击登录、下载或提交表单。
- 页面资源请求也执行同一访问策略；限制导航、资源总量、等待时间和截图尺寸。
- 截图只作为来源资料，不代表版权许可或事实认证；页面标题、最终 URL 和截图时间一并登记。

### 图表输入

- 时间轴/数据卡：条目数 2–8；标题、标签和值有长度上限；拒绝 HTML、脚本和图片 URL 注入。
- ECharts：只接受 JSON 对象，限制输入长度、series 数量、数据点数、轴标签长度和可用图表类型；不接受函数、任意 JS、自定义 HTML、外部资源 URL 或原始 HTML 模板。
- 来源字段由 Agent 提交并展示为“来源说明”，系统不声称已验证来源数据。UI 和 Agent 指引明确要求数据核验后再绘图。

## 状态与交互

占位状态沿用现有 `missing → local → cdn`：

1. 读取工作区，Agent 选中目标占位。
2. 创建图片；服务端校验输入并执行对应 renderer。
3. 保存本地文件、写清单和来源元数据，状态变为 `local`。
4. 读取工作区并预览；如不满意，可再次生成并替换本地版本。
5. 用户明确要求上传后，沿用既有 CDN 上传门控，状态变为 `cdn`。
6. 排版流水线消费占位里的 CDN URL，并运行现有 HTML 门禁。

生成失败不修改既有已登记图片；保存采用临时文件后原子替换。只在图片验证和元数据写入均成功后返回成功。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 外部 Agent 自己运行 Puppeteer，再把 Base64 发到现有保存 API | 改动小、可快速验证 | 依赖 Agent 环境有浏览器和脚本执行；大图产生大请求；来源与占位登记容易遗漏；网络安全策略分散 | 可作短期人工兜底，不作为正式能力 |
| 各自新增截图、时间轴、卡片、ECharts 四个独立 Agent 工具 | 单个工具输入简单 | 注册表和文档重复；Agent 需要理解多套状态及错误处理 | 不推荐 |
| 统一创建工具 + 服务端受控 renderer | 复用占位与清单；统一校验、状态和回执；Agent 工作流简单 | 需要在浏览器 adapter 和图片工作流之间增加一个受限的字节传递接口 | 推荐 |

## 分阶段实施

### 阶段 1：统一登记契约与时间轴/数据卡

- 提取请求校验、图片验证、保存和清单更新的公共应用服务。
- 允许结构化请求提交时间轴/数据卡规格，沿用当前 renderer。
- 新增 API 与两份 Agent 工具定义。
- 验收：外部 Agent 可对指定占位生成、预览、覆盖本地图片；错误输入不破坏已有图片。

### 阶段 2：ECharts 占位图片

- 将现有 ECharts renderer 抽为可从文章图片应用服务调用的模块或受控工具能力。
- 定义安全 ECharts JSON schema，限制系列和点数。
- 验收：可生成柱状、折线、饼图等首批批准类型；非法对象、超限数据和渲染超时会清楚失败。

### 阶段 3：自动匹配来源并截图

- 读取候选关联热点、已采集原文、热点素材和候选补充来源，按占位内容匹配报道；工作台 UI 和外部 Agent 均不要求用户手工提供 URL。
- 扩展浏览器运行时以支持截图任务，并复用/提取公共公网主机与跳转校验。
- 返回受限 PNG 字节和页面元数据；文章应用服务负责图片尺寸验证与本地登记。
- 验收：自动模式只从当前候选关联来源选择公开 HTTP/HTTPS 页面；记录来源 URL、标题和匹配方式；缺少来源或截图失败时明确报错，不要求手工找链接。

### 阶段 4：体验和契约收尾

- 工作台 UI 提供一键自动配图，展示记录来源及生成方式，并让本地图片可预览和重新生成。
- 同步两份 Agent Skill/README 和 `docs/workflows/article-image-delivery.md` 当前态契约。
- 验收完整流程：读取占位 → 创建图片 → 预览 → 用户授权 CDN 上传 → 排版和 HTML 门禁通过。

## 影响范围

| 表面 | 预期 |
|---|---|
| 用户入口与呈现 | 配图工作区呈现来源、生成方式、预览及失败原因 |
| 接口与集成 | 增加候选配图创建 API；两份 MCP 工具注册和 dispatcher 同步 |
| 业务行为 | 新增多种 renderer 选择、校验、覆盖和保存状态流程 |
| Agent 行为 | 更新外部 Agent 工具说明、配图技能指引和能力授权声明 |
| 数据与运行 | 扩展 `image-assets.json` 生成元数据；不新增数据库表和外部凭据 |
| 项目文档 | 更新 API、配图工作流契约、技能说明和脚本/工具索引（如适用） |
| 验证 | 新增 renderer/schema/SSRF/覆盖行为测试，并复验 CDN 上传与排版门禁 |

## 当前态相关路径

- API 与候选图片状态：`server/platform/http/routes/media-routes.mjs`
- 图片工作区和资产清单：`server/features/articles/application/image-workflow.mjs`
- 截图采集器：`plugins/browser-web-page/manifest.json`、`plugins/browser-web-page/worker.mjs`、`plugins/browser-web-page/runner.mjs`
- ECharts 技能渲染：`skills/wechat-echarts-blocks-to-images/scripts/render-echarts.mjs`
- Agent 工具副本：`scripts/agent-integration/tools.mjs`、`agent-integrations/dsh-workbench/shared/tools.mjs`
- 当前流程契约：`docs/workflows/article-image-delivery.md`
