# 个人版需求与升级

个人版以官方发布 tag 为基座，当前保留 P1、P2、P4、P5、P6。每次升级先核对官方是否已满足对应需求，再移除重复补丁。侧聊扩展默认关闭，开关不影响官方已有的图片引导。

| 编号 | 需求 | 官方 0.17.3 状态 | 个人补丁与快速核对方法 |
| --- | --- | --- | --- |
| R1 | Claude、DeepSeek 等外部对话可以打开侧聊，转为主对话时上下文保留 | 未满足 | P1。检查官方 `external-thread-inject.ts`、`external-thread-runtime.ts`、`app-server-host.ts` 的 `thread/inject_items` 路由；跑 `app-server-host.projection-2.test.ts`、`external-thread-recovery.test.ts` 和侧聊生命周期测试。 |
| R2 | 委派任务原文不被改写 | 官方本身满足 | P1 保留官方 `#startDelegatedExternalTurn` 的原文行为，仅合并待注入上下文；检查该方法不调用 `rewriteDelegationMentionText`，跑 `app-server-host.projection-2.test.ts`。 |
| R3 | 官方更新不覆盖个人版，更新页显示个人版本 | 个人策略 | P2。检查 `update-coordinator.ts`、`runtime-maintenance.ts`、`settings/pages.ts`、`personal-build.mjs`；跑 `*controlled-updates.test.ts`、`settings/pages.test.ts`、`tests/release/personal-build.test.mjs`。同版本远程重启仍须可用。 |
| R4 | Claude 输出文字时的引导原话可见、排队不卡、受理后状态正确 | 已满足（`63114237`、`cc70713d`） | 采用官方 RPC Coordinator。生成期引导先停止当前回答，再以原话作为用户消息开启新一轮。核对按 Host Turn ID 返回受理结果和只结算对应队列项，运行 `renderer-rpc-steering*.test.ts`、`app-server-host.native-steering.test.ts`、Claude Adapter 测试及 `renderer-rpc-steering-readiness.spec.ts`。 |
| R5 | 停止工具期引导后可继续正常提交 | 已满足（#690） | 采用官方工具期中断逻辑。核对 `c72b32db`、`f1d8cd90` 的接管即中断和安静期，运行 Claude Adapter 停止测试。生成期由 R4 的 replacement 路径处理。 |
| R6 | 带图片的引导 | 已满足（#654） | 采用官方媒体输入和 RPC prepare。核对 `renderer-rpc-steering.ts`、Adapter 媒体输入路径及相关测试。 |
| R7 | 侧聊不过期，独立上下文。右侧侧聊标签栏的图钉控制收纳。已收纳侧聊在克隆原生节点的侧栏分组中显示，并关联项目和父对话 | 未满足 | P4。检查 `side-chat-features.ts`、`side-chat-library.ts`、`side-chat-collection.ts`、renderer 侧聊模块；跑 `*side*test.ts`、`renderer-sidechat*`、`tools/sidechat-installed-contract.test.mjs`。全关时不得改写 fork、读取收纳文件或改变 Claude 普通 fork。 |
| R8 | DeepSeek 会话出错不能让整个 codexhost 退出 | 未满足 | P6。检查官方 `deepseek-harness/src/modern/session.ts` 的 `close()`：未被等待的拒绝须立即有处理器，同时原拒绝仍返回给调用者。跑 `deepseek-harness/test/modern/session.test.ts` 的 fault 后关闭三种路径及插件现有测试；不得吞掉关闭未确认或改变 Host 全局异常策略。 |
| R9 | Claude 运行中也能打开侧边聊天 | 未满足 | P4 的 `claudeActiveSideChatFork` 开关。运行中缺少已完成的 Fork Checkpoint 时，官方 `thread/fork` 可返回 `-32080`。个人版可使用已持久化的原生用户边界。运行 `side-chat-active-fork.test.ts`、`claude-active-fork.test.ts` 和 `broker-fork.test.ts`。 |
| R10 | 新 Claude 侧聊首轮在 SDK 就绪前发布正式开始通知 | 未满足。官方也在 SDK 就绪后发布开始通知 | P4 提前原生 Claude 侧聊首轮的受理和开始帧。具备 `clientUserMessageId` 时补发可去重的用户原文，排除注入的父对话内容。原生回放可显示进行中状态，实机空白的成因待诊断。P1 记录所有外部回合的阶段时间。 |

0.17.3 核对：官方只改了宿主路由（`ca4bfafb`，Composer 发现复用，修复卡顿），R1–R10 均未被覆盖，五个补丁全部保留。P4 只在 `renderer-host-rpc-routing.test.ts` 的测试夹具上冲突，两边新增的字段都保留。

在个人工作区运行升级工具。

```sh
bash tools/personal/upgrade-to-official.sh v0.18.0
```

在干净的 `iverson/personal` 或后续 `iverson/personal-v*` 分支执行，使用 Node 24。脚本只 fetch 官方 tag，在相邻新 worktree 的 `iverson/personal-<tag>` 上重放剩余的个人补丁，不改原分支。当前为五个补丁。官方实现取代个人补丁后，剩余补丁继续按原顺序重放。它先打印与 P1–P6 重叠的官方文件和提交标题；冲突时保留新 worktree 并停止，供按本表核对和取舍。没有冲突也仍要审阅官方等价实现，脚本不能替代需求判断。

脚本的构建、格式、类型、Lint 和快速测试使用各自临时 HOME；沿用 Cargo/npm 缓存和工作区已有的 `.codexhost` 工具链，不读取真实聊天配置。升级工具会将 `CODEXHOST_SIDECHAT_ASAR` 传给 `tools/personal/quick-tests.sh`，只读审计已安装的 Desktop。手动运行快测时可用该变量指定 `app.asar`。打包后打印 DMG、包内 runtime 的 SHA-256，写同名 `.dmg.sha256`。产物留在新 worktree 的 `build/release`，不会安装、发布、推送或重启应用。

回退前应先备份应用退出时的数据。侧聊索引属于个人版扩展数据；官方忽略索引，附属侧聊可能作为普通线程显示。官方与个人版切换的数据可读性还要以具体版本和回退检查为准，不把“构建成功”当作无损回退保证。
