# 侧聊来源与收纳索引

侧聊收纳保存对话之间的关联，聊天历史仍由原 Thread 和 Harness 保存。取消收纳不会删除 Thread、清空历史或向父对话发送消息。

## 存储

Mapping Store 根目录中的 `side-chat-collection.json` 使用 `formatVersion: 1`。每个条目包含 `threadId`、`sourceThreadId`、`projectId`，以及登记时间 `registeredAt`、收纳时间 `collectedAt` 中至少一项。存在 `collectedAt` 才表示已收纳；登记来源不会自动收纳。旧版只含 `collectedAt` 的条目仍可读取。官方 Codex Thread 和 External Thread 使用同一个索引，其中不保存标题、消息或摘要。

`registerSideChatOrigin()` 登记已创建侧聊的固定来源，`listSideChatCollection()` 读取全部索引条目，`setSideChatCollected(threadId, entry | null)` 更新收纳状态。取消收纳删除收纳时间，保留已登记来源；来源不能被重新指向另一个主对话。写入沿用 Mapping Store 的进程锁和串行写队列，通过临时文件、同步及原子替换提交。同一格式的未知文件字段与条目字段会保留。损坏或未来格式的索引拒绝侧聊库读写，文件保持原样；普通聊天列表记录诊断后继续使用原生结果，不因索引损坏阻断正常聊天。

索引独立于 Thread 记录，因此收纳操作不会修改聊天修订号、最近活动时间或原生会话身份。条目暂时不可读取时保留索引，恢复访问后重新核验。

## 读取与来源核验

`SideChatLibrary` 通过注入的 `readThread` 和 `listAttached` 读取当前 Host/账号有权访问的 Thread。调用方负责执行现有所有权检查。每次读取都核验返回的 Thread ID，读取失败或身份不符时不展示条目。

- External Thread 只信任 `modelProvider: "codexhost"` 投影中的有效 `codexhostSideChatOrigin`。这个来源与 `forkSource` 分开保存，原生检查点变化不会改变侧聊最初归属。
- 官方 Thread 的 `forkedFromId` 需要配合原生 attached 列表或 Host 在原生创建成功后登记的来源验证；普通 Fork 不能仅凭这一字段进入侧聊库。已登记来源仍需与实际读取的来源一致。
- 侧聊本人不可读取或 ID 不匹配时，不展示条目，保留索引。侧聊本人可读取、但原主对话不可读取时，返回 `sourceAvailable: false`，不展示原项目或父对话标题。界面可在主视图打开同一侧聊，保留历史；父对话导航和转主操作禁用。这与无权读取侧聊本人的情况分开处理。

展示时读取侧聊的当前名称，并优先使用来源主对话当前的 `projectId`。主对话改名不改变稳定链接；项目移动后跟随当前归属。来源仍可读但没有项目字段时，才使用已记录的来源项目作为后备信息。

## 查询和收纳

`list({ sourceThreadId?, collected? })` 返回 `{ items }`。指定来源时，从该来源的权威 attached 列表与全部已登记或已收纳条目合并候选，再逐条核验；不指定来源时只列已收纳条目。`collected` 可筛选收纳状态。

`update({ threadId, collected })` 先读取实际来源，再更新索引并返回 `{ item }`。请求不接受调用者提供的来源项目、父对话或标题。重复收纳保留首次收纳时间，取消后再次收纳记为新的收纳时间。

列表项包含 `threadId`、`sourceThreadId`、`projectId`、`title`、`collected`，来源不可用时另含 `sourceAvailable: false`。恢复侧聊、转主及不过期生命周期由各自原生 Thread 通道负责，收纳服务不通过给父对话注入历史来实现这些行为。

## 官方旧历史格式的侧聊

原生 `attachToSource` 要求来源使用 `paginated` 历史。Host 在创建官方侧聊前，通过现有原生连接读取并核验来源：`paginated` 保留原生 attached Fork；`legacy` 使用 `attachToSource: false`、`ephemeral: false` 创建原生持久 Fork，再单独登记侧聊来源。普通 Fork 请求不经过这个转换。两条路径均保留完整原生 Fork 响应，不复制消息或改写父上下文。

登记成功的侧聊在普通聚合列表中被跳过，游标仍按原生实际消费位置推进；父级侧聊查询和收纳库从登记信息找到旧格式侧聊。未知列表查询仍按原有规则透传。

创建前发现索引不可读取时不创建侧聊。原生创建成功但登记写入失败时，返回明确错误，并在错误数据中保留 `createdThreadId`、`sourceThreadId` 和 `nativeResult`；不删除已创建的原生聊天，不返回假成功，也不自动重试 Fork。

## 验证

对应测试覆盖旧格式官方侧聊的持久创建和冷启动检索、登记与收纳分离、来源拒绝访问、创建后登记失败、整页隐藏与混合页游标、并发写入及跨实例锁、格式扩展字段保留、普通 Fork 隔离、项目移动和原生检查点变化。这些是合成与协议验证，完整界面和实际 Harness 续聊还需按[个人 Fork 维护手册](../operations/personal-fork-maintenance.md)记录验收结果。
