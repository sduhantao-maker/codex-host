import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import { spawn } from "node:child_process";
import { createHostDesktopShellOpener } from "../src/desktop-shell-opener.js";

const launcher = path.resolve("installation/bin/codexhost");
let root: string;
let runtime: string;

function child(code: number, stderr = "") {
  const process = Object.assign(new EventEmitter(), { stderr: new PassThrough() });
  setImmediate(() => {
    process.stderr.end(stderr);
    process.emit("close", code);
  });
  return process;
}

beforeEach(async () => {
  vi.mocked(spawn).mockReset();
  root = await mkdtemp(path.join(tmpdir(), "codexhost-desktop-shell-opener-"));
  runtime = path.join(root, "app/host-runtime.mjs");
  await mkdir(path.dirname(runtime));
  await writeFile(
    path.join(root, "app/codexhost-distribution.json"),
    JSON.stringify({
      schemaVersion: 1,
      version: "0.29.0",
      distribution: "installer",
      target: "macos-arm64",
    }),
  );
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("Host desktop shell opener", () => {
  it("asks the installed Launcher for the CodexHost window with the Host environment", async () => {
    vi.mocked(spawn).mockImplementation(() => child(0) as never);
    const environment = {
      CODEXHOST_LAUNCHER_EXECUTABLE: launcher,
      CODEXHOST_HOST_RUNTIME_PATH: runtime,
      CODEXHOST_DATA_DIR: path.resolve("data"),
    };
    await expect(createHostDesktopShellOpener(environment)?.open()).resolves.toEqual({});
    expect(spawn).toHaveBeenCalledExactlyOnceWith(launcher, ["app"], {
      env: environment,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
  });

  it("is unavailable without an absolute local Launcher", () => {
    expect(createHostDesktopShellOpener({})).toBeUndefined();
    expect(
      createHostDesktopShellOpener({ CODEXHOST_LAUNCHER_EXECUTABLE: "codexhost" }),
    ).toBeUndefined();
    expect(
      createHostDesktopShellOpener({
        CODEXHOST_LAUNCHER_EXECUTABLE: launcher,
        CODEXHOST_REMOTE_SSH_MANAGED: "1",
      }),
    ).toBeUndefined();
  });

  it("rejects a development build without starting the Launcher", async () => {
    await rm(path.join(root, "app/codexhost-distribution.json"));
    await expect(
      createHostDesktopShellOpener({
        CODEXHOST_LAUNCHER_EXECUTABLE: launcher,
        CODEXHOST_HOST_RUNTIME_PATH: runtime,
      })?.open(),
    ).rejects.toThrow("The CodexHost window is unavailable in a development build");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reports the Launcher's last error line", async () => {
    vi.mocked(spawn).mockImplementation(
      () => child(1, "codexhost launcher: User data directory is unavailable\n") as never,
    );
    await expect(
      createHostDesktopShellOpener({
        CODEXHOST_LAUNCHER_EXECUTABLE: launcher,
        CODEXHOST_HOST_RUNTIME_PATH: runtime,
      })?.open(),
    ).rejects.toThrow("User data directory is unavailable");
  });
});
