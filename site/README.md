# 见字教程网站

`site/` 是独立的静态部署目标，适合发布到 Vercel：

- 产品定位与工作流介绍
- 从热点到文章的快速教程
- 本地真实工作流 GIF 与工作台截图

公开代码仓库：<https://github.com/shiker1996/wechat-newsroom-workbench>

## Vercel 部署

在 Vercel 创建一个新 Project，连接当前仓库并将 **Root Directory** 设置为 `site`。这是纯静态站点，不需要配置 Node Server，也不需要连接生产数据库。

## 界面素材刷新

站点展示当前工作台的真实截图和工作流 GIF。重新录制后，更新 `docs/screenshots/` 与 `site/assets/` 中对应的图片资源，审阅后再部署。

仓库中的 `.github/workflows/vercel-deploy.yml` 可在配置 Vercel Secrets 后自动部署 `site/`。

## Windows 桌面版发布

Windows 桌面版由仓库根目录的 `.github/workflows/desktop-release.yml` 构建，不需要把安装包提交到 Vercel：

- 推送以数字开头的版本标签（例如 `0.8.1`）时，GitHub Actions 在 Windows Runner 上安装依赖、准备随包 Node.js 运行时和固定版本的 RSSHub 源码；
- `npm run desktop:win` 生成 NSIS 安装包；
- 安装包和 blockmap 同时上传到 GitHub Actions Artifact，并发布到 GitHub Release；
- 手动运行 workflow 时只生成 Artifact，不自动创建 Release。

教程站点通过 GitHub Releases 的 `latest` 页面提供下载入口。发布新版本时，先确认构建通过，再推送例如 `0.8.1` 的标签即可。
