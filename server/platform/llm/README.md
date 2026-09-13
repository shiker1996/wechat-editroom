# llm

## 职责

LLM 网关、模型 JSON 解析、上下文安全、预算和技能运行时等通用模型基础设施。

## 依赖边界

只提供模型能力，不拥有业务流程和业务 Prompt；feature 专用模型任务由对应 `features/*/llm/` 或 `application/` 管理，跨垂直技能 Prompt 加载位于 `platform/skills/`。本目录不保留业务兼容转发层。
