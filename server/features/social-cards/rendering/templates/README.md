# Social Card rendering templates

## 职责

Social Card 专属模板包的目录入口。

## 依赖边界

模板只负责把已准备好的故事板内容编译为页面表现；生成、状态和持久化由 `features/social-cards/application` 负责，跨业务渲染基元由 `server/shared/rendering` 提供。
