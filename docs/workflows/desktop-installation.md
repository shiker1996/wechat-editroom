# Windows 桌面版安装与运行数据目录 当前流程契约

## 用户目标与范围

- 用户安装 Windows 桌面版时，可指定文章、图片、缓存和日志的运行数据目录；安装后的应用启动时使用该目录。
- 本流程覆盖 NSIS 安装页到 Electron 主进程的目录交接，不覆盖业务数据迁移或卸载清理。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| Windows NSIS 安装器 | `build/installer.nsh` | 首次安装提供可编辑路径和文件夹选择器；升级时保留已保存的目录 |
| Electron 桌面启动 | `desktop/main.mjs` | 读取已保存的路径，创建工作区并启动本地服务 |
| Windows 打包 | `package.json`、`.github/workflows/desktop-release.yml` | 使用 electron-builder NSIS；CI 检查桌面包中的运行资源 |

## 阶段与数据流

1. 安装器检查 `%APPDATA%\wechat-newsroom-workbench\workspace-location.txt`；标记已存在时跳过首次选择页。没有标记时默认填入 `%APPDATA%\wechat-newsroom-workbench\workspace`。
2. 离开选择页时读取输入框路径，并调用 NSIS `CreateDirectory` 创建或复用目录。失败时显示路径并留在页面。
3. 安装器在 `%APPDATA%\wechat-newsroom-workbench\workspace-location.txt` 写入纯文本路径；写入失败时显示错误并阻止安装继续。
4. Electron 主进程从 `app.getPath('userData')\workspace-location.txt` 读取绝对路径；标记缺失或无效时回退到默认 `app.getPath('userData')\workspace`。
5. Electron 主进程递归创建工作区；目录后续初始化失败由应用启动错误处理负责。

文件夹选择器可能因 Windows ACL 无法枚举某个盘符或目录。输入框允许直接填写路径；绕过浏览器只绕过目录枚举，安装器仍会执行创建和写入验证。

## 入口间差异

- 安装器负责目录存在性、实际写权限和路径持久化；桌面应用负责读取路径并初始化工作区。
- NSIS 安装器与 Electron 主进程共用同一 AppData 标记路径；没有注册表路径配置。

## 产物与验证

- 安装产物：`dist/jianzi-<version>-win-x64.exe`。
- 本地预打包构建：`npm run desktop:win:from-dir`；NSIS 编译成功后仍需在 Windows 安装环境验证实际目录权限与首次启动。

## 变更触点

- 安装页和路径持久化：`build/installer.nsh`。
- 运行时路径读取和工作区初始化：`desktop/main.mjs`。
- 构建与发布检查：`package.json`、`.github/workflows/desktop-release.yml`。
