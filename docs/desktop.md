# 桌面版开发说明

桌面版使用 Electron 作为窗口壳，继续运行现有 Node.js HTTP 服务。Electron 主进程不会把业务逻辑搬到前端，而是启动一个 Node.js 24 sidecar，再通过回环地址加载工作台页面。

## 本地运行

```powershell
npm run desktop:dev
```

开发启动时会优先使用仓库内的 `.node-runtime/node-v24.12.0/node.exe`。如果没有该文件，则回退到系统 `node.exe`/`node`；正式打包要求随应用携带 Node.js 24 运行时。

## 用户数据

桌面版默认将可写工作区放在 Electron 的用户数据目录下：

```text
<userData>/workspace/
  config.local.json
  data/
  articles/
  topics/
  social-cards/
  logs/
```

程序资源（`server/`、`public/`、`skills/`、`plugins/`、`themes/`）与用户工作区分离。服务端也支持 `WORKBENCH_CONFIG_ROOT` 和 `WORKBENCH_WORKSPACE_ROOT`，便于测试和后续加入工作区选择器。

## Windows 打包

```powershell
npm run desktop:dir  # 生成 dist/win-unpacked
npm run desktop:win  # 生成 Windows 安装包
```

当前 Windows 包使用 x64、NSIS 和外置 Node.js 24 运行时。构建产物包括：

- `dist/win-unpacked/`：已验证可启动的目录包；
- `dist/jianzhi-<version>-win-x64.exe`：NSIS 安装包。

RSSHub、Chrome 和 Python 仍是可选外部依赖，不会把仓库中的 RSSHub 源码和运行数据打进安装包。Reddit 采集使用包内的 Chrome 启动脚本，但 Chrome 浏览器本体仍由用户本机提供。

## 安装与桌面操作

Windows 安装包使用中文 NSIS 向导，允许选择安装目录，安装完成后默认启动“见字”。卸载时不会删除用户数据；工作区位于 `%APPDATA%/见字/workspace/`，需要清理数据时请在应用菜单中打开数据目录后人工处理。

安装包只负责安装应用本体和随包的 Node.js 运行时，不自动安装 RSSHub、Chrome 或 Python。首次启动后可从“采集源”和“运行与配置中心”确认采集环境；未就绪的采集能力不会参与批次采集。

桌面版提供原生“工作区 / 查看 / 窗口 / 帮助”菜单，以及以下常用操作：

- `Ctrl+1`–`Ctrl+4`：切换总览、批次、采集源和文章编辑器；
- `Ctrl+N`：新建今日批次；
- `Ctrl+Shift+M`：快速记素材；
- `Ctrl+B`：收起或展开侧栏；
- `Ctrl+/`：打开快捷键说明。

页面主体仍保持编辑台的内容密度和视觉主题，但窗口菜单、快捷键、工作区目录、日志入口和可收起侧栏由 Electron 桌面壳负责，减少把它当成普通网页使用时的割裂感。
