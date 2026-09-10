# 见字教程网站与只读导览

`site/` 是独立的静态部署目标，适合发布到 Vercel：

- 产品定位与工作流介绍
- 从热点到文章的快速教程
- 脱敏生产批次的只读产品导览
- 本地只读预览 GIF 与真实工作台截图

公开代码仓库：<https://github.com/shiker1996/wechat-newsroom-workbench>

## 生成演示数据

在项目根目录运行：

```bash
node scripts/demo/export-vercel-demo.mjs
```

脚本只导出批次摘要、热点标题、事件、选题和文稿元信息，不导出来源正文、模型配置、路径或运行日志。公开部署前仍应人工检查导出的 `demo-data.json`。

## Vercel 部署

在 Vercel 创建一个新 Project，连接当前仓库并将 **Root Directory** 设置为 `site`。这是纯静态站点，不需要配置 Node Server，也不需要连接生产数据库。

## 公开数据刷新

公开站点使用 [`public-demo-batch.json`](./public-demo-batch.json) 固定批次。导出脚本不会自动选择最新生产批次，因此当天仍在运行的批次不会被意外发布。

刷新前请完成以下检查：

1. 确认批次已经完成，文章和图文产物已生成。
2. 人工检查标题、来源、内部路径和敏感信息，完成脱敏。
3. 修改 `public-demo-batch.json` 的 `batchId`，并保持 `reviewStatus` 为 `approved`。
4. 运行 `npm run site:export`，检查 `demo-data.json` 的批次日期和统计。
5. 重新生成截图 / GIF，审阅后再部署。

仓库中的 `.github/workflows/vercel-deploy.yml` 可在配置 Vercel Secrets 后自动部署 `site/`。

## Windows 桌面版发布

Windows 桌面版由仓库根目录的 `.github/workflows/desktop-release.yml` 构建，不需要把安装包提交到 Vercel：

- 推送以数字开头的版本标签（例如 `0.8.1`）时，GitHub Actions 在 Windows Runner 上安装依赖、准备随包 Node.js 运行时和固定版本的 RSSHub 源码；
- `npm run desktop:win` 生成 NSIS 安装包；
- 安装包和 blockmap 同时上传到 GitHub Actions Artifact，并发布到 GitHub Release；
- 手动运行 workflow 时只生成 Artifact，不自动创建 Release。

教程站点通过 GitHub Releases 的 `latest` 页面提供下载入口。发布新版本时，先确认构建通过，再推送例如 `0.8.1` 的标签即可。
