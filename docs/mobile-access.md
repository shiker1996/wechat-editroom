# 移动端使用工作台

见字目前不是原生手机 App，但工作台页面本身是响应式网页。最适合旅行期间的方式是：让家里的 Windows 电脑继续运行工作台，手机通过私有组网访问它。

## 推荐方案：Tailscale + Tailscale Serve

这套方案不需要把项目端口暴露到公网，也不需要修改工作台当前的本地优先架构。Tailscale Serve 会把本机的 `127.0.0.1:4317` 代理到你的 tailnet，并提供 HTTPS；只要手机和电脑登录同一个 Tailscale 网络，手机浏览器就能访问。不要使用 Funnel，Funnel 是公开互联网入口。

### 出发前一次性配置

1. 在 Windows 电脑安装 [Tailscale](https://tailscale.com/download/windows)，在手机安装 [iOS / Android 客户端](https://tailscale.com/download)。两端登录同一个账号或同一个 tailnet。
2. 在电脑启动工作台：

   ```powershell
   .\start-workbench.cmd -NoBrowser
   ```

   默认端口是 `4317`，本机地址是 `http://127.0.0.1:4317`。

3. 在电脑的 PowerShell 中建立私有 HTTPS 入口：

   ```powershell
   tailscale serve --https=443 http://127.0.0.1:4317
   tailscale serve status
   ```

   `status` 输出中会显示一个 `https://...ts.net` 地址。把这个地址保存到手机书签中。

4. 先关闭手机 Wi‑Fi，改用 4G/5G，打开上一步的地址，确认可以看到“见字”工作台。测试通过后，可以在手机浏览器中选择“添加到主屏幕”。

### 每次出发前检查

- 电脑没有进入睡眠；锁屏可以，但睡眠会让服务不可访问。
- `start-workbench.cmd` 已经启动，且电脑上的 `tailscale serve status` 仍显示入口。
- 手机 Tailscale 已连接。
- 用手机蜂窝网络重新打开一次工作台，而不是只在家中 Wi‑Fi 下测试。
- 不要在路由器上做端口转发，不要执行 `tailscale funnel`。

### 手机上适合做什么

手机浏览器适合查看批次、热点、选题、文章和日志，补充素材，修改文章，以及发起已经配置好的 AI 流程。文章封面、图文 PNG、Mermaid / ECharts 等任务仍由家里电脑上的 Node 服务和本地渲染依赖执行；电脑必须保持运行，任务才会继续。

## 备选方案

### 同一 Wi‑Fi 临时使用

当前服务硬编码监听 `127.0.0.1`，所以即使手机和电脑连在同一个 Wi‑Fi，也不能直接用电脑的局域网 IP 访问。这条路需要修改监听地址并补充访问控制，不建议为了短期旅行临时打开。

### 云端部署

可以把项目部署到一台长期在线的 Windows 云主机或自有服务器，再通过 VPN 访问。但工作区、SQLite、文章图片、Chromium 和本地插件都需要一起迁移，并且当前项目不是面向公网的多人 SaaS；这适合长期改造成远程版，不适合作为中秋出行前的快速方案。

## 安全边界

项目当前没有公网登录鉴权，`x-action-confirm` 等请求头也不是访问控制。因此只使用 Tailscale Serve 的私有入口，并依靠 tailnet 的设备/账号访问控制；不要把 `4317` 直接映射到公网，也不要把工作台部署到公开 URL。

如果手机访问失败，按这个顺序排查：

1. 电脑上确认 `http://127.0.0.1:4317/api/overview` 能打开。
2. 确认 `tailscale status` 中电脑和手机都在线。
3. 确认使用的是 `tailscale serve status` 显示的完整 HTTPS 地址。
4. 确认手机没有退出 Tailscale，电脑没有睡眠。
5. 查看 `tailscale serve status`；若入口被重置，重新执行 Serve 命令。
