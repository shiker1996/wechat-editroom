# materials

素材资产业务垂直，负责作者或用户产生的素材：入箱、查询、编辑、状态流转、来源与证据，以及基础评估。

当前处于阶段 2 迁移期。`index.mjs` 冻结公开能力清单，素材基础评估规则已经迁入 `domain/material-assessment.mjs`；素材持久化先由 `MaterialRepository` 兼容适配层承接，底层 SQL 暂仍复用旧 Repository，待回归稳定后再拆分。

依赖边界：

- `domain/` 只放素材规则和值对象，不读写文件、数据库或调用模型；
- `application/` 编排素材用例，通过 platform port 访问持久化和外部能力；
- 文章、图文和自主写作只能通过本垂直稳定入口读取素材，不直接依赖内部实现；
- 素材简报、主线候选和锁定命题属于 `content-planning`，不在本垂直内实现。
