# 个人 Fork stable 维护

`iverson/stable` 是个人 Fork 的日常候选线，源码位于 `/Users/iverson/Code/codex-host-stable`。`origin` 指向 [sduhantao-maker/codex-host](https://github.com/sduhantao-maker/codex-host)，`upstream` 指向 [BytePioneer-AI/codex-host](https://github.com/BytePioneer-AI/codex-host)。`main` 保留上游基线；实验性侧聊功能及其未提交改动留在独立的 `iverson/sidechat` 工作树。

stable 基于 v0.16.1，保留原样的 #564 cherry-pick 和受控升级提交，再用独立提交修正已核实的兼容性差异。收纳界面、永久侧聊、运行中侧聊分叉及实验开关不属于本分支。分支名称和构建成功都不等于已经通过日常验收。

## 行为范围

#564 让闲置、可写的外部 Thread 接受文本型 `thread/inject_items`，将其与下一条真实输入合并。委派入口保留原始任务文本，只合并待注入内容；Desktop 输入入口维持上游的提及处理。原生 Codex 侧聊继续使用原生路径。

待注入文本只保存在 Host 进程内。首条真实消息之前重启 Host，不能保证保留这段文本；stable 不承诺侧聊永久保存。没有可用 Fork checkpoint 的情况也不能列成 #564 已修复的能力。

## 受控安装与远程重启

更新页保留上游版本和发布说明查询，显示个人构建的受控升级说明，不提供会改变本地安装版本的官方包安装入口。新的安装包通过 Fork 的合并、验证和构建流程产生。

远程 npm Host 已安装版本与请求版本相同、且 `restartRequired` 为真时，允许原有的 restart-only 路径，使运行版本切换到已经安装的版本。相同版本且无需重启时，保持上游的无操作结果。改变已安装版本的请求仍被拒绝，并返回受控升级说明；调度后、启动辅助进程前还会复核版本，避免安装状态变化把重启变成安装。

`updateSupported` 表示原有运行时资源能力，不单独表示允许安装。Renderer 应同时使用 `installationDisabledReason` 和 `restartRequired`，保留同版本重启按钮，隐藏改变版本的安装操作。SSH 的 `setupSsh(action: "update")` 会执行安装，仍受禁更策略限制；连接检查和修复保留。

## 验证与同步上游

每次合并上游都记录候选提交、上游 Tag 与提交、Node/Rust 版本、Codex Desktop 版本和构建号。先核对 `git rev-parse --show-toplevel`，确认当前是预期的独立工作树；若返回 `/Users/iverson` 就停止 Git 操作。不要切换、清理或覆盖另一条线的未提交改动。

1. 选定上游稳定 Tag，在独立集成工作树合并，不把未经验证的上游 `main` 直接装入日常环境。
2. 使用 Node 24 和 `rust-toolchain.toml` 固定的 Rust 版本。对测试子进程设置新的临时 HOME，清除真实凭据和 live-test opt-in 环境；不修改全局环境或配置。
3. 运行完整 `npm run check` 和完整 `npm run test:e2e`。基线与候选使用相同环境和并行度，各自安装依赖，workspace 链接必须指向各自源码。
4. 若 `npm run check` 因前一阶段失败而短路，单独补跑剩余阶段，同时保留原命令的失败状态。逐项对照基线失败；不能通过改断言、放宽超时或只保留复跑成功来获得通过结论。新增的稳定复现失败须继续排查。
5. 按同一份实机 A/B 清单验证日常功能。固定模型、权限和测试目录，区分 Host 排队延迟与模型响应时间。真实会话、重启、审批和远程重启只在用户批准的窗口执行。
6. 通过约定验收并由用户决定切换后，才将候选作为日常版本。保留上一可用 App、数据归档、对应提交和验收记录；更新失败时保留当前安装。

## DMG 切换与回退

本机使用 DMG 安装。**切换以该候选交付目录中的 `stable-v2-dmg-switch-runbook.md`、A/B 清单和产物校验记录为准**，不要使用 `install-local.sh`，也不要从旧报告复制 SHA。

日常候选包保存在 `/Volumes/Iverson/codexhost-sidechat/releases/stable/`；验证记录保存在外盘 `verification/stable-v2/`；App、Git bundle 和数据归档保存在 `backups/`。外盘为 ExFAT，App 先在内置盘封装成 DMG/ZIP，不能用外盘上的散装 App 目录代替保留权限和符号链接的归档。

切换前应在应用正常退出、相关后台进程和数据占用者均停止后，归档 `/Users/iverson/.codexhost` 和 `/Users/iverson/.codex`。归档记录 SHA-256、常规文件/目录/符号链接数量，并验证权限和链接读回。这两处不包含 `.claude` 等其他 Harness 自有存储，不能称为所有 Harness 历史的完整备份。

操作单要求先保存当前 App，再校验候选 DMG、只读挂载、用 `ditto` 替换原路径、验签，并核对 `Contents/Resources/app/host-runtime.mjs` 的 SHA-256。首次启动后还须在设置页确认受控升级说明。回退先保留切换后产生的数据及当前 App，再从已验证的官方 ZIP 解到内置盘新目录；程序回退不自动回退数据。

若以后启用了实验线并创建 legacy 持久侧聊，退回官方版后，这些聊天可能作为普通对话出现在侧栏。不要把这一展示变化误判为数据合并或批量删除它们。

`npm start` 和 `tools/dev-desktop/run.mjs` 会停止当前 Codex Desktop，不能当作构建检查。构建、自动化测试、签名验证通过，都不能代替真实切换与回退演练。

## 分支备份与发布

按用户授权可推送 `origin/iverson/stable` 作分支备份。Git bundle 只保存已提交 Git 对象，不能代替未提交改动或会话数据备份。凭据、真实聊天和原始运行日志不进入公开 Fork。

不创建或推送 Tag，不发 GitHub Release 或 npm 包，不向上游开 PR。仓库发布工作流可能匹配 `v*` 标签，不能用 `git push --tags` 作普通备份。
