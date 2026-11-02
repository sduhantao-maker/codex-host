import { afterEach, describe, expect, it, vi } from "vitest";
import { sideChatLibraryItemSchema } from "@codexhost/shared-contracts";
import { committedReactAncestors } from "@codexhost/desktop-control/renderer-bindings";
import { loadCodexNativeServices } from "../src/codex-native-services.js";
import {
  createNativeSideChatActions,
  findNativeSideChatScope,
  findSideChatConversationId,
  isNativeSideChatRegistration,
  isNativeSideChatTab,
  localThreadPath,
} from "../src/renderer-sidechat-native.js";

vi.mock("../src/codex-native-services.js", () => ({ loadCodexNativeServices: vi.fn() }));
vi.mock("@codexhost/desktop-control/renderer-bindings", () => ({
  committedReactAncestors: vi.fn(() => []),
}));
const entry = sideChatLibraryItemSchema.parse({
  threadId: "side-1",
  sourceThreadId: "parent-1",
  projectId: "project-1",
  title: "侧聊",
  collected: false,
});

function fixture() {
  const scope = {
    node: {},
    chain: [],
    scope: {},
    value: { routeKind: "local-thread", conversationId: "parent-1", hostId: "local" },
    get() {},
    set() {},
    watch() {},
  };
  const page = {
    __reactFiber$test: { memoizedState: { memoizedState: { current: scope }, next: null } },
  };
  const document = { querySelectorAll: () => [page], getElementById: () => null };
  const location = { pathname: "/index.html", search: "" };
  const ownerWindow = { document, location } as unknown as Window;
  const registration = {
    kind: "local-side-chat",
    Component() {},
    open: vi.fn<(...args: unknown[]) => Promise<string>>(async () => "side-1"),
  };
  const component = function sideComponent() {
    return {
      lockedCollaborationMode: true,
      sideConversation: true,
      preserveServerConfiguration: true,
      key: "side-chat:",
    };
  };
  vi.mocked(loadCodexNativeServices).mockImplementation(
    async (_window, match) => [registration, component].find(match) ?? null,
  );
  return { scope, page, document, ownerWindow, location, registration, component };
}
afterEach(() => vi.resetAllMocks());

describe("current side chat conversation", () => {
  it("uses the active page route when the parent and side chat both have scopes", () => {
    const f = fixture();
    Object.assign(f.page.__reactFiber$test, {
      child: {
        memoizedState: {
          next: null,
          memoizedState: {
            current: { ...f.scope, value: { ...f.scope.value, conversationId: "side-1" } },
          },
        },
      },
    });
    vi.mocked(committedReactAncestors).mockReturnValue([
      {
        memoizedProps: {
          value: { navigationType: "PUSH", location: { pathname: "/local/parent-1" } },
        },
      },
    ]);
    expect(findNativeSideChatScope(f.ownerWindow.document)).toBeNull();
    expect(findSideChatConversationId(f.ownerWindow)).toBe("parent-1");
  });

  it.each([
    ["/local/side%2D1", "", "side-1"],
    ["/local/side-1", "?hostId=remote", undefined],
    ["/local/side-1", "?hostId=local&hostId=local", undefined],
    ["/local/%", "", undefined],
    ["/scheduled", "", undefined],
  ])("uses only an unambiguous local conversation path %s %s", (pathname, search, expected) => {
    const f = fixture();
    f.document.querySelectorAll = () => [];
    Object.assign(f.location, { pathname, search });
    expect(findSideChatConversationId(f.ownerWindow)).toBe(expected);
  });
});

describe("native side chat restoration", () => {
  it("cold-opens the original child ID through the native persistent-tab path", async () => {
    const f = fixture();
    await createNativeSideChatActions(f.ownerWindow).reopen(
      entry,
      "local",
      new AbortController().signal,
    );
    expect(f.registration.open).toHaveBeenCalledExactlyOnceWith(
      f.scope,
      f.component,
      expect.objectContaining({
        attachedConversationId: "side-1",
        sourceConversationId: "parent-1",
        hostId: "local",
        displayTitle: "侧聊",
      }),
    );
    const params = f.registration.open.mock.calls[0]?.[2];
    expect(params).not.toHaveProperty("prepareConversation");
    expect(params).not.toHaveProperty("input");
  });

  it("does not create a substitute conversation if native restoration returns another ID", async () => {
    const f = fixture();
    f.registration.open.mockResolvedValue("different-id");
    await expect(
      createNativeSideChatActions(f.ownerWindow).reopen(
        entry,
        "local",
        new AbortController().signal,
      ),
    ).rejects.toThrow("原记录已保留");
    expect(f.registration.open).toHaveBeenCalledTimes(1);
  });

  it("rejects a route changed while native services were loading", async () => {
    const f = fixture();
    vi.mocked(loadCodexNativeServices).mockImplementation(async (_window, match) => {
      const value = [f.registration, f.component].find(match) ?? null;
      f.scope.value.conversationId = "other-parent";
      return value;
    });
    await expect(
      createNativeSideChatActions(f.ownerWindow).reopen(
        entry,
        "local",
        new AbortController().signal,
      ),
    ).rejects.toThrow("恢复接口不可用");
    expect(f.registration.open).not.toHaveBeenCalled();
  });

  it("rejects ambiguous active pages and a different host", () => {
    const f = fixture();
    expect(
      findNativeSideChatScope(f.document as unknown as Document, "parent-1", "remote"),
    ).toBeNull();
    f.document.querySelectorAll = () => [f.page, f.page];
    expect(findNativeSideChatScope(f.document as unknown as Document)).toBeNull();
  });

  it("fails closed when the native tab contract is missing", async () => {
    const f = fixture();
    vi.mocked(loadCodexNativeServices).mockResolvedValue(null);
    await expect(
      createNativeSideChatActions(f.ownerWindow).reopen(
        entry,
        "local",
        new AbortController().signal,
      ),
    ).rejects.toThrow("恢复接口不可用");
    expect(f.registration.open).not.toHaveBeenCalled();
  });

  it("promotes from the side chat using its verified workspace, preserving the original parent", async () => {
    const f = fixture();
    const calls: unknown[] = [];
    async function nativeFork(
      scope: unknown,
      input: { sourceConversationId: string; sourceWorkspaceRoot: string },
    ) {
      const markers = [
        "getThreadExecutionState",
        "forkConversationIntoLocal",
        "threadHeader.forkThreadPending",
      ];
      void markers;
      if (!input.sourceWorkspaceRoot) throw new Error("Missing workspace");
      calls.push({ scope, input });
      return "new-main";
    }
    const bus = {
      handlers: new Map([["navigate-to-route", true]]),
      dispatchHostMessage(message: { path: string }) {
        calls.push(message);
        f.scope.value.conversationId = "new-main";
      },
    };
    vi.mocked(loadCodexNativeServices).mockImplementation(async (_window, match) => {
      const services: unknown[] = [f.registration, f.component, nativeFork, bus];
      return services.find(match) ?? null;
    });
    expect(
      await createNativeSideChatActions(f.ownerWindow).promote(
        entry,
        "local",
        new AbortController().signal,
        "/work/original-project",
      ),
    ).toBe("new-main");
    expect(calls).toEqual([
      {
        scope: f.scope,
        input: { sourceConversationId: "side-1", sourceWorkspaceRoot: "/work/original-project" },
      },
      { type: "navigate-to-route", path: "/local/new-main" },
    ]);
    expect(f.registration.open).toHaveBeenCalledTimes(1);
  });

  it("does not guess a workspace or open a conversation after cancellation", async () => {
    const f = fixture();
    await expect(
      createNativeSideChatActions(f.ownerWindow).promote(
        entry,
        "local",
        new AbortController().signal,
        "~",
      ),
    ).rejects.toThrow("工作目录");
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      createNativeSideChatActions(f.ownerWindow).reopen(entry, "local", cancelled.signal),
    ).rejects.toThrow();
    expect(f.registration.open).not.toHaveBeenCalled();
  });

  it("opens an orphan side chat by the same ID without calling side-panel creation or fork", async () => {
    const f = fixture();
    const calls: unknown[] = [];
    const bus = {
      handlers: new Map([["navigate-to-route", true]]),
      dispatchHostMessage(message: { path: string }) {
        calls.push(message);
        f.scope.value.conversationId = "side-1";
      },
    };
    vi.mocked(loadCodexNativeServices).mockImplementation(async (_window, match) => {
      const services: unknown[] = [bus, f.registration, f.component];
      return services.find(match) ?? null;
    });
    const orphan = { ...entry, projectId: null, sourceAvailable: false };
    await createNativeSideChatActions(f.ownerWindow).reopen(
      orphan,
      "local",
      new AbortController().signal,
    );
    expect(calls).toEqual([{ type: "navigate-to-route", path: "/local/side-1" }]);
    expect(f.registration.open).not.toHaveBeenCalled();
    await expect(
      createNativeSideChatActions(f.ownerWindow).promote(
        orphan,
        "local",
        new AbortController().signal,
        "/work/project",
      ),
    ).rejects.toThrow("直接打开原侧聊");
    expect(calls).toHaveLength(1);
  });

  it("recognizes semantic services, not hashed export names", () => {
    const f = fixture();
    expect(isNativeSideChatRegistration(f.registration)).toBe(true);
    expect(isNativeSideChatTab(f.component)).toBe(true);
    expect(isNativeSideChatTab(() => "side-chat:")).toBe(false);
    expect(isNativeSideChatRegistration({ ...f.registration, kind: "other" })).toBe(false);
  });

  it("escapes route parameters rather than treating IDs as paths or query strings", () => {
    expect(localThreadPath("a/b?c", "remote&host")).toBe("/local/a%2Fb%3Fc?hostId=remote%26host");
    expect(() => localThreadPath("", "local")).toThrow();
  });

  it("uses the native project control even when the ID and selection markers share one element", () => {
    const project = {
      getAttribute: () => "project-1",
      matches: () => true,
      querySelectorAll: () => [],
      scrollIntoView: vi.fn(),
      click: vi.fn(),
    };
    const ownerWindow = { document: { querySelectorAll: () => [project] } } as unknown as Window;
    createNativeSideChatActions(ownerWindow).openProject("project-1");
    expect(project.click).toHaveBeenCalledTimes(1);
    expect(() => createNativeSideChatActions(ownerWindow).openProject("different-project")).toThrow(
      "未显示",
    );
  });
});
