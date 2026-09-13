# materials/application

## 职责

编排素材入箱、查询、编辑和重评估用例，调用 `materials/domain` 的纯规则，并通过注入的 Repository 完成持久化。

## 依赖边界

不直接依赖数据库、文件系统、HTTP 或具体平台实现；由启动装配向服务注入 Repository 和评估上下文。
