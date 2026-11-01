# WorkBuddy 连接器

此目录提供 WorkBuddy 开放平台 MCP 连接器的元信息、stdio 配置模板、技能源文件和图标。连接本地工作台要求 WorkBuddy MCP 子进程运行在可访问见字项目文件和 `127.0.0.1:4317` 的同一台电脑上。

开发时可直接运行：

```powershell
node scripts/agent-integration/cli.mjs install --agent workbuddy
```

该命令生成项目级 `.mcp.json`，并复制技能到 `.codebuddy/skills/`。模板中的 `<JIANZI_PROJECT_ROOT>` 需要替换为实际项目路径。若使用 WorkBuddy 连接器市场，将目录作为基础包，并按开放平台要求补充图标、运行时声明与审核元数据；连接器市场发布需要平台侧审核。
