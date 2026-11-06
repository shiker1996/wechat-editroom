# 见字 DSH 内容工作台

DSH Desktop workbench bundle for the “热点/选题 → 文章 → 排版交付” flow. The DSH-native agent tools reuse the same `JIANZI_TOOLS` and `executeJianziTool` implementation as Jianzi's MCP server. They connect to the local Jianzi API at `http://127.0.0.1:4317` (override with `JIANZI_WORKBENCH_URL`).

Build from the repository root with `node agent-integrations/dsh-workbench/build.mjs`, then pack from this directory with `pnpm pack`. Start Jianzi before using its tools. The business panel links into Jianzi's existing screens; it does not copy business records into DSH.

The first release is for local installation. It is not listed in the DSH Workbench Market.
