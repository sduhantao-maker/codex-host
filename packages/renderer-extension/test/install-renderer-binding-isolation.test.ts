import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  binding: { dispose: vi.fn(), setAdapter: vi.fn() },
  installFeatures: vi.fn(),
  adapter: {
    status: { state: "ready", reason: "ready", modelUpdates: 0, hook: "request-bridge" },
    dispose: vi.fn(),
    applyAgent: vi.fn(),
    modelControl: {},
  },
}));
vi.mock("../src/renderer-binding-probe.js", () => ({
  installRendererBindingProbe: () => f.binding,
}));
vi.mock("../src/versioned-renderer-adapter.js", () => ({
  installCurrentRendererAdapter: () => f.adapter,
}));
vi.mock("../src/renderer-sidechat-features.js", () => ({
  installRendererSideChatFeatures: f.installFeatures,
}));
import { installRendererBinding } from "../src/install-renderer-binding.js";
beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", {});
  f.binding.dispose = vi.fn();
  f.binding.setAdapter.mockReset();
  f.installFeatures.mockReset();
});
it("retains the original Agent and Model binding when optional installation throws", () => {
  f.installFeatures.mockImplementation(() => {
    throw new Error("body missing");
  });
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(installRendererBinding()).toBe(f.binding);
    expect(f.binding.setAdapter).toHaveBeenCalledExactlyOnceWith(
      f.adapter.status,
      f.adapter.dispose,
      f.adapter.applyAgent,
      f.adapter.modelControl,
    );
  } finally {
    error.mockRestore();
    vi.unstubAllGlobals();
  }
});
it("runs original cleanup even if optional cleanup fails", () => {
  const original = f.binding.dispose;
  f.installFeatures.mockReturnValue({
    dispose() {
      throw new Error("optional cleanup failed");
    },
  });
  const binding = installRendererBinding();
  expect(() => binding.dispose()).not.toThrow();
  expect(original).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
