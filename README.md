# 见字 · 公众号编辑工作台

[中文](./README.md) · [English](./README.en.md)

> **从热点到成稿，把公众号内容生产变成一张可以回头检查的工作台。**

见字不是一个“输入主题、等待生成”的聊天框，而是一套面向真实内容生产的本地 AI 编辑工作台：

**找热点 → 研判事实 → 做编辑决策 → 写稿 → 审稿 → 排版 → 交付文章、封面与图文。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows&logoColor=white)](./docs/user-guide.md#1-安装与启动)
[![Latest Release](https://img.shields.io/github/v/release/shiker1996/wechat-newsroom-workbench?label=latest%20release)](https://github.com/shiker1996/wechat-newsroom-workbench/releases/latest)

<p align="center">
  <img src="docs/screenshots/ui-demo.gif" alt="见字工作台：从热点到选题、文章和交付产物" width="760">
</p>

<p align="center">
  <a href="https://github.com/shiker1996/wechat-newsroom-workbench/releases/latest">下载 Windows 桌面版</a> ·
  <a href="https://wechat-newsroom-guide.vercel.app/">在线体验导览</a> ·
  <a href="https://github.com/shiker1996/wechat-newsroom-workbench/issues">反馈问题</a>
</p>

## 它适合谁？

- 想持续做公众号，而不是偶尔让 AI 代写一篇文章的作者。
- 需要把热点、来源、判断、稿件和交付物放在一起管理的内容团队。
- 想把文章、封面、小红书图文和排版流程统一起来的个人创作者。

## 你可以用它做什么？

### 从热点开始，而不是从空白输入框开始

连接 RSS、RSSHub、Reddit、GitHub 或网页来源，把值得关注的信息收进工作区。每个来源都可以测试、暂停和追踪最近采集结果。

### 让 AI 参与判断，但把编辑权留给你

热点打标、事件聚类、事实卡、受众相关度和候选选题会分阶段保存。你可以知道一篇文章为什么被选中、依据了哪些来源，也可以在关键节点停下来修改方向。

### 从选题一直走到可交付产物

文章生产、审稿、SEO、公众号 HTML、封面图、Mermaid / ECharts 图表和逐页图文都在同一个工作区完成，产物、版本和失败原因都能回看。

### 像桌面软件一样工作

Windows 桌面版提供原生窗口、菜单、快捷键、首次使用引导和可选运行数据目录。文章、图片与日志默认保存在本机；RSSHub 等较大的外部依赖按需启用，不会在安装时一次性下载。

## 为什么不是 ChatGPT + 秀米？

ChatGPT 和秀米仍然可以是工作流中的工具，但它们之间缺少一张“编辑桌”：

| 传统做法 | 见字 |
|---|---|
| 在多个网站之间复制热点和来源 | 信息源、热点、事实和选题集中管理 |
| 依靠聊天记录记住为什么选这个题 | 编辑判断和事实依据按阶段留下 |
| 写完文章后再手动找工具排版、做图 | 文章、HTML、封面和图文进入同一个产物柜 |
| 出错后只能重新来一遍 | 任务日志、版本和失败阶段可以追踪 |

## 五分钟开始

1. 从 [GitHub Releases](https://github.com/shiker1996/wechat-newsroom-workbench/releases/latest) 下载 Windows 安装包。
2. 安装时选择应用目录和运行数据目录。
3. 首次启动按应用内引导配置一个 OpenAI 兼容模型。
4. 添加一个采集源，测试连接后创建今日批次。
5. 体验从采集、选题到文章或图文交付的完整流程。

普通用户不需要单独安装 Node.js。首次启动向导会告诉你哪些能力已经可用，RSSHub、Chrome 等外部能力可以在真正需要时再配置。

> 当前桌面安装包优先支持 Windows 10/11 x64。macOS 和 Linux 可以运行源码版本，但暂未提供对应桌面安装包。

## 先看效果

不想先安装？打开[在线教程与只读导览](https://wechat-newsroom-guide.vercel.app/)，先看看热点、选题池、文章编辑器和图文工作区的真实界面。

教程使用经过审核和脱敏的演示数据，不需要配置模型，也不会连接你的本地工作区。

## 本地优先，但不是“完全离线”

见字的工作区、文章、图片、日志和运行记录默认保存在本机。只有在你配置并使用模型、搜索、采集、图片或 CDN 服务时，相关任务输入才会发送给对应服务。

它适合可信的本机用户，不是面向公网的多人 SaaS。AI 生成内容仍需要人工确认事实、来源、版权和发布风险。

## 项目状态

- Windows 桌面版：当前主要发布和验证平台。
- 文章生产、公众号排版、封面和社交图文：持续完善中。
- macOS / Linux：源码实验性支持，桌面安装包暂未提供。

## 给开发者

如果你想参与开发、运行源码演示或研究本地优先的 Agent 工作流，请看：

- [详细使用手册](./docs/user-guide.md)：安装、配置、采集、写作、图文和排障。
- [桌面版说明](./docs/desktop.md)：Electron 开发、打包与发布。
- [完整文档索引](./docs/README.md)：配置、架构、插件、数据流和安全边界。

源码开发需要 Node.js 24+，具体命令和环境准备放在文档中，不作为普通用户的安装前置条件。

## 许可证

代码采用 [MIT License](./LICENSE)。第三方材料与许可证见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。“见字”名称和印章样式仅用于标识本项目官方版本，衍生产品不得暗示官方关联或背书。
