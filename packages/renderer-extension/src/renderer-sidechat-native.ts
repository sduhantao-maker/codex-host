import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";
import { loadCodexNativeServices } from "./codex-native-services.js";
import type { SideChatEntry } from "./renderer-sidechat-library.js";

interface NativeScope {
  node: object;
  value: { routeKind: string; conversationId?: string; hostId?: string | null };
  get(...args: unknown[]): unknown;
  set(...args: unknown[]): unknown;
  watch(...args: unknown[]): unknown;
}
interface NavigationBus {
  handlers: Map<string, unknown>;
  dispatchHostMessage(message: { type: "navigate-to-route"; path: string }): void;
}
interface SideChatRegistration {
  kind: "local-side-chat";
  open(
    scope: NativeScope,
    component: NativeSideChatTab,
    params: Record<string, unknown>,
  ): Promise<unknown>;
}
type NativeSideChatTab = (...args: unknown[]) => unknown;
type NativeFork = (
  scope: NativeScope,
  input: { sourceConversationId: string; sourceWorkspaceRoot: string },
) => Promise<unknown>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function source(value: unknown): string {
  try {
    return typeof value === "function" ? Function.prototype.toString.call(value) : "";
  } catch {
    return "";
  }
}

export function isNativeSideChatRegistration(value: unknown): value is SideChatRegistration {
  return (
    record(value) &&
    value.kind === "local-side-chat" &&
    typeof value.open === "function" &&
    typeof value.Component === "function"
  );
}

export function isNativeSideChatTab(value: unknown): value is NativeSideChatTab {
  const body = source(value);
  return (
    body.includes("lockedCollaborationMode") &&
    body.includes("sideConversation") &&
    body.includes("side-chat:") &&
    body.includes("preserveServerConfiguration")
  );
}

export function isNativeSideChatFork(value: unknown): value is NativeFork {
  const body = source(value);
  return (
    body.includes("sourceWorkspaceRoot") &&
    body.includes("getThreadExecutionState") &&
    body.includes("forkConversationIntoLocal") &&
    body.includes("threadHeader.forkThreadPending")
  );
}

function isNavigationBus(value: unknown): value is NavigationBus {
  return (
    record(value) &&
    value.handlers instanceof Map &&
    value.handlers.has("navigate-to-route") &&
    typeof value.dispatchHostMessage === "function"
  );
}

function scopeFromHook(fiber: Record<string, unknown>): NativeScope[] {
  const scopes: NativeScope[] = [];
  let hook = fiber.memoizedState;
  for (let index = 0; record(hook) && "next" in hook && index < 150; index += 1) {
    const state = hook.memoizedState;
    const candidate = record(state) ? state.current : null;
    if (
      record(candidate) &&
      record(candidate.node) &&
      "chain" in candidate &&
      "scope" in candidate &&
      typeof candidate.get === "function" &&
      typeof candidate.set === "function" &&
      typeof candidate.watch === "function"
    ) {
      try {
        if (record(candidate.value) && candidate.value.routeKind === "local-thread")
          scopes.push(candidate as unknown as NativeScope);
      } catch {
        /* A retired native scope is not a navigation target. */
      }
    }
    hook = hook.next;
  }
  return scopes;
}

/** Only scopes below the currently presented page count; retained background routes do not. */
export function findNativeSideChatScope(
  document: Document,
  threadId?: string,
  hostId = "local",
): NativeScope | null {
  const pages = document.querySelectorAll('[data-app-shell-active-page="true"]');
  if (pages.length > 1) return null;
  const root = pages[0] ?? document.getElementById("root");
  if (!root) return null;
  const key = Object.getOwnPropertyNames(root).find(
    (name) => name.startsWith("__reactFiber$") || name.startsWith("__reactContainer$"),
  );
  const first: unknown = key ? Reflect.get(root, key) : null;
  if (!record(first)) return null;
  const stack = [first];
  const seen = new Set<unknown>();
  const matches = new Map<string, NativeScope>();
  const accept = (scope: NativeScope) => {
    const value = scope.value;
    if ((value.hostId ?? "local") !== hostId || typeof value.conversationId !== "string") return;
    if (threadId && value.conversationId !== threadId) return;
    matches.set(value.conversationId, scope);
  };
  for (const ancestor of committedReactAncestors(first))
    for (const scope of scopeFromHook(ancestor)) accept(scope);
  while (stack.length && seen.size < 50_000) {
    const fiber = stack.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    for (const scope of scopeFromHook(fiber)) accept(scope);
    if (record(fiber.child)) stack.push(fiber.child);
    if (fiber !== first && record(fiber.sibling)) stack.push(fiber.sibling);
  }
  return matches.size === 1 ? (matches.values().next().value ?? null) : null;
}

export function localThreadPath(threadId: string, hostId: string): string {
  if (!threadId.trim() || !hostId.trim()) throw new Error("聊天标识不能为空");
  return `/local/${encodeURIComponent(threadId)}${hostId === "local" ? "" : `?hostId=${encodeURIComponent(hostId)}`}`;
}

async function waitForScope(
  ownerWindow: Window,
  threadId: string,
  hostId: string,
  signal: AbortSignal,
): Promise<NativeScope> {
  signal.throwIfAborted();
  const existing = findNativeSideChatScope(ownerWindow.document, threadId, hostId);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const finish = (scope: NativeScope | null, error?: unknown) => {
      ownerWindow.clearInterval(poll);
      ownerWindow.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (scope) resolve(scope);
      else reject(error ?? new Error("未能打开所属主对话"));
    };
    const abort = () => finish(null, signal.reason);
    const poll = ownerWindow.setInterval(() => {
      const scope = findNativeSideChatScope(ownerWindow.document, threadId, hostId);
      if (scope) finish(scope);
    }, 50);
    const timeout = ownerWindow.setTimeout(() => finish(null), 5_000);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function createNativeSideChatActions(ownerWindow: Window = window) {
  const navigate = async (threadId: string, hostId: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    const current = findNativeSideChatScope(ownerWindow.document, threadId, hostId);
    if (current) return current;
    const bus = await loadCodexNativeServices(ownerWindow, isNavigationBus);
    signal.throwIfAborted();
    if (!bus) throw new Error("当前版本的原生聊天导航不可用");
    bus.dispatchHostMessage({ type: "navigate-to-route", path: localThreadPath(threadId, hostId) });
    return waitForScope(ownerWindow, threadId, hostId, signal);
  };
  const reopen = async (entry: SideChatEntry, hostId: string, signal: AbortSignal) => {
    if (entry.sourceAvailable === false) return navigate(entry.threadId, hostId, signal);
    const scope = await navigate(entry.sourceThreadId, hostId, signal);
    const [registration, component] = await Promise.all([
      loadCodexNativeServices(ownerWindow, isNativeSideChatRegistration),
      loadCodexNativeServices(ownerWindow, isNativeSideChatTab),
    ]);
    signal.throwIfAborted();
    if (
      !registration ||
      !component ||
      findNativeSideChatScope(ownerWindow.document, entry.sourceThreadId, hostId)?.node !==
        scope.node
    )
      throw new Error("当前版本的原生侧聊恢复接口不可用，请保留记录并重试");
    const opened = await registration.open(scope, component, {
      attachedConversationId: entry.threadId,
      sourceConversationId: entry.sourceThreadId,
      hostId,
      cwd: null,
      collaborationMode: null,
      displayTitle: entry.title,
      revealAndFocus: true,
      target: "right",
      intl: {
        formatMessage: (message: { defaultMessage?: string }) =>
          message.defaultMessage ?? "侧边聊天",
      },
    });
    if (opened !== entry.threadId) throw new Error("侧聊尚未恢复，原记录已保留");
    return scope;
  };
  return {
    navigate,
    reopen,
    async promote(
      entry: SideChatEntry,
      hostId: string,
      signal: AbortSignal,
      workspaceRoot: string,
    ): Promise<string> {
      if (entry.sourceAvailable === false) throw new Error("来源不可用，请直接打开原侧聊继续");
      if (!workspaceRoot.trim() || workspaceRoot === "~") throw new Error("无法确认侧聊工作目录");
      const scope = await reopen(entry, hostId, signal);
      const fork = await loadCodexNativeServices(ownerWindow, isNativeSideChatFork);
      signal.throwIfAborted();
      if (!fork) throw new Error("当前版本的原生转主接口不可用");
      const threadId = await fork(scope, {
        sourceConversationId: entry.threadId,
        sourceWorkspaceRoot: workspaceRoot,
      });
      if (
        typeof threadId !== "string" ||
        !threadId ||
        threadId === entry.sourceThreadId ||
        threadId === entry.threadId
      )
        throw new Error("未能确认独立主对话，原侧聊已保留");
      try {
        await navigate(threadId, hostId, signal);
      } catch (error) {
        throw new Error(
          `已创建独立主对话 ${threadId}，但未能打开。请从侧栏查找该聊天，原侧聊仍然保留。`,
          { cause: error },
        );
      }
      return threadId;
    },
    openProject(projectId: string): void {
      const rows = [
        ...ownerWindow.document.querySelectorAll<HTMLElement>(
          "[data-app-action-sidebar-project-id]",
        ),
      ].filter((row) => row.getAttribute("data-app-action-sidebar-project-id") === projectId);
      const buttons = new Set(
        rows.flatMap((row) => [
          ...(row.matches("[data-app-action-sidebar-select-project]") ? [row] : []),
          ...row.querySelectorAll<HTMLElement>("[data-app-action-sidebar-select-project]"),
        ]),
      );
      const button = [...buttons][0];
      if (buttons.size !== 1 || !button)
        throw new Error("该项目当前未显示在侧栏中，请先在项目列表中打开");
      button.scrollIntoView({ block: "nearest" });
      button.click();
    },
  };
}
