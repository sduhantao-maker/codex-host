import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function personalBuildIdentity(version, commit, dirty = false) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version))
    throw new Error("Personal build requires a semantic base version");
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(commit))
    throw new Error("Personal build requires a full Git commit");
  if (typeof dirty !== "boolean") throw new Error("Personal build dirty state must be boolean");
  return {
    schemaVersion: 1,
    baseVersion: version,
    commit,
    dirty,
    displayVersion: `${version.split("+")[0]}+sidechat.${commit.slice(0, 8)}${dirty ? ".dirty" : ""}`,
  };
}

/** Stamp display-only keys; CFBundleVersion remains the installer's numeric version. */
export function stampPersonalBuildPlist(infoPath, identityPath) {
  const stored = JSON.parse(readFileSync(identityPath, "utf8"));
  if (typeof stored.dirty !== "boolean")
    throw new Error("Personal build dirty state must be boolean");
  const identity = personalBuildIdentity(stored.baseVersion, stored.commit, stored.dirty);
  if (stored.schemaVersion !== 1 || stored.displayVersion !== identity.displayVersion)
    throw new Error("Personal build identity is inconsistent");
  for (const [key, value] of [
    ["CodexHostBuildIdentity", identity.displayVersion],
    ["CodexHostSourceCommit", identity.commit],
  ]) {
    execFileSync("/usr/bin/plutil", ["-insert", key, "-string", value, infoPath]);
  }
  execFileSync("/usr/bin/plutil", ["-insert", "CodexHostPersonalBuild", "-bool", "true", infoPath]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [action, infoPath, identityPath, ...extra] = process.argv.slice(2);
  if (action !== "--stamp-plist" || !infoPath || !identityPath || extra.length)
    throw new Error("usage: personal-build.mjs --stamp-plist <Info.plist> <personal-build.json>");
  stampPersonalBuildPlist(infoPath, identityPath);
}

export function readPersonalBuildIdentity(root) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  if (realpathSync(git("rev-parse", "--show-toplevel")) !== realpathSync(root))
    throw new Error("Personal build root must be its own Git checkout");
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return personalBuildIdentity(
    version,
    git("rev-parse", "HEAD"),
    git("status", "--porcelain") !== "",
  );
}
