# Agent Runtime adapters

## 职责

将外部 Agent 执行平台接入统一的 Agent Runtime 协议。Adapter 负责平台连接、调用生命周期和事件转换，不负责业务提示词、工作流顺序、数据访问策略或领域校验。

## 边界

- `codex-app-server.mjs` 驱动 Codex app-server 子进程，并将文本增量、工具请求、完成、失败和取消映射为 Runtime 事件。
- OAuth 凭据由 `server/platform/integrations/` 管理；Adapter 通过注入的令牌提供器获取短期访问令牌，不读取其他 CLI 的私有凭据文件。
- 所有工具请求交回 Harness 的 Tool Broker 执行；Runtime 本身不直接访问业务 Store、文件系统或 HTTP API。
- 新平台需实现同一 Runtime 接口并声明通用能力，由 Runtime Registry 注册。Skill manifest 不写入平台名称。

批次阶段由 `pipeline-runtime.mjs` 把已组装的项目提示词交给选定 Runtime，原 Workflow 继续负责重试、JSON 解析、领域校验和持久化。
