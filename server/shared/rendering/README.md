# rendering

## 职责

跨业务共享的渲染基元和展示辅助，不拥有 Social Card 专属模板。

## 依赖边界

可复用但不拥有具体 feature 编排；业务专属渲染和模板放对应 feature。shared 目录不得出现 Social Card 专属模块。
