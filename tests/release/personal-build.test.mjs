import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  personalBuildIdentity,
  readPersonalBuildIdentity,
  stampPersonalBuildPlist,
} from "../../scripts/release/personal-build.mjs";
import { numericPackageVersion } from "../../scripts/release/prepare-payload.mjs";

const commit = "1234567890abcdef1234567890abcdef12345678";

describe("sidechat build identity", () => {
  it("keeps the semantic base version separate from its display label", () => {
    const identity = personalBuildIdentity("0.16.1", commit);
    expect(identity).toMatchObject({
      baseVersion: "0.16.1",
      displayVersion: "0.16.1+sidechat.12345678",
      commit,
      dirty: false,
    });
    expect(numericPackageVersion(identity.baseVersion)).toBe("0.16.1");
    expect(personalBuildIdentity("0.16.1+old", commit, true).displayVersion).toBe(
      "0.16.1+sidechat.12345678.dirty",
    );
    expect(() => personalBuildIdentity("0.16.1/../../outside", commit)).toThrow("semantic");
    expect(() => personalBuildIdentity("0.16.1", "HEAD")).toThrow("full Git commit");
    expect(() => personalBuildIdentity("0.16.1", commit, "false")).toThrow("boolean");
  });

  it("records the checkout's actual commit and uncommitted state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexhost-personal-build-"));
    const git = (...args) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    try {
      git("init", "-q");
      git("config", "user.name", "Fixture");
      git("config", "user.email", "fixture@example.invalid");
      await writeFile(path.join(root, "package.json"), '{"version":"0.16.1"}\n');
      git("add", "--", "package.json");
      git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
      const identity = readPersonalBuildIdentity(root);
      expect(identity.commit).toBe(git("rev-parse", "HEAD"));
      expect(identity.dirty).toBe(false);
      await writeFile(path.join(root, "local-note"), "changed");
      expect(readPersonalBuildIdentity(root)).toMatchObject({
        commit: identity.commit,
        dirty: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "darwin")(
    "stamps only personal keys into a real temporary Info.plist",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "codexhost-personal-plist-"));
      const info = path.join(root, "Info.plist");
      const metadata = path.join(root, "personal-build.json");
      try {
        await writeFile(
          info,
          '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>0.16.1</string><key>CFBundleShortVersionString</key><string>0.16.1</string></dict></plist>',
        );
        const identity = personalBuildIdentity("0.16.1", commit);
        await writeFile(metadata, JSON.stringify({ ...identity, displayVersion: "forged" }));
        const before = await readFile(info, "utf8");
        expect(() => stampPersonalBuildPlist(info, metadata)).toThrow("inconsistent");
        expect(await readFile(info, "utf8")).toBe(before);
        await writeFile(metadata, JSON.stringify(identity));
        stampPersonalBuildPlist(info, metadata);
        const values = JSON.parse(
          execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", info], {
            encoding: "utf8",
          }),
        );
        expect(values).toEqual({
          CFBundleVersion: "0.16.1",
          CFBundleShortVersionString: "0.16.1",
          CodexHostPersonalBuild: true,
          CodexHostBuildIdentity: identity.displayVersion,
          CodexHostSourceCommit: commit,
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
