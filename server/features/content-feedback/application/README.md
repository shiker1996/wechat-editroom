# content-feedback/application

## 职责

承载内容反馈垂直的用例编排：读取授权范围内的文章产物、调用外部正文抓取、通过 Store 保存关联快照，并返回 API 所需的业务结果。

## 当前模块

- `article-content-linking-service.mjs`：公众号文章与本地/外部正文关联。
- `wechat-review-service.mjs`：从 Store 组合公众号文章、图文轨道和反馈读模型。
- `social-content-feedback-service.mjs`：读取图文交付产物并将输入交给领域规则生成图文反馈快照。
- `feedback-adjustment-service.mjs`：编排模型反馈、技能包/账号配置草案生成与确认写入。
- `social-feedback-adjustment-service.mjs`：编排图文故事板和文案技能反哺草案。

这里可以依赖 platform 适配器和 Store，但不应承载 HTTP 路由细节；纯规则应继续下沉到 `../domain`。
