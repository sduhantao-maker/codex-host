import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export function personalBuildIdentity(version, commit, dirty = false) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version))
    throw new Error("Personal build requires a semantic base version");
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(commit))
    throw new Error("Personal build requires a full Git commit");
  return {
    schemaVersion: 1,
    baseVersion: version,
    commit,
    dirty,
    displayVersion: `${version.split("+")[0]}+sidechat.${commit.slice(0, 8)}${dirty ? ".dirty" : ""}`,
  };
}

export function readPersonalBuildIdentity(root) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  if (path.resolve(git("rev-parse", "--show-toplevel")) !== path.resolve(root))
    throw new Error("Personal build root must be its own Git checkout");
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return personalBuildIdentity(
    version,
    git("rev-parse", "HEAD"),
    git("status", "--porcelain") !== "",
  );
}
