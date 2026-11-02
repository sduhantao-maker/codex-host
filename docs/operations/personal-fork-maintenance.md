# 个人 Fork 维护

当前个人版采用官方发布 tag 加 P1–P5 补丁栈，分支为 `iverson/personal`，工作区为 `/Users/iverson/Code/codex-host-personal`。需求、官方等价实现的取舍和升级命令以 [个人版需求与升级](../personal/requirements.md) 为准。旧 stable 与 sidechat 工作区保留，不再作为当前基座升级流程。

每次升级先核对官方已满足的需求，删除对应的重复补丁；生成期引导和侧聊等未满足部分继续保留。构建与测试使用 Node 24 和临时 HOME。新版本在独立工作区重放补丁，有冲突或检查失败就停下，不改原分支。

个人版安装包放在 `/Volumes/Iverson/codexhost-sidechat/releases/personal/`。更新页保留官方版本查询，但禁止安装官方更新覆盖个人版；远程同版本重启仍可用。设置/关于页与 Info.plist 显示个人提交标识，版本比较仍用官方 semver。

程序切换由用户决定，切换前正常退出并备份应用和会话数据，保留原安装包。官方 0.17.0 可以读取个人版同格式的外部对话，忽略但保留收纳索引及开关文件；持久侧聊可能显示为普通对话。尚未消费的待注入上下文会保留，但官方不会应用；应先完成侧聊首条消息再回退。

不要把构建成功当作实机验收。不要用会停止 Desktop 的 `npm start` 或 `tools/dev-desktop/run.mjs` 作检查。不创建 tag、不发 Release、不向上游发言；只按授权推送个人分支。
