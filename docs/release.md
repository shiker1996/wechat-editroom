# 发布流程

本项目以源码仓库分发（不发布 npm 包），发布物为带校验和的源码归档。版本号唯一来源是 `package.json` 的 `version`（`server/version.mjs` 统一读取），遵循语义化版本，兼容政策见 [CHANGELOG.md](../CHANGELOG.md)「兼容政策」一节。

## 发布新版本

1. 确认 `master` 全绿：`npm run build && npm test`（CI 也必须通过）。
2. 更新 `CHANGELOG.md`：把 `[Unreleased]` 内容归入新版本号并写日期，同步更新文件底部的比较链接。
3. 确认 `[Unreleased]` 内容、版本 tag 与发布范围一致；无需手工修改项目或插件清单版本。
4. 提交并打 tag：`git tag <version>`（如 `1.0.7`，不加 `v` 前缀）；workflow 会把该 tag 用作本次构建版本。
5. 推送：`git push origin master --tags`。
6. 生成统一发布包与校验和：

   ```powershell
   node scripts/release/release.mjs
   ```

   产物在 `dist/`：源码 `<name>-<version>.zip`、独立 DSH 插件 `<plugin-name>-<version>.tgz` 与 `SHA256SUMS.txt`。tag 是构建版本的唯一来源；workflow 先同步更新临时工作区的项目与插件版本，再构建 Windows 安装包和插件包，源码 ZIP 也包含相同版本。插件源目录的 `package.json` 不需要手工改版本。
7. tag 推送后，GitHub Actions 会从 tag 戳记版本、构建 Windows 安装包，并把安装包、源码 ZIP、DSH 插件 `.tgz` 与校验和一起发布到 GitHub Release。正文由 Actions 根据本次 tag 范围内已合并的 PR 自动生成，不要用 CHANGELOG 段落覆盖。需要把该版插件发布到 npm 时，推送 `dsh-plugin-v<版本>` 标签；工作流会从标签提取版本，并先检查 npm registry 中不存在该包版本，重复则失败，再打包发布。
8. 用户侧校验下载完整性：`certutil -hashfile <zip> SHA256`（Windows）或 `shasum -a 256 <zip>`，与 `SHA256SUMS.txt` 比对。

## Release 正文规范

- Release 正文按 PR 标签分组：`enhancement` → Features、`bug` → Bug fixes、`documentation` → Documentation、`dependencies` → Dependencies、`github_actions` → CI and maintenance；未匹配这些标签的 PR 放在 Other changes。
- PR 条目使用 PR 标题和 PR 编号链接。标题以 Conventional Commit 前缀（如 `feat:`、`fix:`、`chore(deps):`）开头时，生成正文会移除该前缀；请保持标题简洁、能独立说明用户可见的改动。
- 合并 PR 时由维护者添加最合适的分类标签。`CHANGELOG.md` 仍是版本历史的人工维护来源；自动生成的 GitHub Release 正文由 PR 标签和标题生成，两者用途不同。

## 升级

- 从源码升级：`git pull && npm ci && npm run build`，然后重启工作台。数据库 Schema 迁移是幂等、只增式的，启动时自动执行，旧库直接启动即可（见 CHANGELOG 兼容政策）。
- 从发布包升级：解压新包到新目录，`npm ci && npm run build`，把旧目录的 `data/`、`articles/`、`topics/`、`social-cards/`、`.env`、`config.local.json`、`account-context.json` 复制过去后启动。
- 升级前建议先在「设置与数据」页面导出一次备份。

## 降级

- 数据库迁移只增不回退：新版本打开过的数据库可能含有旧版本不认识的表 / 列。降级前必须恢复升级前的备份（旧版本不保证能读懂新库）。
- 降级步骤：停止服务 → 用升级前的备份包恢复（或重新克隆旧 tag 后复制数据目录）→ 启动旧版本。

## 备份与恢复

- 备份：「设置与数据」页面导出备份包，内含数据库快照、运行配置状态、技能包与插件目录；清单逐文件记录大小与 SHA-256（`schemaVersion: 1`）。
- 恢复：恢复是显式破坏性操作——服务端强制校验备份清单版本与逐文件哈希，恢复前自动保存当前快照，校验或恢复失败可回滚；界面需提交确认头才会执行。
- 手动兜底：停止服务后直接复制 `data/` 等运行目录；彻底删除数据则停止服务后删除上述目录与根目录 `.env`（LLM 与插件凭据不写入数据库）。
