import type { RendererHostRouting } from "@codexhost/desktop-control/renderer-bindings";
import { createSideChatLibrary, type SideChatEntry } from "./renderer-sidechat-library.js";
import {
  createNativeSideChatActions,
  findNativeSideChatScope,
} from "./renderer-sidechat-native.js";

const STYLE = `
[data-codexhost-sidechats-trigger]{display:block;width:calc(100% - 16px);margin:8px;padding:8px 12px;text-align:start;border:1px solid var(--color-border, #8884);border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
[data-codexhost-sidechats]{width:min(680px,calc(100vw - 48px));max-height:80vh;padding:20px;border:1px solid var(--color-border,#8885);border-radius:16px;background:var(--color-token-main-surface-primary,var(--color-background,#fff));color:var(--color-text,#222);box-shadow:0 20px 80px #0003}
[data-codexhost-sidechats]::backdrop{background:#0005}
[data-codexhost-sidechats] header,[data-codexhost-sidechats] nav,[data-codexhost-sidechats] .sidechat-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
[data-codexhost-sidechats] header{justify-content:space-between;margin-bottom:12px}
[data-codexhost-sidechats] h2{font-size:18px;margin:0}
[data-codexhost-sidechats] button{font:inherit;color:inherit;background:transparent;border:1px solid var(--color-border,#8885);border-radius:6px;padding:5px 9px;cursor:pointer}
[data-codexhost-sidechats] button:disabled{opacity:.5;cursor:default}
[data-codexhost-sidechats] button:focus-visible{outline:2px solid var(--color-text-info,#3984ff);outline-offset:2px}
[data-codexhost-sidechats] button[aria-pressed=true]{background:var(--color-background-secondary,#8882)}
[data-codexhost-sidechats] ul{list-style:none;margin:12px 0 0;padding:0}
[data-codexhost-sidechats] li{border-top:1px solid var(--color-border,#8884);padding:14px 0}
[data-codexhost-sidechats] .sidechat-title{display:block;font-weight:600;margin-bottom:8px;overflow-wrap:anywhere}
[data-codexhost-sidechats] .sidechat-source{font-size:12px;opacity:.8;margin:8px 0;overflow-wrap:anywhere}
[data-codexhost-sidechats] [role=status]{font-size:13px;margin-top:12px;white-space:pre-wrap}
`;

/** A folder inside the existing window. No transcript or account data is stored in the DOM. */
export function installRendererSideChatControls(
  document: Document,
  routing: () => RendererHostRouting | undefined,
) {
  const ownerWindow = document.defaultView;
  if (!ownerWindow || !document.head || !document.body) return { dispose() {} };
  const native = createNativeSideChatActions(ownerWindow);
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.dataset.codexhostSidechatsTrigger = "";
  trigger.textContent = "侧聊收纳";
  trigger.setAttribute("aria-haspopup", "dialog");
  const dialog = document.createElement("dialog");
  dialog.dataset.codexhostSidechats = "";
  dialog.setAttribute("aria-label", "侧聊收纳");
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  document.body.append(dialog);
  let disposed = false;
  let view: "collected" | "parent" = "collected";
  let sourceId: string | undefined;
  let operation: AbortController | null = null;
  let generation = 0;
  const hostId = "local";
  let focusBeforeOpen: Element | null = null;
  const button = (label: string, action: () => void, unavailable = false) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.disabled = unavailable;
    if (unavailable) node.dataset.sidechatUnavailable = "true";
    node.addEventListener("click", action);
    return node;
  };
  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = "侧聊收纳";
  header.append(
    title,
    button("关闭", () => dialog.close()),
  );
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "侧聊筛选");
  const collected = button("已收纳", () => {
    view = "collected";
    void refresh();
  });
  const parent = button("当前主对话的侧聊", () => {
    view = "parent";
    void refresh();
  });
  nav.append(
    collected,
    parent,
    button("刷新", () => {
      void refresh();
    }),
  );
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const list = document.createElement("ul");
  dialog.append(header, nav, status, list);
  const library = () => {
    const route = routing()?.forHost(hostId);
    if (!route) throw new Error("本机聊天服务尚未连接");
    return createSideChatLibrary(async (method, params) => {
      if (disposed || routing()?.forHost(hostId) !== route)
        throw new Error("聊天连接已改变，请刷新侧聊列表");
      const response = await route.manager.sendRequest(method, params);
      if (disposed || routing()?.forHost(hostId) !== route)
        throw new Error("聊天连接已改变，请刷新侧聊列表");
      return response;
    });
  };
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (operation) return;
    const current = new AbortController();
    operation = current;
    for (const item of dialog.querySelectorAll<HTMLButtonElement>("li button"))
      item.disabled = true;
    status.textContent = "正在处理…";
    try {
      await action(current.signal);
      if (!disposed && dialog.open) await refresh();
    } catch (error) {
      if (!current.signal.aborted && !disposed)
        status.textContent = error instanceof Error ? error.message : "操作未完成，记录已保留";
    } finally {
      if (operation === current) operation = null;
      for (const item of dialog.querySelectorAll<HTMLButtonElement>("li button"))
        item.disabled = item.dataset.sidechatUnavailable === "true";
    }
  };
  const render = (entry: SideChatEntry, sourceTitle: string | null, projectName: string | null) => {
    const sourceAvailable = entry.sourceAvailable !== false;
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.className = "sidechat-title";
    label.textContent = entry.title || "侧边聊天";
    const source = document.createElement("p");
    source.className = "sidechat-source";
    source.textContent = sourceAvailable
      ? `项目：${projectName ?? entry.projectId ?? "未归属项目"} · 原主对话：${sourceTitle ?? entry.sourceThreadId}`
      : "来源不可用。将在主视图打开原侧聊，保留同一聊天和完整历史。";
    const actions = document.createElement("div");
    actions.className = "sidechat-actions";
    actions.append(
      button(sourceAvailable ? "继续侧聊" : "打开原侧聊", () => {
        void run(async (signal) => {
          await native.reopen(entry, hostId, signal);
          dialog.close();
        });
      }),
      button(entry.collected ? "取消收纳" : "收纳", () => {
        void run(async () => {
          await library().collect(entry.threadId, !entry.collected);
        });
      }),
      button(
        "打开原主对话",
        () => {
          void run(async (signal) => {
            await native.navigate(entry.sourceThreadId, hostId, signal);
            dialog.close();
          });
        },
        !sourceAvailable,
      ),
      button(
        "转为独立主对话",
        () => {
          void run(async (signal) => {
            const workspaceRoot = await library().workspaceRoot(entry.threadId);
            await native.promote(entry, hostId, signal, workspaceRoot);
            dialog.close();
          });
        },
        !sourceAvailable,
      ),
    );
    if (entry.projectId && sourceAvailable)
      actions.append(
        button("定位项目", () => {
          void run(async () => {
            native.openProject(entry.projectId as string);
            dialog.close();
          });
        }),
      );
    item.append(label, source, actions);
    return item;
  };
  async function refresh() {
    const current = ++generation;
    collected.setAttribute("aria-pressed", String(view === "collected"));
    parent.setAttribute("aria-pressed", String(view === "parent"));
    parent.disabled = !sourceId;
    list.replaceChildren();
    status.textContent = "正在读取侧聊…";
    try {
      const client = library();
      const entries = await client.list(view === "parent" ? sourceId : undefined);
      const sourceTitles = new Map<string, string | null>();
      const projects = new Map<string, string | null>();
      for (const entry of entries) {
        if (disposed || current !== generation || !dialog.open) return;
        if (entry.sourceAvailable === false) continue;
        if (!sourceTitles.has(entry.sourceThreadId))
          sourceTitles.set(
            entry.sourceThreadId,
            await client.sourceTitle(entry.sourceThreadId).catch(() => null),
          );
        if (entry.projectId && !projects.has(entry.projectId))
          projects.set(
            entry.projectId,
            await client.projectName(entry.projectId).catch(() => null),
          );
      }
      if (disposed || current !== generation || !dialog.open) return;
      for (const entry of entries)
        list.append(
          render(
            entry,
            sourceTitles.get(entry.sourceThreadId) ?? null,
            entry.projectId ? (projects.get(entry.projectId) ?? null) : null,
          ),
        );
      status.textContent = entries.length
        ? `${entries.length} 条侧聊 · 关闭不会删除记录`
        : view === "collected"
          ? "还没有收纳的侧聊。可从“当前主对话的侧聊”逐条收纳。"
          : "当前主对话还没有可恢复的侧聊。";
    } catch (error) {
      if (!disposed && current === generation)
        status.textContent = error instanceof Error ? error.message : "侧聊列表读取失败";
    }
  }
  trigger.addEventListener("click", () => {
    focusBeforeOpen = document.activeElement;
    sourceId = findNativeSideChatScope(document, undefined, hostId)?.value.conversationId;
    view = "collected";
    if (!dialog.open) dialog.showModal();
    void refresh();
  });
  const onClose = () => {
    generation += 1;
    operation?.abort();
    operation = null;
    list.replaceChildren();
    if (focusBeforeOpen instanceof HTMLElement && focusBeforeOpen.isConnected)
      focusBeforeOpen.focus();
  };
  dialog.addEventListener("close", onClose);
  const onConnectionChange = () => {
    generation += 1;
    operation?.abort();
    operation = null;
    list.replaceChildren();
    if (dialog.open) void refresh();
  };
  ownerWindow.addEventListener("codexhost:draft-prewarm-policy-changed", onConnectionChange);
  let observer: MutationObserver | null = null;
  let frame: number | null = null;
  let observerTimeout: number | null = null;
  const mount = () => {
    if (disposed) return;
    const sidebar = document.querySelector("[data-app-action-sidebar-scroll]");
    if (sidebar) {
      if (trigger.parentElement !== sidebar) sidebar.prepend(trigger);
      observer?.disconnect();
      observer = null;
      if (observerTimeout !== null) ownerWindow.clearTimeout(observerTimeout);
      return true;
    }
    return false;
  };
  if (!mount()) {
    observer = new MutationObserver(() => {
      if (frame !== null) return;
      frame = ownerWindow.requestAnimationFrame(() => {
        frame = null;
        mount();
      });
    });
    observer.observe(document.getElementById("root") ?? document.body, {
      childList: true,
      subtree: true,
    });
    // A layout without this anchor must not leave a transcript-wide observer running.
    observerTimeout = ownerWindow.setTimeout(() => {
      observer?.disconnect();
      observer = null;
      if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
      frame = null;
    }, 10_000);
  }
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      operation?.abort();
      observer?.disconnect();
      if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
      if (observerTimeout !== null) ownerWindow.clearTimeout(observerTimeout);
      dialog.removeEventListener("close", onClose);
      ownerWindow.removeEventListener("codexhost:draft-prewarm-policy-changed", onConnectionChange);
      trigger.remove();
      dialog.remove();
      style.remove();
    },
  };
}
