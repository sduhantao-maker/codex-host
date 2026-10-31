# 个人 Fork 的侧聊功能与受控升级

本分支在 [sduhantao-maker/codex-host](https://github.com/sduhantao-maker/codex-host) 维护个人侧聊改动。`origin` 指向个人仓库，`upstream` 指向 [BytePioneer-AI/codex-host](https://github.com/BytePioneer-AI/codex-host)。`main` 跟踪上游基线，`iverson/sidechat` 保存个人改动。

Fork 保存代码与历史；原版 Codex Desktop 的私有界面和协议变化仍需逐版检查。每份验收记录应同时写明个人提交 SHA、上游稳定版 Tag 与 SHA、Codex Desktop 版本和构建号。

## 当前更新行为

此分支只查询上游版本和发布说明。`UPDATE_INSTALLATION_DISABLED_REASON` 固定在 `packages/update-manager/src/index.ts`，没有环境变量或用户设置开关。

Desktop 的 Host update coordinator 和独立控制台的 update service 都返回 `installationAvailable: false`，通过可选字段 `installationDisabledReason` 说明受控升级方式。查询成功时 `error` 仍为 `null`。设置页显示这段说明和上游发布信息，隐藏官方安装的手动命令与下载入口。直接调用服务的 `start()` 也会在安装目录解析、更新锁、下载及准备安装之前拒绝。控制台 HTTP 更新入口和 `codexhost update` 复用这些服务。

通用 `BackgroundUpdateManager` 保留上游实现，便于继续同步代码；运行中的更新入口不再调用它来准备或安装上游包。上游机制测试在测试模块内关闭这项策略，`controlled-updates.test.ts` 使用真实默认策略验证拦截行为。更新查询失败不会自动启动安装。

远程 npm Host 的 `RuntimeMaintenance.start()` 与 SSH 的 `setupSsh(action: "update")` 使用同一策略，在启动安装辅助进程前拒绝；检查、连接修复等操作保留。

## 文件位置

| 内容 | 位置 |
| --- | --- |
| 源码、依赖、开发文档和测试 | `/Users/iverson/Code/codex-host-sidechat` |
| 已构建安装包 | `/Volumes/Iverson/codexhost-sidechat/releases` |
| 脱敏验收记录及校验和 | `/Volumes/Iverson/codexhost-sidechat/verification` |
| Git bundle 和上一可用版本备份 | `/Volumes/Iverson/codexhost-sidechat/backups` |

构建在内置盘进行。外接盘是 ExFAT，应用包应先在内置盘封装成保留符号链接和权限的 DMG 或归档，再复制到外盘。日常程序、账号配置和聊天存储继续使用内置盘，拔掉外盘不影响已安装版本运行。

复制产物前确认 `/Volumes/Iverson` 已挂载且卷 UUID 与本地验收记录一致，复制后核对 SHA-256。外盘未挂载时停止归档，不在同名空目录继续写入。

## 同步一个上游稳定版

以下命令在源码目录执行。先检查 `git rev-parse --show-toplevel` 返回该源码目录，确认工作区没有待处理修改。遇到 `/Users/iverson` 仓库根目录时停止 Git 操作。

1. 读取上游 Release，选定稳定版 Tag，记录其 SHA；同步操作使用该 Tag，不把未验收的 `main` 当成稳定发布。
2. `git fetch upstream --tags` 后，将本地 `main` 快进到 `upstream/main`。个人改动留在 `iverson/sidechat`。
3. 从 `iverson/sidechat` 创建 `integration/sidechat-<upstream-tag>`，通过 `git merge --no-ff <upstream-tag>` 合并。逐项解决冲突，保留双方有效行为，不用强制同步覆盖个人分支。
4. 按实际 diff 选择检查。与本功能相关的最低集合包括 TypeScript 类型检查、对应 Host/存储/Renderer 测试、Renderer 构建、边界与格式检查。涉及 Rust 或打包脚本时增加其所属检查。
5. Codex Desktop 版本变化时运行 `npm run audit:codex-desktop`，再完成下述实际行为验收。记录每项结果及未完成项目，静态审计通过不替代真实续聊与重启验证。
6. 验收通过后把集成分支合并回 `iverson/sidechat`，记录提交，保留上一可用安装包与数据兼容说明。构建包的身份通过提交 SHA 和验收清单区分，不以界面版本号相同推定内容相同。

更新失败时保留当前运行版本，继续在集成分支修复。回退程序前核对侧聊存储兼容性；不要通过清空数据来完成回退。

`npm start` 及 `npm start -- --no-build` 会停止当前 Codex Desktop。安排真实启动时先结束或保留正在进行的工作，不把这两个命令当作普通构建检查。

构建使用 `package.json` 允许的 Node 版本和 `rust-toolchain.toml` 固定的 Rust 版本。可将工具链放入忽略的 `.codexhost/toolchain`，按单个命令设置 PATH、CARGO_HOME 和 RUSTUP_HOME；这些本机工具不进入 Fork，也不改变系统配置。

当前 Desktop 若只开放 Renderer CDP，旧的 `audit:codex-desktop` 主进程 Inspector 流程不能完成全部检查。应如实记录该项未验证，另做只读 Renderer 契约探针与 `tools/sidechat-installed-contract.test.mjs` 的已安装资源检查，不能将它们记成完整行为验收。

## 侧聊验收要求

该清单是个人分支的验收标准，实际通过情况以对应构建的记录为准。

- Codex 和 Claude Code 分别验证主对话运行中与完成后的侧聊创建、首条消息、连续对话、失败重试、转主。
- 未收纳和已收纳侧聊都验证关闭、超过旧过期阈值及 Host 重启后的原身份恢复和完整续聊；首条消息发出前的重启也要覆盖。
- 使用专门的侧聊测试内容核对父对话历史和请求，确认侧聊消息、指令和回答没有回写，且父对话没有因侧聊操作被中断或改写。
- 收纳只改变条目组织信息；项目、原父对话和侧聊身份采用稳定关联。验证同名对话、改名、移动、来源不可用及账号/主机隔离。
- 转主后保留完整侧聊历史和来源链接，成为独立对话，不合并回原主对话。
- 拔掉外盘后验证已安装版本仍能启动和读取侧聊；旧版数据升级及程序回退保留历史。

## 备份与发布边界

在外盘 `backups` 保存 Git bundle 时应核验 bundle 可读；bundle 只包含已提交 Git 对象，不替代未提交改动备份。凭据、真实聊天、原始运行日志及本地配置不进入公开 Fork。验收记录仅保留版本、统计、测试结果和脱敏错误。

本分支的日常升级使用本地受控构建。向个人仓库推送功能分支与发布软件是不同操作。仓库现有 `Release packages` 工作流匹配 `v*` 标签，不能用 `git push --tags` 当作普通备份；公开 Tag、Release、npm 包和上游 PR 按各自的明确发布范围办理。
