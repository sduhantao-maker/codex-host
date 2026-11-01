import { describe, expect, it } from "vitest";

import {
  updateCheckResultSchema,
  updateEmptyParamsSchema,
  updateStartResultSchema,
  updateStatusResultSchema,
  updateStatusSchema,
  runtimeStatusSchema,
} from "@codexhost/shared-contracts";

const status = {
  version: "1.2.3",
  installation: "macos-dmg",
  phase: "waiting-for-exit",
  updatedAt: 1_753_000_000,
  error: null,
} as const;

describe("update runtime contracts", () => {
  it("preserves restart capability and remains readable by the previous runtime status shape", () => {
    const previous = {
      runningVersion: "0.16.1",
      installedVersion: "0.16.1",
      restartRequired: true,
      remote: true,
      updateSupported: true,
      update: { phase: "idle", targetVersion: null, error: null },
    };
    const value = { ...previous, installationDisabledReason: "Controlled upgrades" };
    expect(runtimeStatusSchema.parse(previous)).toEqual(previous);
    expect(runtimeStatusSchema.parse(value)).toEqual(value);
    expect(runtimeStatusSchema.omit({ installationDisabledReason: true }).parse(value)).toEqual(
      previous,
    );
    expect(
      runtimeStatusSchema.safeParse({ ...value, installationDisabledReason: "x".repeat(501) })
        .success,
    ).toBe(false);
  });
  it("accepts an optional bounded installation policy without treating it as a failed check", () => {
    const result = {
      currentVersion: "1.2.2",
      installation: "npm",
      latestVersion: "1.2.3",
      updateAvailable: true,
      installationAvailable: false,
      installationDisabledReason: "Upgrade through the personal fork",
      releaseNotes: null,
      releaseNotesUrl: null,
      status: null,
      error: null,
    };
    expect(updateCheckResultSchema.parse(result)).toMatchObject({
      installationDisabledReason: result.installationDisabledReason,
      error: null,
    });
    expect(
      updateCheckResultSchema.safeParse({ ...result, installationDisabledReason: "x".repeat(501) })
        .success,
    ).toBe(false);
  });
  it("accepts bounded check, start, and status results", () => {
    expect(
      updateCheckResultSchema.parse({
        currentVersion: "1.2.2",
        installation: "macos-dmg",
        latestVersion: "1.2.3",
        updateAvailable: true,
        installationAvailable: true,
        releaseNotes: "## Changes\n\n- Safer updates",
        releaseNotesUrl: "https://github.com/BytePioneer-AI/codex-host/releases/tag/v1.2.3",
        status: null,
        error: null,
      }),
    ).toMatchObject({
      installation: "macos-dmg",
      latestVersion: "1.2.3",
      updateAvailable: true,
    });
    expect(updateStartResultSchema.parse({ status })).toEqual({ status });
    expect(updateStatusResultSchema.parse({ status })).toEqual({ status });
    expect(updateStatusResultSchema.parse({ status: null })).toEqual({ status: null });
  });

  it("accepts bounded download progress and rejects impossible byte counts", () => {
    expect(
      updateStatusSchema.parse({
        ...status,
        phase: "downloading",
        downloadedBytes: 42,
        totalBytes: 100,
      }),
    ).toMatchObject({ downloadedBytes: 42, totalBytes: 100 });
    expect(
      updateStatusSchema.safeParse({
        ...status,
        phase: "downloading",
        downloadedBytes: 101,
        totalBytes: 100,
      }).success,
    ).toBe(false);
  });

  it("requires empty strict params for every fixed operation", () => {
    expect(updateEmptyParamsSchema.parse({})).toEqual({});
    for (const privileged of [
      { url: "https://example.com/update.exe" },
      { version: "9.9.9" },
      { sha256: "ab".repeat(32) },
      { path: "/tmp/update" },
      { command: "npm install" },
      { target: "windows-x64" },
    ]) {
      expect(updateEmptyParamsSchema.safeParse(privileged).success).toBe(false);
    }
  });

  it("rejects unknown, unbounded, and non-GitHub data", () => {
    expect(updateStatusSchema.safeParse({ ...status, waitPid: 42 }).success).toBe(false);
    expect(updateStatusSchema.safeParse({ ...status, version: "1.2" }).success).toBe(false);
    expect(updateStatusSchema.safeParse({ ...status, error: "x".repeat(501) }).success).toBe(false);
    expect(
      updateCheckResultSchema.safeParse({
        currentVersion: "1.2.2",
        installation: "windows-installer",
        latestVersion: "1.2.3",
        updateAvailable: true,
        installationAvailable: true,
        releaseNotes: null,
        releaseNotesUrl: "https://example.com/releases/tag/v1.2.3",
        status: null,
        error: null,
      }).success,
    ).toBe(false);
    expect(
      updateCheckResultSchema.safeParse({
        currentVersion: "1.2.2",
        installation: "npm",
        latestVersion: "1.2.3",
        updateAvailable: true,
        installationAvailable: true,
        releaseNotes: null,
        releaseNotesUrl: "https://github.com/Other/codex-host/releases/tag/v1.2.3",
        status: null,
        error: null,
      }).success,
    ).toBe(false);
    expect(
      updateCheckResultSchema.safeParse({
        currentVersion: "1.2.2",
        installation: "npm",
        latestVersion: "1.2.3",
        updateAvailable: true,
        installationAvailable: true,
        releaseNotes: "x".repeat(20_001),
        releaseNotesUrl: "https://github.com/BytePioneer-AI/codex-host/releases/tag/v1.2.3",
        status: null,
        error: null,
      }).success,
    ).toBe(false);
  });
});
