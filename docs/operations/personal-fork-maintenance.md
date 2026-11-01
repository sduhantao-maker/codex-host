# 个人 Fork 的 stable 与 sidechat 维护

日常候选线是 `iverson/stable`，源码位于 `/Users/iverson/Code/codex-host-stable`。本文件所在的 `iverson/sidechat` 是功能审阅线，源码位于 `/Users/iverson/Code/codex-host-sidechat`。sidechat 只有在 stable 已实际稳定运行、功能线通过约定检查并且用户明确同意后，才可进入日常安装包。

`origin` 指向个人 Fork，`upstream` 指向作者仓库。功能线通过 merge 对齐 stable，不 rebase，不改写已推送历史；原 #564 cherry-pick 保持在历史中。委派入口只合并待注入文本，保持 stable 第二版的原文发送行为；远程同版本 restart-only 也沿用 stable 的修复。

## 默认关闭与热切换

三个开关默认全部关闭，分别控制持久侧聊、收纳界面和 Claude 运行中侧聊分叉。配置文件是 `~/.codexhost/sidechat-features.json`；若设置了 `CODEXHOST_DATA_DIR`，则使用该目录中的同名文件。

```json
{
  "persistentSideChats": false,
  "sideChatLibrary": false,
  "claudeActiveSideChatFork": false
}
```

将对应值设为 `false` 即关闭。Host 监听文件变化，配置热读后通知已连接的 Renderer，无需重新构建或重启应用。文件缺失时使用全部关闭的设置；损坏或不可读取时同样全关并记录诊断。已有会话和索引不会因为关闭开关而被删除。

`claudeActiveSideChatFork` 可独立用于临时侧聊，不要求先开启持久化；它不会自动改变 `ephemeral` 或创建附属关系。逐个开启验收时，每次只将一个字段改为 `true`，其余两个保持 `false`。

开发工具也可使用 `codexhost/sideChat/features/get` 读取设置与宿主能力，或用 `codexhost/sideChat/features/set` 发送三个字段的部分更新。`codexhost/sideChat/features/changed` 通知携带更新后的设置与能力。设置开启不代表宿主具备能力；仅已确认支持的本机宿主可使用持久创建改写，远程或能力未知的宿主保留原生请求。

全关行为以 stable 第二版为基准。测试需覆盖不改写原始 fork、普通 fork 保持原逻辑、列表不读取收纳索引、原有 Agent/模型绑定不受新增控件失败影响。构建身份的显示是明确要求的审阅标记，不参与版本比较。真实日常 A/B 仍须在用户选定的窗口执行，单元测试不能代替它。

## 功能和错误边界

持久侧聊继续使用原生会话及其历史。来源登记与手动收纳是元数据；不通过向父对话追加消息或摘要实现恢复。原生创建成功后的登记失败只记诊断，并有限次后台补登记，不把登记失败变成创建错误。索引不可用时，旧格式历史恢复临时侧聊参数；分页历史保留原生参数与结果。

注入上下文先进入侧聊自身的内存，再按该线程顺序持久化；仅该线程的下一轮发送等待写入，其他线程的停止、审批和发送不等待它。写入失败保留原生内存续聊并记录诊断，不把未写入的内容报告为已持久保存。持久化开关热关闭也会释放下一轮发送的等待，保留原生内存路径。

Claude 普通 fork 使用原有检查点路径。运行中侧聊的严格前缀只用于明确标记的活动分叉，工具调用和结果按 `parentUuid` 主链配对，不让废弃分支的悬空工具调用阻断普通 fork。捕获不可用时保留原来的已完成检查点策略；没有可用检查点仍是原有限制，不能伪造已完成历史或停止父回合。

收纳界面失败与原 Renderer 绑定隔离，关闭界面不会删除会话。列表读取失败记录诊断；不支持新方法的共享 peer 降级到本地结果。归档入口复用原生归档并保留来源记录，归档项退出收纳列表。侧聊本身可读但来源已不可读时显示来源不可用，保留访问与归档入口；无权读取侧聊本身时不展示它。

## 构建身份

设置的关于页和更新页显示 `0.16.1+sidechat.<sha>`，源码未提交时带 `.dirty`。载荷的 `personal-build.json` 记录完整提交、基础版本和工作区状态。macOS `Info.plist` 包含 `CodexHostPersonalBuild`、`CodexHostBuildIdentity` 和 `CodexHostSourceCommit`。

`package.json`、`CFBundleVersion`、`CFBundleShortVersionString`、更新协议与语义版本比较继续使用基础版本。最终审阅包从已提交且干净的工作树构建，并核对 UI、Info.plist、身份文件及验收记录中的提交一致。缺失或不一致的身份不能用一个猜测的 SHA 代替。

## 受控升级与远程重启

更新页保留上游版本与发布说明查询，显示个人构建的受控升级说明，不提供改变已安装版本的官方包安装入口。新的个人安装包经合并、检查和构建后交由用户选择切换时间。

远程 npm Host 请求版本与已安装版本相同且需要重启时，保留 stable 第二版的 restart-only 行为；同版本且无需重启时仍为无操作结果。改变版本的请求返回受控升级说明。`updateSupported` 仍表示原有运行时能力，Renderer 同时依据 `installationDisabledReason` 与 `restartRequired` 保留同版本重启入口。

## 检查与同步上游

每完成一个返工项先提交并运行对应回归，最终候选再执行完整检查。每次同步上游都遵循同样流程。

1. 先检查 `git rev-parse --show-toplevel` 和工作区状态；若根目录为 `/Users/iverson` 就停止 Git 操作。保留另一工作树的未提交改动。
2. 在集成分支 merge 选定的上游稳定 Tag 或 stable 提交，解决冲突时保留双方有效行为，不以强制同步覆盖个人改动。
3. 使用 Node 24 和固定 Rust 工具链，为测试子进程创建临时 HOME，清除真实凭据及 live-test opt-in，不修改全局环境。
4. 完整运行 `npm run check` 和完整 `npm run test:e2e`，与 stable 第二版同环境、同并行度对照。依赖链接各自指向各自工作树。若前阶段失败导致短路，单独补跑后续阶段并保留原命令失败状态。
5. 比较具体失败名称和证据，不只比较数量；不改断言、放宽超时或用复跑成功覆盖首次失败。已确认的既有时序不稳项保留记录，同一项稳定复现时继续排查。
6. 用同一份日常 A/B 清单验证全关，再逐个开启；每行记录实际操作、通过标准和差异。测试目录和任务使用合成内容，真实模型、停止/审批延迟及远程重启只在用户批准的窗口执行。

Codex Desktop 更新可能改变私有界面和协议。静态契约检查只能证明绑定条件存在，不能替代实际发送、恢复和重启验证。若只开放 Renderer CDP，主进程 Inspector 未执行的部分应明确记录。

## 备份、切换与回退

sidechat 安装包仅供审阅，保存在外盘 `releases/sidechat/`，验证记录放 `verification/sidechat-rework/`。日常 stable 包仍放 `releases/stable/`。ExFAT 上保留 DMG、ZIP 或 tar，不用散装 App 目录代替权限和符号链接归档。

切换使用对应候选交付目录的操作单，先正常退出并确认相关服务及数据占用者停止，再归档 `.codexhost`、`.codex`，记录 SHA-256、文件类型数量并试解包核验。两目录不涵盖 `.claude` 等所有 Harness 自有存储；不要把它称为所有历史的完整备份。

本机使用 DMG。先保存当前 App，核对 DMG 与 `host-runtime.mjs` 的 SHA，再只读挂载、`ditto` 替换原位并验签。回退先保留新数据和当前 App，从已验证的官方 ZIP 解到内置盘新空目录；程序回退不自动恢复旧数据。恢复数据需要用户另行决定，不合并 SQLite 数据库，不删除 WAL/SHM 文件。

关闭功能或回退到 stable/官方版后，legacy 持久侧聊可能作为普通对话出现在侧栏。这是展示回退，不表示合并进父对话；不要因此批量删除聊天。

本阶段不运行 `npm start`、`tools/dev-desktop/run.mjs` 或 `install-local.sh`，不安装候选、启停真实应用或改动 `/Applications`。数据备份、实际切换与回退演练留待用户窗口。

## 分支备份与发布

按用户授权可推送 `origin/iverson/sidechat` 作代码备份。每份验收记录同时写明提交、stable 对照提交、Desktop 版本、构建号和检查环境。Git bundle 不能代替未提交改动或真实数据备份。

不打 Tag、不发 GitHub Release 或 npm 包、不向上游开 PR。凭据、真实聊天和原始运行日志不进入公开 Fork，也不用 `git push --tags` 当备份。
