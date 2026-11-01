# Claude Code 同轮插入

Claude Code 的运行中插入走 Agent SDK 流式输入：向当前 Query 的输入流推入 `SDKUserMessage`，`priority: "next"`，`origin: { kind: "human" }`。同轮指同一个 Host Turn；原生 Query 可以先结束当前段，再把引导作为该 Host Turn 的下一段执行。`now` 会把正在运行的 shell 命令、子 Agent 和 MCP 调用转入后台后立即送达，`later` 会等到空闲，Adapter 都不用。

Host 负责发布用于 Desktop 确认的 `userMessage` Item。工具期与原有 held 续态保留接受后投影；新增生成期引导使用延迟投影：CLI 确认实际 `started` 后才发布同一 Host Turn、同一 `clientUserMessageId` 的用户项。Adapter 通过公共生命周期事件通知 Host，不直接构造这条 Host Item，也不改写原生历史。

## 何时同轮插入

`capabilities.steer` 是实时能力，不是提前预留。共同条件是 CLI 在 `system/init` 中报告 `msg_lifecycle_v1`，有对应的用户 Turn 或原有 held 续态，且取消尚未开始。子 Agent 内部的工具不计作根级工具。具体窗口如下：

| 窗口 | 准入与送达 | 本次变化 |
| --- | --- | --- |
| 根级工具执行中 | `priority: "next"` 在工具结果之后、下一次模型请求之前并入当前 Host Turn。 | 保持原有行为，不额外要求生成期取消能力。 |
| held Turn 的续态 | 后台任务仍在运行、idle 流存活时，引导作为该 Host Turn 的下一段运行，后台任务继续。 | 保持原有后台续段与取消流程，包括 #495、#615 覆盖的行为。 |
| 用户 Turn 正在生成文本、没有根级工具执行 | 还须报告 `interrupt_cancel_queued_v1`。原生当前段结束时，只要还有已接受未开始的生成期引导，Host Turn 保持 held，后续段仍接入这一轮。 | 新增窗口；按下述两种停止边界处理输入交接。 |

未报告 `interrupt_cancel_queued_v1` 的旧 CLI 不开放新增生成期窗口，继续采用既有的停止后重发。没有进行中 Turn 时仍走普通输入启动路径；后台通知触发的自主 Turn 不因此成为可插入的用户 Turn。

`turn.steer` 在交出输入前同步复查目标和窗口，不使用 Renderer 先前的查询结果代替校验。窗口关闭或取消已开始时拒绝且不推入。Renderer 已明确选择同轮展示时，Host 不偷偷改为停止后重发。Harness Broker 经公共 `readCapabilities()` 按需读取能力；旧 Broker 未声明支持查询时保留既有退路。

## 接受、接管与投影

CLI 的 `command_lifecycle.queued` 表示输入已入原生队列，`started` 才表示这条输入开始接管原生段。Adapter 在 `queued` 返回 `{ accepted: true }`，不等整次工具调用或模型生成结束，以免占住 Desktop 约30秒的提交窗口。既有5秒缺回执接受上限保留；它不是模型已执行或取消已确认的证据。停止期间若从本地队列撤回输入，提交也要结算并发出 cancelled 生命周期；这种结算不表示输入已写到 CLI。

生成期引导通过 `steerLifecycle` 和 `{ projection: "deferred" }` 声明延迟投影。Host 在发送前登记原输入、目标 Turn 和 Desktop 的 client ID；Adapter 随后发出 `turn.steer.started` 或 `turn.steer.cancelled`。只有匹配尚未取消登记的 started 才投影用户项的 started/completed，`clientId` 对齐原 `clientUserMessageId`；取消会清理登记。取消期间迟到的 native started 触发停止保护，不投影 canonical 用户项。Host 内部 `steerId`、Desktop client ID、SDK 输入 UUID 是不同身份；CLI 回执的 `command_uuid` 应匹配 SDK 输入 UUID，不能拿生命周期事件本身的 `uuid` 代替。

已接受但未 started 的生成期引导使原 Host Turn 保持 held：前一原生段的 result 不提前结束这轮，也不把下一段送进自主续段通道。引导对应段完成后再正常结束。执行工具时的引导、空闲输入以及原有后台自主续段的归属不变。新 start 仍遵守原来的 busy/admission 规则；不合条件、写入前失败与写入后回执丢失，仍须区分，不能因后者自动重发。

原有工具期与 held 续态的待接管保活边界保留：started、未 started 就终结、缺少 queued 的既定接受超时，以及会话关闭/故障，按原有流程释放登记。生成期的5秒接受兜底不会冒充 started，也不能提前释放它对后续段的所有权；取消和真实生命周期负责结算。

## 生成期停止交接

新增生成期窗口采用输入 ticket、写入屏障和最后停止保护。`PushableInput.push()` 返回的记录区分“仍在 codexhost 队列”与“已交给 SDK 的 next()”；取走不等于已写入 CLI。

- 未被 SDK 取走：从本地输入队列撤回，结算对应的接受、保活和取消登记，不再发送该输入。
- 已被 SDK 取走：在锁定的 Agent SDK 0.3.273 上，先经过输入写入屏障，再发 `interrupt({ cancelQueued: true })`，避免控制请求先写、引导后写。SDK 的串行 `for await` 会等待前一次 write；前一次写入阻塞时，尚未交出的引导由撤回分支处理。
- 停止期间仍观察到该输入 started：立即再次 interrupt，并按已取消清理原轮。Host 不向 Desktop 发布这条引导的 canonical 用户项，也不把它转成自主续段。

停止效果分为两种边界：

| CLI 收到停止时的输入位置 | 预期行为 |
| --- | --- |
| 仍在 codexhost 或 CLI 的队列 | 撤回或取消，引导不 started；本地已撤回的输入不要求出现在 CLI 的 cancelled 回执中。 |
| CLI 已取走引导，正处于原回答结束后的 held 交接间隙 | 可能短暂 started，随后由最后保护立即中断；不得执行工具、产生回答、形成自主续段或向 Desktop 发布 canonical 执行确认。 |

第二种边界不等于引导从未开始。进程外的取消请求无法撤销 CLI 已发生的取走；验收需核对实际生命周期、工具调用、回答、后续段和投影，不能只看最终 cancelled 或没有 canonical。取消回执按 SDK 输入 UUID 对齐，点击停止、本地写出 interrupt 与 CLI 处理 interrupt 也不能混作同一时点。真实 held 样本已观察到 started 后立即中断；最终构建仍须按这两种边界分别验收。

这项交接保证只覆盖新增生成期引导。**原有工具期 stop 语义不扩大**：非 held 的根级工具期已写入、尚未接管的引导，仍可能由 CLI 留到下一原生段执行。原有 held/后台工作则继续沿用停止后台工作、等待安静及既有超时升级流程，不能把新 ticket 的保证套到所有旧窗口。

## 停止后的 Desktop 展示

Desktop 的 accepted 乐观显示不等于 canonical 接受凭据，也不证明模型执行了引导。26.1027.51404 / build 23880 的原生函数隔离回放，用实际 Host 取消帧确认了以下状态。取消路径均不制造 canonical：

| 时序 | 原生界面数据状态 | 用户操作与恢复 |
| --- | --- | --- |
| steer ACK 的 Promise 回调已结算，再处理 interrupted 终态 | guide 已离开本地队列，旧轮保留 accepted 乐观原文，但没有 serverUserMessageId。 | 没有 guide 队列条目可删除；用户可以重新输入。原 guide 不自动续发，恢复队列只处理后续 next。 |
| ACK 帧虽已在终态前到达，Promise 回调尚未结算就处理 interrupted | guide 可留在 sending + 中断暂停原因，原文被队列显示门控隐藏。 | 本地条目可删除；用户可重新输入。仍无接受凭据时，显式恢复可能转为 outcome-unknown 红色重试，原 guide 不自动重发。 |
| 已有同轮 canonical 用户项，随后普通停止 | 用户原文及接受身份可保留，停止仍暂停后续队列。 | 恢复可以依据接受凭据清理旧提交，与无 canonical 的取消输入不同。 |

前两行是相同 wire 顺序下的两种回调调度控制，不是“迟到 ACK 一定在终态帧之后”，也不是现用窗口时序的实测归因。CLI 已取走后被最后保护中断而未投影确认的输入，同样不应伪造成已确认项。Host 内部的 `turn.steer.cancelled` 只清理投影登记，不是 Desktop 专用取消卡。不为改变显示制造 canonical，不静默重新发送已取消输入，也不承诺所有显式恢复都会保持非红色。

## 版本

2026-09-24 在 Claude Code 2.1.280 上实机确认；2026-10-21 在 Claude Code 2.1.305（Agent SDK 0.3.273 与 0.3.305）上复核了相同的 `queued` → `started` → `completed` 顺序和单个 `result`，这两个版本都会报告 `msg_lifecycle_v1`。2026-10-26 在 Claude Code 2.1.303 上实机确认了 held Turn 续态的同轮插入：主回复结束、后台 Subagent 运行中写入，插入作为该 Turn 下一段得到回复，后台 Subagent 不受影响并最终正常完成。这些历史记录验证的是原有工具期或 held 窗口，没有逐个实机验证其他版本。新增生成期窗口另要求 `interrupt_cancel_queued_v1`，其输入交接与停止按本页两种边界验收。

## 历史

旧工具期样本把插入记录为同一 transcript 的 `queued_command` attachment（`commandMode: "prompt"`，`source_uuid` 为 SDK 插入消息 ID）；既有解析忽略该 attachment。生成期后续段可能有真实的新原生 user/turn 记录，不能用旧样本断言它总是同一种 attachment。

同轮拼接与 canonical 确认只处理实时 Host Turn，不改写原生 transcript。重新读取仍按原生历史解析，可能恢复为多个原生边界；Fork/Rollback 在视图尚未重读时继续受 steered Turn 保护，不伪造持久化身份。

## 验证

实机：模型 `haiku`，权限 `bypassPermissions`，一轮里调用 Bash 执行 `sleep 4; echo tool-done`，工具开始后以 `priority: "next"` 插入一句。流里只有一次 `result`（`subtype: "success"`，`terminal_reason: "completed"`）。`started` 出现在工具结果之后、下一次模型请求之前，模型回复提到了插入的句子。这份工具期样本中，没有等待下一段的生成期引导；纯文本 user 回显仍按既有规则处理。它不能用来断言新增生成期窗口也在第一个 result 时结束 Host Turn。

2026-10-21 复核：Linux aarch64，Claude Code 2.1.305，Adapter 自身的 `ClaudeSdkTransport` 驱动真实 CLI。一轮要求依次执行三次 `sleep 6`，第一个工具开始约 1.5 秒后调用 `steer()`。`steer()` 在 `queued` 时立即 resolve；本轮只执行了一次 `sleep`，`runTurn` 以 `succeeded` 结束，transcript 中模型回复的是插入要求的文本。
