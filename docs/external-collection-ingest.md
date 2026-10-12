# X / 微信公众号外部采集入口

工作台把 X 和微信公众号的供应商调用放在主项目外部，主项目只接收统一条目契约。这样可以切换 TwexAPI、极致了/大佳拉、RSSHub 或自有脚本，而不改事件聚合和热点排行。

## 配置

启动工作台前设置环境变量：

```powershell
$env:WORKBENCH_INGEST_TOKEN = '替换成随机长令牌'
```

接口仍受本地回环和 CSRF 边界保护，因此调用脚本需要同时携带工作台会话的 `X-CSRF-Token`。接口令牌使用 `Authorization: Bearer ...`，不能把供应商 API Key 当作工作台令牌。

## 请求契约

`POST /api/ingest/items`：

```json
{
  "batchId": "2026-09-30-01",
  "channel": "x",
  "sourceId": "@openai",
  "sourceName": "OpenAI",
  "items": [
    {
      "id": "tweet-123",
      "title": "原始标题或首句",
      "url": "https://x.com/openai/status/123",
      "summary": "可选摘要",
      "author": "OpenAI",
      "publishedAt": "2026-09-30T01:00:00Z",
      "raw": {}
    }
  ]
}
```

`channel` 支持 `x`/`twitter` 和 `wechat`/`mp`；一次最多 50 条。同一请求中相同 URL 只保留第一条，来源、渠道、采集时间会写入 `raw_json`，并进入现有热点、来源运行和事件聚合链路。

公众号调用官方 API 只适合自有账号；竞品或外部账号应使用已授权的第三方接口或 RSS/网页采集，再通过本入口送入。供应商的抓取频率、重试和合规策略不放进事件聚合主流程。
