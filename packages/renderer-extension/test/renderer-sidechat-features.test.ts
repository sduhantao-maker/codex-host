import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  RendererHostRoute,
  RendererHostRouting,
} from "@codexhost/desktop-control/renderer-bindings";
import {
  DEFAULT_SIDE_CHAT_FEATURES,
  SIDE_CHAT_FEATURES_GET_METHOD,
  SIDE_CHAT_FEATURES_CHANGED_METHOD,
} from "@codexhost/shared-contracts";
const install = vi.hoisted(() => vi.fn());
vi.mock("../src/renderer-sidechat-controls.js", () => ({
  installRendererSideChatControls: install,
}));
import { installRendererSideChatFeatures } from "../src/renderer-sidechat-features.js";

const enabled = {
  settings: { ...DEFAULT_SIDE_CHAT_FEATURES, sideChatLibrary: true },
  capabilities: {
    persistentSideChats: true,
    sideChatLibrary: true,
    claudeActiveSideChatFork: true,
  },
};
const off = { ...enabled, settings: { ...DEFAULT_SIDE_CHAT_FEATURES } };
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};
function fixture() {
  const owner = new EventTarget() as unknown as Window;
  const document = Object.assign(new EventTarget(), {
    defaultView: owner,
    head: {},
    body: {},
  }) as unknown as Document;
  const send = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => off);
  let route = {
    hostId: "local",
    manager: { sendRequest: send },
  } as unknown as RendererHostRoute | null;
  const routing = {
    forHost: (hostId: string) => (hostId === "local" ? route : null),
  } as RendererHostRouting;
  const notify = (params: unknown, hostId = "local") =>
    owner.dispatchEvent(
      Object.assign(new Event("message"), {
        source: owner,
        data: {
          type: "mcp-notification",
          hostId,
          method: SIDE_CHAT_FEATURES_CHANGED_METHOD,
          params,
        },
      }),
    );
  return {
    owner,
    document,
    send,
    routing,
    notify,
    retire: () => {
      route = null;
    },
  };
}
beforeEach(() => {
  install.mockReset();
  install.mockReturnValue({ dispose: vi.fn() });
});

describe("optional side chat controls", () => {
  it("keeps the default-off path free of controls, observers and library queries", async () => {
    const f = fixture();
    const feature = installRendererSideChatFeatures(f.document, () => f.routing);
    await flush();
    expect(install).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledExactlyOnceWith(SIDE_CHAT_FEATURES_GET_METHOD, {});
    feature.dispose();
  });
  it("hot enables and removes controls only for the acknowledged local capability", async () => {
    const f = fixture();
    const dispose = vi.fn();
    install.mockReturnValue({ dispose });
    const feature = installRendererSideChatFeatures(f.document, () => f.routing);
    await flush();
    f.notify(enabled, "remote");
    expect(install).not.toHaveBeenCalled();
    f.notify({ ...enabled, capabilities: { ...enabled.capabilities, sideChatLibrary: false } });
    expect(install).not.toHaveBeenCalled();
    f.notify(enabled);
    expect(install).toHaveBeenCalledTimes(1);
    f.notify(enabled);
    expect(install).toHaveBeenCalledTimes(1);
    f.notify(off);
    expect(dispose).toHaveBeenCalledTimes(1);
    f.notify(enabled);
    expect(install).toHaveBeenCalledTimes(2);
    feature.dispose();
    expect(dispose).toHaveBeenCalledTimes(2);
    f.notify(enabled);
    expect(install).toHaveBeenCalledTimes(2);
  });
  it("does not let a stale get response re-enable a disabled or retired connection", async () => {
    const f = fixture();
    const pending = Promise.withResolvers<unknown>();
    f.send.mockReturnValue(pending.promise);
    const feature = installRendererSideChatFeatures(f.document, () => f.routing);
    await flush();
    f.notify(off);
    pending.resolve(enabled);
    await flush();
    expect(install).not.toHaveBeenCalled();
    f.retire();
    f.notify(enabled);
    await flush();
    expect(install).not.toHaveBeenCalled();
    feature.dispose();
  });
  it("isolates unavailable features and throwing installers", async () => {
    const f = fixture();
    f.send.mockRejectedValue(new Error("unsupported"));
    const feature = installRendererSideChatFeatures(f.document, () => f.routing);
    await flush();
    expect(install).not.toHaveBeenCalled();
    install.mockImplementation(() => {
      throw new Error("document body not ready");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => f.notify(enabled)).not.toThrow();
    expect(() => feature.dispose()).not.toThrow();
    consoleError.mockRestore();
  });
  it("waits for the document instead of installing into a missing body", async () => {
    const f = fixture();
    Object.assign(f.document, { body: null });
    f.send.mockResolvedValue(enabled);
    const feature = installRendererSideChatFeatures(f.document, () => f.routing);
    await flush();
    expect(install).not.toHaveBeenCalled();
    Object.assign(f.document, { body: {} });
    f.document.dispatchEvent(new Event("DOMContentLoaded"));
    await flush();
    expect(install).toHaveBeenCalledTimes(1);
    feature.dispose();
  });
});
