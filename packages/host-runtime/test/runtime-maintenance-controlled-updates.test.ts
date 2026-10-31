import type * as ChildProcess from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { UPDATE_INSTALLATION_DISABLED_REASON } from "@codexhost/update-manager";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof ChildProcess>()),
  spawn,
}));
import { RuntimeMaintenance } from "../src/runtime-maintenance.js";

const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("personal build remote update policy", () => {
  it("rejects the SSH update fallback before invoking the installation helper", async () => {
    assert(UPDATE_INSTALLATION_DISABLED_REASON);
    const runtime = new RuntimeMaintenance({
      runtimePath: "/nonexistent/personal-host-runtime.mjs",
      remote: false,
      environment: {},
    });
    await expect(
      runtime.setupSsh({
        hostname: "example.invalid",
        port: null,
        identity: null,
        action: "update",
        version: "0.17.0",
      }),
    ).rejects.toThrow(UPDATE_INSTALLATION_DISABLED_REASON);
    expect(spawn).not.toHaveBeenCalled();
    expect(runtime.blocked).toBe(false);
  });

  it("rejects direct runtime updates before starting a helper or writing update state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codexhost-controlled-runtime-"));
    roots.push(root);
    const pkg = path.join(root, "node_modules/@codexhost/cli-darwin-arm64");
    const runtimePath = path.join(pkg, "app/host-runtime.mjs");
    const npmCli = path.join(root, "npm-cli.js");
    await Promise.all(
      ["app", "libexec", "../cli/bin"].map((dir) =>
        mkdir(path.join(pkg, dir), { recursive: true }),
      ),
    );
    await Promise.all([
      writeFile(runtimePath, "// personal build"),
      writeFile(path.join(pkg, "libexec/codexhost-updater"), "fixture"),
      writeFile(path.join(pkg, "../cli/bin/codexhost.js"), "fixture"),
      writeFile(npmCli, "fixture"),
      writeFile(
        path.join(pkg, "app/codexhost-distribution.json"),
        JSON.stringify({
          schemaVersion: 1,
          version: "0.16.1",
          distribution: "npm",
          target: "macos-arm64",
        }),
      ),
    ]);
    const data = path.join(root, "data");
    const runtime = new RuntimeMaintenance({
      runtimePath,
      remote: true,
      environment: { HOME: root, CODEXHOST_DATA_DIR: data, CODEXHOST_NPM_CLI_PATH: npmCli },
    });
    assert(UPDATE_INSTALLATION_DISABLED_REASON);
    await expect(runtime.status()).resolves.toMatchObject({
      runningVersion: "0.16.1",
      installedVersion: "0.16.1",
      updateSupported: false,
    });
    await expect(runtime.start("0.17.0")).rejects.toThrow(UPDATE_INSTALLATION_DISABLED_REASON);
    expect(spawn).not.toHaveBeenCalled();
    expect(runtime.blocked).toBe(false);
    await expect(access(data)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
