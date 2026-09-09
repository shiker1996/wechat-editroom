# 见字 · 公众号编辑工作台

[中文](./README.md) · [English](./README.en.md)

> **一个真正从选题开始，而不是从输入框开始的本地 AI 公众号工作台。**
>
> 找热点 → 研判事件 → 做编辑决策 → 写稿 → 审稿 → 排版 → 封面 / 图文，把一篇内容从素材推进到可交付产物。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/shiker1996/wechat-editroom/actions/workflows/ci.yml/badge.svg)](https://github.com/shiker1996/wechat-editroom/actions/workflows/ci.yml)
[![Node.js ≥ 24](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-339933?logo=nodedotjs&logoColor=white)](./package.json)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows&logoColor=white)](./docs/user-guide.md#1-安装与启动)

「见字」把信息采集、事件研判、选题决策、文章成稿、公众号排版、封面图和社交图文放进同一条可追溯流程。你可以从 RSS / 网页 / Reddit / GitHub 热点开始，也可以直接导入自己的素材。

它不是 SaaS，也不是“输入一个主题就生成文章”的聊天框：工作区和运行记录默认留在本机，服务只监听 `127.0.0.1`；你配置的模型或采集服务仍只会接收完成对应任务所需的内容。

<p align="center">
  <img src="docs/screenshots/ui-demo.gif" alt="见字工作台真实批次只读预览：从总览到选题和产物" width="760">
</p>

<p align="center">⭐ 如果这个工作流对你有用，欢迎 Star，或告诉我你最想接入的内容来源。</p>

<p align="center">
  <img src="docs/screenshots/ui-dashboard.png" alt="工作台总览" width="32%">
  <img src="docs/screenshots/ui-topics.png" alt="文章选题池" width="32%">
  <img src="docs/screenshots/ui-social-topics.png" alt="图文选题池" width="32%">
</p>
<p align="center">
  <img src="docs/screenshots/ui-atlas.png" alt="热点全景" width="32%">
  <img src="docs/screenshots/ui-editorial.png" alt="AI 编辑会" width="32%">
  <img src="docs/screenshots/ui-editor.png" alt="文章编辑器" width="32%">
</p>
<p align="center">
  <img src="docs/screenshots/ui-preview.png" alt="公众号排版预览" width="32%">
  <img src="docs/screenshots/ui-cover.png" alt="文章封面图" width="32%">
</p>

> GIF 和截图来自本机演示数据或生产批次只读预览；启动对应工作台后，可用 `node scripts/media/render-demo-gif.mjs <baseUrl> <output.gif>` 重新生成。公开前请人工检查画面中的标题、来源和内部信息。

## 先看效果

不想先读安装说明？先打开[在线教程与只读导览](https://wechat-newsroom-guide.vercel.app/)，用一批已完成的真实生产数据了解“热点 → 选题 → 文章 / 图文”的完整链路。

不想先配置模型？直接用演示模式打开完整界面，查看热点、选题池和演示产物：

```bash
git clone https://github.com/shiker1996/wechat-editroom.git
cd wechat-editroom
setup-workbench.cmd
start-workbench.cmd -Demo
```

演示模式使用独立的 `data/demo.db`，不会污染正式数据；需要模型的操作仍会明确提示配置服务商。

`setup-workbench.cmd` 会自动准备本地 Node.js、安装依赖并启动首次配置向导；配置完成后，日常启动使用 `start-workbench.cmd`。如果已经下载仓库，直接双击这两个脚本即可。

当前也提供 Windows Electron 桌面版开发入口。它会在独立用户工作区启动同一个本地 Node.js 工作台服务：

```powershell
npm run desktop:dev
```

桌面版开发与打包说明见 [`docs/desktop.md`](./docs/desktop.md)。

想在本机查看生产库中最近的真实批次，可显式运行：

```powershell
start-workbench.cmd -DemoProduction -NoBrowser
```

该模式启动时会把 `data/workbench.db` 复制为独立的 `data/demo-production.db` 快照，并将 HTTP 接口锁为只读；退出后不会写回生产数据库。生产内容默认只适合本机预览；如需制作公开截图或 GIF，请先人工检查并确认脱敏范围。

### 在线教程与只读导览

仓库内的 [`site/`](./site/) 是一个可独立部署到 Vercel 的静态教程网站，包含产品定位、五分钟上手路径和脱敏生产批次导览。也可以直接访问线上版本：<https://wechat-newsroom-guide.vercel.app/>。

生成或刷新网站数据：

```bash
npm run site:export
```

导出脚本默认只读取 [`site/public-demo-batch.json`](./site/public-demo-batch.json) 中审核通过的批次，不会自动选择最新批次。更换公开批次前，应先确认它已经完成、脱敏并通过人工检查，再修改该清单并运行导出。

在 Vercel 创建新 Project 后，将 Root Directory 设置为 `site`；完整工作台仍建议按上面的方式在本地运行。仓库已提供 GitHub Actions 自动部署配置；启用它需要在 GitHub 仓库 Secrets 中设置 `VERCEL_TOKEN`、`VERCEL_ORG_ID` 和 `VERCEL_PROJECT_ID`。

首轮公开展示可直接使用[发布与推广素材包](./docs/launch/star-launch-kit.md)，其中包含发布说明、截图 / GIF 文案、Issue 模板和首轮传播计划。

## 它解决什么问题？

传统做法往往是：RSS / 搜索 → 聊天模型 → 手动核事实 → 另一个编辑器排版 → 再做一套小红书图文。内容、来源和判断散落在多个工具里，过几天很难复盘“为什么选这个题、稿子依据了什么”。

见字把这条链路收在一个本地工作台里：

```text
信息源 → 热点 → 事件与事实 → 候选选题 → 编辑决策 → 文章 / 图文 → 排版与产物
```

它的核心不是替你按下“生成”，而是把每一步的输入、判断、版本和产物留下来，方便继续写、回头查和复盘。

## 为什么不是 ChatGPT + 秀米？

ChatGPT 和秀米仍然可以是工作流中的工具；见字解决的是它们之间缺少“编辑流程”的那一段：

| | 典型工具组合 | 见字 |
|---|---|---|
| 从哪里开始 | 输入一个主题 | 从信息源、热点和素材开始 |
| 怎么做判断 | 主要靠对话记录和人工记忆 | 事件、事实卡、候选选题和编辑简报分阶段保留 |
| 怎么交付 | 在多个工具之间复制粘贴 | 文章、公众号 HTML、封面和图文进入同一个产物柜 |
| 怎么复盘 | 结果散落在聊天记录和文件夹 | 版本、运行记录和失败原因可回溯 |

## 适合谁？

- 个人公众号 / 小红书作者：想把找题、写稿、排版和图文制作串起来。
- 内容编辑或小团队：需要候选选题、来源、简报、审稿和产物统一留档。
- Node.js / AI 工具开发者：想研究本地优先、技能包、插件和可追溯 Agent 流水线。

## 主要能力

| 工作阶段 | 当前能力 |
|---|---|
| 信息采集 | RSS / Atom、RSSHub、Reddit、GitHub 项目发现、静态网页与浏览器网页采集；网页来源支持静态优先、动态降级和 AI 候选排序 |
| 事件研判 | 热点打标、事件聚类、事实卡、国内受众相关度、全景视图、文章池与图文池双轨评分 |
| 编辑决策 | 对话式编辑会、统一对话 Agent、补充来源抓取、作者实践门禁、历史内容去重和结构化简报锁定；工具或模型失败会在会话中显示原因 |
| 文章生产 | 类型化初稿、标题、去 AI、审稿、SEO、字数与事实门禁、版本修订、公众号 HTML 排版 |
| 视觉交付 | 900×383 封面图、配图工作台、Mermaid / ECharts 转图、公众号预览、逐页社交图文 PNG |
| 独立创作 | 心得经验、使用教程、本地项目只读导入、批次早报和突发任务 |
| 扩展与运维 | 技能包、工具插件、采集器插件、动态配置、能力路由、执行审计、Run Trace、备份恢复和主题中心 |

## 5 分钟开始

### 环境

- Windows 10/11（当前完整验证平台）
- Node.js 24 或更高版本
- 至少一个 OpenAI 兼容模型服务；只浏览演示数据时可不配置
- 可选：Chrome、RSSHub、Python 3、Tavily、GitHub Token、又拍云

### 支持矩阵

| 平台 | 状态 | 说明 |
|---|---|---|
| Windows 10/11 | ✅ 完整验证 | 推荐平台，安装脚本和演示模式均已验证 |
| macOS | 🧪 实验性 | 提供启动脚本，尚未作为维护者验收平台 |
| Linux | ✅ 完整验证 | 提供启动脚本，尚未作为维护者验收平台 |

### 安装与启动

最简单的方式是双击：

1. `setup-workbench.cmd`：安装依赖并启动配置向导。
2. `start-workbench.cmd`：启动后自动打开 `http://127.0.0.1:4317`。

也可以在 PowerShell 中运行同样的引导脚本：

```powershell
setup-workbench.cmd
start-workbench.cmd
```

## 推荐的首次使用顺序

1. 在“运行与配置 → 模型接入”添加并测试模型。
2. 在“采集源”添加 RSS、Reddit 或“网页自动采集”来源，并先执行测试预览。
3. 创建每日批次，运行采集、打标、事件卡和研判。
4. 从文章池或图文池选择候选，完成编辑决策与事实确认。
5. 生成文章、排版或图文产物，在产物柜中统一查看。

完整的页面说明、常见任务、登录 Profile、备份恢复和故障排查见[详细使用手册](./docs/user-guide.md)。

## 对话 Agent 与失败诊断

编辑室、自主写作和自定义图文对话共享同一套 ToolCall Agent 协议，可以在一轮会话中按需组合网页抓取、段落检索、联网搜索、项目读取和表单更新。默认预算为 6 个模型步骤、10 次工具调用、单次工具结果 12,000 字符、总工具结果 64,000 字符和 180 秒超时；重复工具调用仍受防护，硬上限仍保留。

对话过程中的工具失败、模型输出错误和预算耗尽会以明确提示呈现在会话中，相关模型调用、工具执行、步骤和 checkpoint 可在“任务日志”通过 Run Trace 追踪。生成运行会冻结当时的模型、技能、工具和预算快照，修改默认配置不会改变已经开始的运行。

## 项目结构

```text
server.mjs              HTTP 服务装配与静态资源入口
server/platform/http/routes/        API 路由
server/platform/core/               配置、Store 与工作区路径
server/platform/llm/                模型网关、AI 任务与内容流水线
server/platform/skills/ + skills/   技能运行时与内置技能
server/platform/tools/ + plugins/   工具、采集器与能力注册中心
server/shared/themes/             文章、图文与封面主题
public/                 原生 ES Modules 前端
data/                   SQLite、配置状态、缓存与扩展目录（运行时生成）
articles/ topics/ social-cards/  内容产物（运行时生成）
```

架构细节见[架构总览](./docs/architecture.md)。

## 架构图

| 图表 | 说明 |
|---|---|
| ![功能架构图](docs/diagrams/architecture.png) | **功能架构图** — 整体系统分层：前端 SPA、HTTP 服务层、Agent Harness、平台核心层、业务特性层、共享领域层、存储与插件系统 |
| ![Agent Harness](docs/diagrams/harnessDetail.png) | **Agent Harness 内核** — 统一 Agent 运行生命周期、上下会话技能、工具、权限、恢复与评测 |
| ![主流程](docs/diagrams/mainWorkflow.png) | **主流程时序图** — 用户操作 → 路由分发 → runSkill → AI/DB 操作 → 响应渲染的完整数据流 |
| ![素材简报](docs/diagrams/materialBriefFlow.png) | **素材简报贯穿链** — 研判素材 → 编辑会锁定 → 成稿流水线兑现的写作文契约链路 |
| ![批次管线](docs/diagrams/batchPipeline.png) | **批次自动化管线** — 从数据采集到稿件生成的完整流水线，模型阶段统一经 Harness stage-skill 运行 |

> 架构图由 [LikeC4](https://likec4.dev/) 从 `likec4/model.c4` 生成，更多视图（runSkill 时序、素材简报、持久化层与 Run Store）见[架构总览](./docs/architecture.md)。

## 配置与数据

- 默认配置内置于代码，工作区覆盖写入 `config.local.json`。
- 模型和扩展配置优先在界面的“运行与配置”中维护。
- 交互式 Agent 的执行预算在 `config.local.json` 的 `conversationAgent` 中覆盖；完整字段和安全边界见[配置文档](./docs/configuration.md)与[安全默认值](./docs/safety-defaults.md)。
- 秘密凭据可使用配置中心的凭据字段或对应环境变量回退，不写入 SQLite 备份。
- 主数据库为 `data/workbench.db`，使用 Node.js 内置 `node:sqlite` 和 WAL。
- 内容产物保存在 `articles/`、`topics/`、`social-cards/`；运行日志在 `logs/`。
- 可从“设置与数据 → 备份与恢复”导出带 SHA-256 清单的 ZIP。

完整字段参考见[配置文档](./docs/configuration.md)，数据外发边界见[数据流说明](./docs/data-flow.md)。

## 开发与验证

```powershell
npm ci
npm run dev
npm run build
npm run test:fast
# 完整测试
npm test
```

扩展开发：

```powershell
npm run skill:validate -- docs/examples/skill-package
npm run plugin:validate -- docs/examples/tool-plugin
```

详细契约、Manifest 字段、Adapter 接口、安全规则和发布清单见[插件开发指南](./docs/plugin-development.md)。

## 文档导航

- [详细使用手册](./docs/user-guide.md)
- [API 参考](./API.md)
- [插件开发指南](./docs/plugin-development.md)
- [配置参考](./docs/configuration.md)
- [架构总览](./docs/architecture.md)
- [安全边界](./SECURITY.md)与[威胁模型](./docs/threat-model.md)
- [发布、升级与恢复](./docs/release.md)
- [完整文档索引](./docs/README.md)

## 当前边界

- Windows 10/11 是当前完整验证平台；macOS / Linux 处于实验性支持阶段，启动脚本已提供，但尚未作为维护者验收平台。
- 仅面向本机可信用户，不具备公网部署所需的认证、CSRF 防护和多用户授权。
- 网页自动采集面向新闻、公告、博客和榜单等重复列表页；验证码、复杂登录、多步骤交互和任意脚本不在自动配置范围内。
- 本地项目读取结果只证明文件中存在相关材料，不证明命令已经真实执行成功。
- AI 输出必须经过结构、事实和交付门禁；仍需作者确认观点、来源、版权与发布风险。

## 许可证

代码采用 [MIT License](./LICENSE)。第三方材料与许可证见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。“见字”名称和印章样式仅用于标识本项目官方版本，衍生产品不得暗示官方关联或背书。
