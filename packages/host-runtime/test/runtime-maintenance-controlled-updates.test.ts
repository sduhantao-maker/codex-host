import type * as ChildProcess from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access, readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
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
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function npmRuntime() {
  const root = await mkdtemp(path.join(tmpdir(), "codexhost-controlled-restart-"));
  roots.push(root);
  const pkg = path.join(root, "node_modules/@codexhost/cli-darwin-arm64");
  const runtimePath = path.join(pkg, "app/host-runtime.mjs");
  const npmCli = path.join(root, "npm-cli.js");
  await Promise.all(
    ["app", "libexec", "../cli/bin"].map((dir) => mkdir(path.join(pkg, dir), { recursive: true })),
  );
  const metadata = (version: string) =>
    writeFile(
      path.join(pkg, "app/codexhost-distribution.json"),
      JSON.stringify({ schemaVersion: 1, version, distribution: "npm", target: "macos-arm64" }),
    );
  await Promise.all([
    writeFile(runtimePath, "// first build"),
    writeFile(path.join(pkg, "libexec/codexhost-updater"), "fixture"),
    writeFile(path.join(pkg, "../cli/bin/codexhost.js"), "fixture"),
    writeFile(npmCli, "fixture"),
    metadata("0.16.1"),
  ]);
  const data = path.join(root, "data");
  const runtime = new RuntimeMaintenance({
    runtimePath,
    remote: true,
    environment: { HOME: root, CODEXHOST_DATA_DIR: data, CODEXHOST_NPM_CLI_PATH: npmCli },
  });
  await runtime.status();
  return { runtime, runtimePath, data, metadata };
}

function reportMockHelper(statusPath: string) {
  const starter = Object.assign(new EventEmitter(), { stdout: new EventEmitter() });
  queueMicrotask(() => {
    starter.stdout.emit("data", `${process.pid}\n`);
    void writeFile(
      statusPath,
      JSON.stringify({
        phase: "installing",
        targetVersion: "0.16.1",
        error: null,
        updaterPid: process.pid,
      }),
    ).then(() => starter.emit("close", 0));
  });
  return starter;
}

describe("personal build remote update policy", () => {
  it.skipIf(process.platform === "win32")(
    "allows a same-version restart without installing or changing versions",
    async () => {
      const { runtime, runtimePath, data } = await npmRuntime();
      await writeFile(runtimePath, "// replaced build at the same version");
      await expect(runtime.status()).resolves.toMatchObject({
        restartRequired: true,
        updateSupported: true,
        installationDisabledReason: UPDATE_INSTALLATION_DISABLED_REASON,
      });
      spawn.mockImplementation(() => reportMockHelper(path.join(data, "remote-update.json")));
      await expect(runtime.start("0.16.1")).resolves.toMatchObject({
        update: { phase: "installing" },
      });
      expect(spawn).toHaveBeenCalledOnce();
      const args = spawn.mock.calls[0]?.[1];
      assert(Array.isArray(args) && typeof args[3] === "string");
      const request = JSON.parse(await readFile(args[3], "utf8"));
      expect(request).toMatchObject({
        version: "0.16.1",
        installedVersion: "0.16.1",
        restartOnly: true,
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps a matching current service unchanged",
    async () => {
      const { runtime, data } = await npmRuntime();
      await expect(runtime.start("0.16.1")).resolves.toMatchObject({
        restartRequired: false,
        updateSupported: true,
        update: { phase: "idle" },
      });
      expect(spawn).not.toHaveBeenCalled();
      await expect(access(data)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses an installation if the version changes after restart admission",
    async () => {
      assert(UPDATE_INSTALLATION_DISABLED_REASON);
      const { runtime, runtimePath, metadata, data } = await npmRuntime();
      await writeFile(runtimePath, "// replaced build");
      const readStatus = runtime.status.bind(runtime);
      vi.spyOn(runtime, "status").mockImplementationOnce(async () => {
        const status = await readStatus();
        await metadata("0.15.0");
        return status;
      });
      await expect(runtime.start("0.16.1")).rejects.toThrow(UPDATE_INSTALLATION_DISABLED_REASON);
      expect(spawn).not.toHaveBeenCalled();
      expect(runtime.blocked).toBe(false);
      await expect(access(data)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
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
    const { runtime, data } = await npmRuntime();
    assert(UPDATE_INSTALLATION_DISABLED_REASON);
    await expect(runtime.status()).resolves.toMatchObject({
      runningVersion: "0.16.1",
      installedVersion: "0.16.1",
      updateSupported: process.platform !== "win32",
      installationDisabledReason: UPDATE_INSTALLATION_DISABLED_REASON,
    });
    await expect(runtime.start("0.17.0")).rejects.toThrow(UPDATE_INSTALLATION_DISABLED_REASON);
    expect(spawn).not.toHaveBeenCalled();
    expect(runtime.blocked).toBe(false);
    await expect(access(data)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
