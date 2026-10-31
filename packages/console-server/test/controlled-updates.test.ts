import { describe, expect, it, vi } from "vitest";
import {
  UPDATE_INSTALLATION_DISABLED_REASON,
  type BackgroundUpdateManager,
} from "@codexhost/update-manager";
import { createConsoleUpdates, type ConsoleUpdateTarget } from "../src/updates.js";

const target: ConsoleUpdateTarget = {
  distribution: {
    schemaVersion: 1,
    version: "1.0.0",
    distribution: "installer",
    target: "macos-arm64",
  },
  appDirectory: "/unused/app",
  runtimeDescriptorPath: null,
  codexhostRunning: false,
};
const release = {
  version: "1.1.0",
  releaseNotes: "Upstream changes",
  releaseNotesUrl: "https://github.com/BytePioneer-AI/codex-host/releases/tag/v1.1.0",
  assets: [],
};

describe("personal console update policy", () => {
  it("keeps release information visible while installation is disabled", async () => {
    const updates = createConsoleUpdates({
      onHandedOff: vi.fn(),
      environment: {},
      fetchLatest: async () => release,
    });
    await expect(updates.check(target)).resolves.toMatchObject({
      latestVersion: "1.1.0",
      updateAvailable: true,
      installationAvailable: false,
      releaseNotes: release.releaseNotes,
      releaseNotesUrl: release.releaseNotesUrl,
      installationDisabledReason: UPDATE_INSTALLATION_DISABLED_REASON,
      error: null,
    });
  });

  it.each([true, false])(
    "blocks direct start before preparation with Host running=%s",
    async (codexhostRunning) => {
      const manager: BackgroundUpdateManager = {
        prepareNpm: vi.fn(),
        prepareMacOsDmg: vi.fn(),
        prepareWindowsInstaller: vi.fn(),
        start: vi.fn(),
        readStatus: vi.fn(),
      };
      const onHandedOff = vi.fn();
      const fetchLatest = vi.fn(async () => release);
      const updates = createConsoleUpdates({
        onHandedOff,
        environment: { CODEXHOST_ALLOW_UPDATES: "true" },
        manager,
        fetchLatest,
      });
      await expect(updates.start({ ...target, codexhostRunning })).rejects.toThrow(
        "This personal build uses controlled upgrades",
      );
      expect(fetchLatest).not.toHaveBeenCalled();
      expect(onHandedOff).not.toHaveBeenCalled();
      for (const method of Object.values(manager)) expect(method).not.toHaveBeenCalled();
    },
  );
});
