# Claude Code 同轮插入

Claude Code 的运行中插入走 Agent SDK 流式输入：向当前 Query 的输入流推入 `SDKUserMessage`，`priority: "next"`，`origin: { kind: "human" }`。同轮指同一个 Host Turn；原生 Query 可以先结束当前段，再把引导作为该 Host Turn 的下一段执行。`now` 会把正在运行的 shell 命令、子 Agent 和 MCP 调用转入后台后立即送达，`later` 会等到空闲，Adapter 都不用。

Host 负责发布用于 Desktop 确认的 `userMessage` Item。工具期与原有 held 续态保留接受后投影；新增生成期引导使用延迟投影：CLI 确认实际 `started` 后才发布同一 Host Turn、同一 `clientUserMessageId` 的用户项。Adapter 通过公共生命周期事件通知 Host，不直接构造这条 Host Item，也不改写原生历史。

## 何时同轮插入

`capabilities.steer` 是实时能力，不是提前预留。共同条件是 CLI 在 `system/init` 中报告 `msg_lifecycle_v1`，有对应的用户 Turn 或原有 held 续态，且取消尚未开始。子 Agent 内部的工具不计作根级工具。具体窗口如下：

| 窗口 | 准入与送达 | 本次变化 |
| --- | --- | --- |
| 根级工具执行中 | `priority: "next"` 在工具结果之后、下一次模型请求之前并入当前 Host Turn。 | 送达语义保留；停止采用上游 #690 的待接管保活与接管后立即中断。 |
| held Turn 的续态 | 后台任务仍在运行、idle 流存活时，引导作为该 Host Turn 的下一段运行，后台任务继续。 | 保留 #495、#615 的后台归属，待接管输入的停止统一采用 #690 收口。 |
| 用户 Turn 正在生成文本、没有根级工具执行 | CLI 同时报告 `msg_lifecycle_v1` 与 `interrupt_cancel_queued_v1`；原生当前段结束时，只要还有已接受未开始的生成期引导，Host Turn 保持 held，后续段仍接入这一轮。 | 个人版提供生成期准入、同轮接续及开始前的候选1取消层；原生接管后的中断只走官方 #690。 |

生成期需要两项实际使用的能力：`msg_lifecycle_v1` 提供 queued、started 和终态，用于确认接管与持有原轮；`interrupt_cancel_queued_v1` 支持开始前的队列取消。缺少任一项时不开放个人新增的生成期窗口，保持官方 v0.17.0 原来的路线。工具期和原有 held 续态仍按官方自身条件准入；没有进行中 Turn 时仍是普通 start。后台通知触发的自主 Turn 不因此成为可插入的用户 Turn。

`turn.steer` 在交出输入前同步复查目标和窗口，不使用 Renderer 先前的查询结果代替校验。窗口关闭或取消已开始时拒绝且不推入。Renderer 已明确选择同轮展示时，Host 不偷偷改为停止后重发。Harness Broker 经公共 `readCapabilities()` 按需读取能力；旧 Broker 未声明支持查询时保留既有退路。

## 接受、接管与投影

CLI 的 `command_lifecycle.queued` 表示输入已入原生队列，`started` 才表示这条输入开始接管原生段。Adapter 在 `queued` 返回 `{ accepted: true }`，不等整次工具调用或模型生成结束，以免占住 Desktop 约30秒的提交窗口。既有5秒缺回执接受上限保留；它不是模型已执行或取消已确认的证据。取消与受理可以并发，提交回执仍须结算；已经交出的输入不能返回表示未收下的结果而触发自动重发，取消仍由官方流程保留原轮直到结算。

生成期引导通过 `steerLifecycle` 和 `{ projection: "deferred" }` 声明延迟投影。Host 在发送前登记原输入、目标 Turn 和 Desktop 的 client ID；Adapter 随后发出 `turn.steer.started` 或 `turn.steer.cancelled`。只有匹配尚未取消登记的 started 才投影用户项的 started/completed，`clientId` 对齐原 `clientUserMessageId`；取消会清理登记。取消期间迟到的 native started 触发官方接管中断，不投影 canonical 用户项。Host 内部 `steerId`、Desktop client ID、SDK 输入 UUID 是不同身份；CLI 回执的 `command_uuid` 应匹配 SDK 输入 UUID，不能拿生命周期事件本身的 `uuid` 代替。

已接受但未 started 的生成期引导使原 Host Turn 保持 held：前一原生段的 result 不提前结束这轮，也不把下一段送进自主续段通道。引导对应段完成后再正常结束。正常工具期引导、空闲输入及无待接管引导的后台自主续段保持原有归属；工具期停止的收口按下述 #690 规则处理。新 start 仍遵守原来的 busy/admission 规则；不合条件、写入前失败与写入后回执丢失，仍须区分，不能因后者自动重发。

工具期与 held 续态的待接管保活边界保留：started、未 started 就终结、缺少 queued 的既定接受超时，以及会话关闭/故障，按原有流程释放登记。生成期的5秒接受兜底不会冒充 started，也不能提前释放它对后续段的所有权；取消和真实生命周期负责结算。

## 停止：生成期开始前取消与官方接管中断

生成期在开始前采用候选1：`PushableInput` 记录一条输入是否已被 SDK 的 next() 取走。仍在 codexhost 队列时直接撤回，并结算接受、保活及取消生命周期；已交给 SDK 时先经过锁定 SDK 0.3.273 的写入屏障，再请求 `interrupt({ cancelQueued: true })`，避免取消控制先写而输入随后才写入。前次 write 阻塞时，SDK 尚未取走的输入由撤回分支处理。撤回不能返回会使 Host 自动另开一轮的 NotTaken。

原生接管后的中断只有上游 c72b32db / f1d8cd90 这一个入口，生成期和工具期共用它，不恢复个人的另一套 lastguard 或 force 中断：

- 只要还有已写出、尚未被原生接管的引导，无论 Host Turn 是否 held，都走官方停止后台工作并等待安静的取消流程。当前 Root 的 result 不提前结束原 Host Turn。
- 引导原生段 started 时立即中断。它不得产生回答、执行新工具或另起自主轮；取消已经开始的生成期引导也不发布 canonical 执行确认。
- Transport 按 f1d8cd90 在请求中断前建立相应 idle accumulator 并记录取消。因此 Root result 后首个 idle 帧就是 started 时，后续 aborted_tools / aborted_streaming 仍按取消处理；其它不能证明中断的失败保持失败。
- 取消期间拒绝新引导，turn.start 仍返回 sessionBusy。待接管输入、后台任务及 Root 段全部结算并经过 continuation 安静期后，原 Host Turn 只完成一次 cancelled；迟迟没有结果则沿用官方超时升级，关闭原生进程。

生成期的两种边界分别验收：输入仍在 codexhost 或 CLI 队列时（包括立即停止和尚未接管的 queued 停止），应撤回或取消，不得开始；原回答结束的 held 交接间隙，CLI 可能已取走输入，此时可短暂 started，但官方入口必须立即中断，无工具、回答、自主轮或取消后的执行确认。工具期停止始终采用官方 #690，不叠加生成期开始前策略。无待接管输入及后台/续态工作的普通停止，和 #495、#615 原有生命周期，仍走上游路径。

### 停止后的两条新消息

每个停止用例结束后，在同一临时会话依次发送两条带不同标记的新消息。对每条回答分别记录是否命中自己的标记、旧 guide 标记及另一条新消息标记，另记长度；正文不落盘。原轮 cancelled、新请求 accepted 或 Native CMD ID 正确都不能代替内容对应检查。

- 生成期立即停止：guide不得开始，两条回答都必须只对应各自的新消息；任一条不对应即停止验收。
- held 间隙及工具期停止：只第一条不对应、第二条恢复时，按已知限制写入报告和 A/B，不算阻碍；第二条仍不对应则停止验收。

这项分类不追溯改判第11b号已保留的两次失败，也不预告本候选已经通过。仅首条内容不对应的原因仍须按证据界定，不能直接归为 Host 路由因果。最终 cancelled、无 canonical 或成功中断回执都不能单独证明上述对应关系。

## 停止后的 Desktop 展示

Desktop 的 accepted 乐观显示不等于 canonical 接受凭据，也不证明模型执行了引导。26.1027.51404 / build 23880 的原生函数隔离回放，用实际 Host 取消帧确认了以下状态。取消路径均不制造 canonical：

| 时序 | 原生界面数据状态 | 用户操作与恢复 |
| --- | --- | --- |
| steer ACK 的 Promise 回调已结算，再处理 interrupted 终态 | guide 已离开本地队列，旧轮保留 accepted 乐观原文，但没有 serverUserMessageId。 | 没有 guide 队列条目可删除；用户可以重新输入。原 guide 不自动续发，恢复队列只处理后续 next。 |
| ACK 帧虽已在终态前到达，Promise 回调尚未结算就处理 interrupted | guide 可留在 sending + 中断暂停原因，原文被队列显示门控隐藏。 | 本地条目可删除；用户可重新输入。仍无接受凭据时，显式恢复可能转为 outcome-unknown 红色重试，原 guide 不自动重发。 |
| 已有同轮 canonical 用户项，随后普通停止 | 用户原文及接受身份可保留，停止仍暂停后续队列。 | 恢复可以依据接受凭据清理旧提交，与无 canonical 的取消输入不同。 |

前两行是相同 wire 顺序下的两种回调调度控制，不是“迟到 ACK 一定在终态帧之后”，也不是现用窗口时序的实测归因。由官方接管取消流程中断、未投影确认的输入，同样不应伪造成已确认项。Host 内部的 `turn.steer.cancelled` 只清理投影登记，不是 Desktop 专用取消卡。不为改变显示制造 canonical，不静默重新发送已取消输入，也不承诺所有显式恢复都会保持非红色。

## 版本

2026-09-24 在 Claude Code 2.1.280 上实机确认；2026-10-21 在 Claude Code 2.1.305（Agent SDK 0.3.273 与 0.3.305）上复核了相同的 `queued` → `started` → `completed` 顺序和单个 `result`，这两个版本都会报告 `msg_lifecycle_v1`。2026-10-26 在 Claude Code 2.1.303 上实机确认了 held Turn 续态的同轮插入：主回复结束、后台 Subagent 运行中写入，插入作为该 Turn 下一段得到回复，后台 Subagent 不受影响并最终正常完成。这些历史记录验证的是原有工具期或 held 窗口，没有逐个实机验证其他版本。个人生成期窗口另要求 `interrupt_cancel_queued_v1`；原生接管中断沿用官方，验收按上述两种停止边界与两条新消息规则。

## 历史

旧工具期样本把插入记录为同一 transcript 的 `queued_command` attachment（`commandMode: "prompt"`，`source_uuid` 为 SDK 插入消息 ID）；既有解析忽略该 attachment。生成期后续段可能有真实的新原生 user/turn 记录，不能用旧样本断言它总是同一种 attachment。

同轮拼接与 canonical 确认只处理实时 Host Turn，不改写原生 transcript。重新读取仍按原生历史解析，可能恢复为多个原生边界；Fork/Rollback 在视图尚未重读时继续受 steered Turn 保护，不伪造持久化身份。

## 验证

自动化回归：`packages/adapters/claude-code/test/claude-code-adapter.test.ts` 的 `preserves cancellation when a native steer starts before its idle accumulator exists` 使用真实 `ClaudeSdkTransport` 与 `FakeQuery`，按 Root 中断结果 → 插入 `started`（首个 idle 帧）→ 插入中断结果的顺序送入 SDK 消息，断言最终为 cancelled、等待期间拒绝新 Turn、结束后可启动新 Turn，且没有自主 Turn。这是合成 SDK 流测试，不代表真实 CLI 或 Desktop 实机验收。合并后还须重跑个人生成期关联与官方接管取消回归，验证只中断对应原生段、没有挂起或重复终态。

实机：模型 `haiku`，权限 `bypassPermissions`，一轮里调用 Bash 执行 `sleep 4; echo tool-done`，工具开始后以 `priority: "next"` 插入一句。流里只有一次 `result`（`subtype: "success"`，`terminal_reason: "completed"`）。`started` 出现在工具结果之后、下一次模型请求之前，模型回复提到了插入的句子。这份工具期样本中，没有等待下一段的生成期引导；纯文本 user 回显仍按既有规则处理。它不能用来断言新增生成期窗口也在第一个 result 时结束 Host Turn。

2026-10-21 复核：Linux aarch64，Claude Code 2.1.305，Adapter 自身的 `ClaudeSdkTransport` 驱动真实 CLI。一轮要求依次执行三次 `sleep 6`，第一个工具开始约 1.5 秒后调用 `steer()`。`steer()` 在 `queued` 时立即 resolve；本轮只执行了一次 `sleep`，`runTurn` 以 `succeeded` 结束，transcript 中模型回复的是插入要求的文本。
