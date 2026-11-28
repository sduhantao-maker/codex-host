import { spawn } from "node:child_process";
import path from "node:path";
import type { DesktopShellOpenResult } from "@codexhost/shared-contracts";
import { readRuntimeMetadata } from "@codexhost/update-manager";

export interface HostDesktopShellOpener {
  open(): Promise<DesktopShellOpenResult>;
}

/**
 * The Launcher owns the desktop shell: `codexhost app` starts the CodexHost
 * window, or brings the running one forward with its page intact.
 */
export function createHostDesktopShellOpener(
  environment: NodeJS.ProcessEnv,
): HostDesktopShellOpener | undefined {
  const launcher = environment.CODEXHOST_LAUNCHER_EXECUTABLE;
  if (!launcher || !path.isAbsolute(launcher) || environment.CODEXHOST_REMOTE_SSH_MANAGED === "1") {
    return undefined;
  }
  return {
    async open() {
      const runtime = await readRuntimeMetadata(
        environment.CODEXHOST_HOST_RUNTIME_PATH ?? "",
        environment,
      ).catch(() => null);
      if (!runtime || runtime.distribution === "development") {
        throw new Error(
          "The CodexHost window is unavailable in a development build; run npm start app",
        );
      }
      return new Promise((resolve, reject) => {
        const child = spawn(launcher, ["app"], {
          env: environment,
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString("utf8")).slice(-16 * 1024);
        });
        child.once("error", reject);
        child.once("close", (code) => {
          if (code === 0) resolve({});
          else {
            reject(
              new Error(
                stderr.trim().split(/\r?\n/u).at(-1) || "The CodexHost window could not be opened",
              ),
            );
          }
        });
      });
    },
  };
}
