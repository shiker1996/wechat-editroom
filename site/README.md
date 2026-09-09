# 见字教程网站与只读导览

`site/` 是独立的静态部署目标，适合发布到 Vercel：

- 产品定位与工作流介绍
- 从热点到文章的快速教程
- 脱敏生产批次的只读产品导览
- 演示模式 GIF 与真实工作台截图

公开代码仓库：<https://github.com/shiker1996/wechat-editroom>

## 生成演示数据

在项目根目录运行：

```bash
node scripts/demo/export-vercel-demo.mjs
```

脚本只导出批次摘要、热点标题、事件、选题和文稿元信息，不导出来源正文、模型配置、路径或运行日志。公开部署前仍应人工检查导出的 `demo-data.json`。

## Vercel 部署

在 Vercel 创建一个新 Project，连接当前仓库并将 **Root Directory** 设置为 `site`。这是纯静态站点，不需要配置 Node Server，也不需要连接生产数据库。
