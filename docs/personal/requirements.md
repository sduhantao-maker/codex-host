# 个人版需求与升级

个人版以官方发布 tag 为基座，P1–P5 各一个提交。每次升级先检查官方是否已满足对应需求；满足后采用官方实现，删除重复补丁。侧聊扩展默认关闭，开关不影响官方已有的图片引导。

| 编号 | 需求 | 官方 0.17.0 状态 | 个人补丁与快速核对方法 |
| --- | --- | --- | --- |
| R1 | Claude、DeepSeek 等外部对话可以打开侧聊，转为主对话时上下文保留 | 未满足 | P1。检查官方 `external-thread-inject.ts`、`external-thread-runtime.ts`、`app-server-host.ts` 的 `thread/inject_items` 路由；跑 `app-server-host.projection-2.test.ts`、`external-thread-recovery.test.ts` 和侧聊生命周期测试。 |
| R2 | 委派任务原文不被改写 | 官方本身满足 | P1 保留官方 `#startDelegatedExternalTurn` 的原文行为，仅合并待注入上下文；检查该方法不调用 `rewriteDelegationMentionText`，跑 `app-server-host.projection-2.test.ts`。 |
| R3 | 官方更新不覆盖个人版，更新页显示个人版本 | 个人策略 | P2。检查 `update-coordinator.ts`、`runtime-maintenance.ts`、`settings/pages.ts`、`personal-build.mjs`；跑 `*controlled-updates.test.ts`、`settings/pages.test.ts`、`tests/release/personal-build.test.mjs`。同版本远程重启仍须可用。 |
| R4 | Claude 输出文字时的引导同轮执行、原话可见、排队不卡、不延迟变红 | 未满足 | P3。检查官方 Adapter `canSteerActiveTurn()`、SDK `#consume`、Host `insertNativeSteer` 和生命周期事件。跑 `sdk-transport.test.ts`、`claude-code-adapter.test.ts`、`broker-steer-*.test.ts`、Host `*steer*.test.ts` 和投影测试。接纳与 canonical 必须关联原 turn ID、`clientUserMessageId`。 |
| R5 | 停止后引导不再继续，下一条消息不错位 | 工具期采用官方 #690；生成期未满足 | 工具期保留 `c72b32db`、`f1d8cd90` 的接管即中断及安静期。P3 仅为生成期增加候选 1：撤回、写入屏障、`cancelQueued`，最终保护仍用官方入口。检查 `sdk-transport.ts`、Adapter 停止路径；跑 R4 测试并验证停止后连续两条不同标记的新消息。 |
| R6 | 带图片的引导 | 已满足 #654 | 直接使用官方。检查 `renderer-external-steering.ts`、Adapter 媒体输入路径及官方相关测试；不恢复旧版纯文本替代实现。 |
| R7 | 侧聊不过期，独立上下文，收纳关联项目与父对话 | 未满足 | P4。检查 `side-chat-features.ts`、`side-chat-library.ts`、`side-chat-collection.ts`、renderer 侧聊模块；跑 `*side*test.ts`、`renderer-sidechat*`、`tools/sidechat-installed-contract.test.mjs`。全关时不得改写 fork、读取收纳文件或改变 Claude 普通 fork。 |

生成期原生引导要求 CLI 同时宣告 `msg_lifecycle_v1` 和 `interrupt_cancel_queued_v1`；缺少能力时保持官方路线。停止发生在 CLI 已接管的间隙，引导可能短暂开始，但官方保护应立即中断，不产生工具、回答、canonical 或自主轮。工具期停止已观测到第一条新回复混有旧引导标记、第二条恢复的官方限制，仍须在 A/B 中检查，不能声称完全消除。

升级命令：

```sh
bash tools/personal/upgrade-to-official.sh v0.18.0
```

在干净的 `iverson/personal` 或后续 `iverson/personal-v*` 分支执行，使用 Node 24。脚本只 fetch 官方 tag，在相邻新 worktree 的 `iverson/personal-<tag>` 上重放剩余的个人补丁，不改原分支。初始为五个提交；官方等价实现取代补丁后允许减少，P5 保持最后一个。它先打印与 P1–P4 重叠的官方文件和提交标题；冲突时保留新 worktree 并停止，供按本表核对和取舍。没有冲突也仍要审阅官方等价实现，脚本不能替代需求判断。

脚本的构建、格式、类型、Lint 和快速测试使用各自临时 HOME；沿用 Cargo/npm 缓存和工作区已有的 `.codexhost` 工具链，不读取真实聊天配置。快速测试入口为 `bash tools/personal/quick-tests.sh`，会只读审计 `/Applications/ChatGPT.app/Contents/Resources/app.asar`；其他安装位置可指定 `CODEXHOST_SIDECHAT_ASAR`，缺失时失败而非跳过。打包后打印 DMG、包内 runtime 的 SHA-256，写同名 `.dmg.sha256`。产物留在新 worktree 的 `build/release`，不会安装、发布、推送或重启应用。

回退前应先备份应用退出时的数据。侧聊索引属于个人版扩展数据；官方忽略索引，附属侧聊可能作为普通线程显示。官方与个人版切换的数据可读性还要以具体版本和回退检查为准，不把“构建成功”当作无损回退保证。
