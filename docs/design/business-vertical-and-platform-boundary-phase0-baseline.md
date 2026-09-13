# 业务垂直能力与平台能力边界调整：阶段 0 基线

> 日期：2026-09-13  
> 基线提交：`04c2a4b9cb2c3e8410d4b2c2702aa234b6eaca9f`  
> 分支：`master`

本记录对应[业务垂直能力与平台能力边界调整方案](business-vertical-and-platform-boundary-adjustment-plan.md)的阶段 0。阶段 0 本身只建立可回归基线；随后进入阶段 1 时新增了兼容入口，但没有迁移旧实现、改动路由或改变运行时行为。

## 1. 门禁结果

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `npm test` | 通过 | 1777/1777，约 43 秒 |
| `node --test test/vertical-architecture.test.mjs` | 通过 | 17/17 |
| `npm run test:e2e` | 通过 | 8/8；临时 SQLite + 回环 HTTP + fake model 的文章/图文双轨主链路和异常矩阵 |
| 浏览器 UI Smoke | 通过 | Puppeteer 隔离静态前端，覆盖首屏 → 文章生产 → 素材入箱 → 快速记素材 |
| `npm run architecture:report` | 通过 | 报告 6 个已知 domain 边界问题，不阻断兼容期 |

结论：单元、集成、架构门禁、最小 HTTP 主链路 Smoke、异常矩阵、浏览器 UI Smoke 和完整双轨 E2E 均稳定通过，已满足进入阶段 1 的前置条件。

## 2. 当前垂直目录快照

| 垂直 | 当前子目录 | `.mjs` 文件数 | 阶段 0 判断 |
| --- | --- | ---: | --- |
| `articles` | `application/domain/llm/rendering` | 31 | 已有分层，但 `llm` 中仍有完整写作管线 |
| `batches` | `application` | 7 | 作为批次编排垂直保留 |
| `collection` | `application/domain/llm` | 13 | 采集业务能力归属合理，需继续隔离平台采集运行时 |
| `content-planning` | 无子目录 | 12 | 当前混合素材入箱、内容计划、反馈闭环，优先拆分 |
| `research` | `application/domain/llm/rendering` | 30 | domain 与基础设施、模型调用仍有混合 |
| `social-cards` | `application/domain/llm/prompts/rendering` | 16 | 故事板与图文渲染边界仍需收敛 |

阶段 0 确认：素材入箱历史上通过 `content-routes.mjs` 的 `/api/writing-materials` 处理，底层 SQL 由 `ContentPlanningRepository` 承载。阶段 2 已将评估规则和用例编排迁入 `features/materials/domain` 与 `features/materials/application`，由独立 `MaterialRepository` 接管 Store 的素材读写边界，并将素材全部 HTTP 路由迁入 `material-routes.mjs`；查询富化仍复用 content-planning 的确定性推荐能力。

## 3. 接口边界冻结

本阶段冻结以下现有公开入口，后续迁移必须保持 HTTP 方法、路径、状态码和核心响应字段兼容：

- 素材：`/api/writing-materials`、`/api/writing-materials/:id`、`/api/writing-materials/:id/assessment`；
- 内容规划：`/api/content-columns`、`/api/writing-material-plans`、`/api/writing-material-briefs` 及其生成/确认入口；
- 内容反馈：`/api/wechat/import`、`/api/wechat/matches`、`/api/wechat/content-links`、`/api/wechat/feedback` 及调整入口；
- 文章与图文交付：`/api/article-publications`、`/api/article-artifacts`、`/api/artifacts`、`/api/calendar`；
- 批次、候选、任务和 Run Trace：现有 `/api/batches`、`/api/candidates`、`/api/jobs`、`/api/runs` 系列入口。

当前 `content-routes.mjs` 仍同时承载规划、反馈、文章发布、产物和日历等多类业务；阶段 2 已拆出全部素材 HTTP 路由，并通过响应契约、E2E 和全量回归降低迁移风险。

## 4. 数据与关键产物快照

读取 `data/workbench.db` 的只读快照得到：

| 项目 | 数量/状态 |
| --- | ---: |
| 数据库迁移版本 | 45 |
| 非 SQLite 系统表 | 73 |
| 批次 | 71（completed 38、interrupted 14、review 19） |
| 热点 | 28,744 |
| 候选 | 1,123 |
| 文稿 | 160（draft 79、finalized 81） |
| 产物 | 4,537 |
| AI 运行记录 | 1,349（completed 973、failed 355、interrupted 21） |
| 采集源 | 54 |
| 写作素材 | 8 |
| 内容反馈快照 | 12 |
| 微信文章指标匹配 | 251 |

当前工作区关键目录仍存在：`data/workbench.db`、`topics/`、`articles/`、`social-cards/`、`output/`。这些目录和数据库在后续每一批迁移前都必须执行可恢复备份，并以迁移前后计数、任务状态和代表性产物做差异核对。

## 5. 阶段 0 验收与后续动作

- [x] 记录提交、分支和工作区状态；
- [x] 完成完整测试和现有架构门禁基线；
- [x] 冻结素材、规划、反馈、交付、任务与产物公开入口；
- [x] 记录数据库迁移版本、业务表计数和主要状态分布；
- [x] 补齐 E2E npm script，并建立隔离 HTTP 主链路 Smoke；
- [x] 扩展为素材入箱 → 简报/候选 → 文章与图文 → 产物 → 反馈的完整双轨 E2E；
- [x] 建立采集失败、模型失败、非法 JSON、超时/取消的 HTTP 异常矩阵；
- [x] 建立工作台浏览器 UI Smoke；
- [x] E2E 与 Smoke 稳定通过，允许进入阶段 1 的 facade 和依赖扫描调整。

当前阶段结论：阶段 0 基线、最小 HTTP Smoke、异常矩阵、浏览器 UI Smoke 和文章/图文双轨 E2E 均已建立并通过。阶段 1 的兼容 facade、职责说明和报告模式扫描已完成；阶段 2 已完成素材领域规则、application 用例、独立 SQL Repository 以及素材全部 HTTP 路由迁移；阶段 3 已完成 content-feedback 入口、公众号反馈路由拆分、反馈实现物理迁移，以及反馈 application/domain 拆分；阶段 4 已完成 research/domain 基础设施清理、account-context 文件访问拆分、Store 反向装配拆分，以及 Social Card 渲染、模板、业务对话和指标 Repository 的垂直归属调整；阶段 5 已删除旧兼容转发层，定向测试 `104/104`、全量测试 `1781/1781`、E2E `8/8`、架构边界扫描 `0` 违规，阶段 5 完成。
