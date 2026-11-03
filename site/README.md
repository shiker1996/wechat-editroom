# 见字教程网站

`site/` 是独立的静态部署目标，适合发布到 Vercel：

- 产品定位与工作流介绍
- 从热点到文章的快速教程
- 教程视频与工作台界面快照（快照注明录制时间；旧版封面和排版画面不展示）

公开代码与 Windows 桌面版发布仓库：<https://github.com/shiker1996/wechat-editroom>

## Vercel 部署

在 Vercel 创建一个新 Project，连接当前仓库并将 **Root Directory** 设置为 `site`。这是纯静态站点，不需要配置 Node Server，也不需要连接生产数据库。

## 界面素材刷新

站点展示教程视频和工作台界面快照。截图不是实时页面；界面有变化时，应重新录制相关截图、同步更新 `site/index.html` 中的录制日期与说明，并审阅后再部署。避免展示已移除或已过时的操作项。

仓库中的 `.github/workflows/vercel-deploy.yml` 可在配置 Vercel Secrets 后自动部署 `site/`。

## Windows 桌面版发布

Windows 桌面版由仓库根目录的 `.github/workflows/desktop-release.yml` 构建，不需要把安装包提交到 Vercel：

- 推送以数字开头的版本标签（例如 `0.8.1`）时，当前公开仓库 `wechat-editroom` 的 GitHub Actions 在 Windows Runner 上安装依赖、准备随包 Node.js 运行时和固定版本的 RSSHub 源码；
- `npm run desktop:win` 生成 NSIS 安装包；
- 安装包和 blockmap 同时上传到 GitHub Actions Artifact，并发布到 GitHub Release；
- 手动运行 workflow 时只生成 Artifact，不自动创建 Release。

教程站点通过 `wechat-editroom` 的 GitHub Releases `latest` 页面提供下载入口。发布新版本时，先确认构建通过，再推送例如 `0.8.1` 的标签即可。
