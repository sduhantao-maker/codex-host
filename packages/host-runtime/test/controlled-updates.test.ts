import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UPDATE_INSTALLATION_DISABLED_REASON,
  type BackgroundUpdateManager,
} from "@codexhost/update-manager";
import { createHostUpdateCoordinator } from "../src/update-coordinator.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

const release = {
  version: "1.1.0",
  releaseNotes: "Upstream changes",
  releaseNotesUrl: "https://github.com/BytePioneer-AI/codex-host/releases/tag/v1.1.0",
  assets: [],
};

describe("personal build update policy", () => {
  it.each(["development", "installer"] as const)(
    "shows upstream information without offering installation for %s",
    async (distribution) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "codexhost-controlled-update-"));
      roots.push(root);
      const hostRuntimePath = path.join(root, "packages/host-runtime/dist/main.js");
      await mkdir(path.dirname(hostRuntimePath), { recursive: true });
      await writeFile(hostRuntimePath, "");
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ name: "codexhost", version: "1.0.0" }),
      );
      if (distribution === "installer") {
        await writeFile(
          path.join(path.dirname(hostRuntimePath), "codexhost-distribution.json"),
          JSON.stringify({
            schemaVersion: 1,
            version: "1.0.0",
            distribution,
            target: "macos-arm64",
          }),
        );
      }
      const coordinator = createHostUpdateCoordinator({
        hostRuntimePath,
        environment: {},
        fetchLatest: async () => release,
      });
      await expect(coordinator.check()).resolves.toMatchObject({
        latestVersion: "1.1.0",
        updateAvailable: true,
        installationAvailable: false,
        releaseNotes: release.releaseNotes,
        releaseNotesUrl: release.releaseNotesUrl,
        installationDisabledReason: UPDATE_INSTALLATION_DISABLED_REASON,
        error: null,
      });
    },
  );

  it("rejects direct start before resolving an installation or preparing an update", async () => {
    const manager: BackgroundUpdateManager = {
      prepareNpm: vi.fn(),
      prepareMacOsDmg: vi.fn(),
      prepareWindowsInstaller: vi.fn(),
      start: vi.fn(),
      readStatus: vi.fn(),
    };
    const fetchLatest = vi.fn(async () => release);
    const coordinator = createHostUpdateCoordinator({
      hostRuntimePath: "/nonexistent/runtime.mjs",
      environment: { CODEXHOST_ALLOW_UPDATES: "true" },
      manager,
      fetchLatest,
    });
    await expect(coordinator.start()).rejects.toThrow(
      "This personal build uses controlled upgrades",
    );
    expect(fetchLatest).not.toHaveBeenCalled();
    for (const method of Object.values(manager)) expect(method).not.toHaveBeenCalled();
  });
});
