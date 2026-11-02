import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const script = await readFile(new URL("./upgrade-to-official.sh", import.meta.url), "utf8");
const quick = await readFile(new URL("./quick-tests.sh", import.meta.url), "utf8");

async function fixture(conflict = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "personal-upgrade-test-"));
  const root = path.join(directory, "source");
  const bin = path.join(directory, "bin");
  await mkdir(root);
  await mkdir(bin);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.17.0" }));
  await writeFile(path.join(root, "shared.txt"), "base\n");
  git("add", "package.json", "shared.txt");
  git("commit", "-m", "official base");
  git("tag", "v0.17.0");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.18.0" }));
  await writeFile(path.join(root, "shared.txt"), "official update\n");
  git("add", "package.json", "shared.txt");
  git("commit", "-m", "official next");
  git("tag", "v0.18.0");
  git("switch", "-c", "iverson/personal", "v0.17.0");
  for (let number = 1; number <= 5; number++) {
    const name = `patch-${number}.txt`;
    await writeFile(path.join(root, name), `${number}\n`);
    git("add", name);
    if (conflict && number === 1) {
      await writeFile(path.join(root, "shared.txt"), "personal change\n");
      git("add", "shared.txt");
    }
    if (number === 5) {
      await mkdir(path.join(root, "tools/personal"), { recursive: true });
      await writeFile(path.join(root, "tools/personal/upgrade-to-official.sh"), script);
      await writeFile(path.join(root, "tools/personal/quick-tests.sh"), quick);
      await writeFile(path.join(root, "tools/personal/example.test.mjs"), "// fixture\n");
      git(
        "add",
        "tools/personal/upgrade-to-official.sh",
        "tools/personal/quick-tests.sh",
        "tools/personal/example.test.mjs",
      );
    }
    git("commit", "-m", `P${number} fixture`);
  }
  git("remote", "add", "upstream", root);
  const head = git("rev-parse", "HEAD");
  const npm = path.join(bin, "npm");
  await writeFile(
    npm,
    `#!/bin/bash
set -eu
printf '%s|%s|%s\\n' "$HOME" "$*" "\${ANTHROPIC_API_KEY-unset}" >> commands.log
if [ "$1 \${2-}" = 'run release:package' ]; then
  dir=build/release/0.18.0/macos-arm64
  mkdir -p "$dir/codexhost.app/Contents/Resources/app"
  printf dmg > "$dir/codexhost-0.18.0-macos-arm64.dmg"
  printf runtime > "$dir/codexhost.app/Contents/Resources/app/host-runtime.mjs"
fi
`,
  );
  await chmod(npm, 0o755);
  return {
    directory,
    root,
    head,
    git,
    run: (...args) =>
      spawnSync("bash", ["tools/personal/upgrade-to-official.sh", ...args], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          ANTHROPIC_API_KEY: "fixture-only",
          CODEXHOST_SIDECHAT_ASAR: path.join(root, "package.json"),
        },
      }),
  };
}

describe("personal upgrade orchestration", () => {
  // Real Git/worktree subprocesses need a bounded margin while parallel suites build Rust.
  it("rebases only a new worktree, isolates commands and writes candidate hashes", async () => {
    const state = await fixture();
    try {
      const result = state.run("v0.18.0");
      expect(result.status, result.stderr).toBe(0);
      expect(state.git("rev-parse", "iverson/personal")).toBe(state.head);
      expect(state.git("branch", "--show-current")).toBe("iverson/personal");
      expect(state.git("rev-list", "--count", "v0.18.0..iverson/personal-v0.18.0")).toBe("5");
      const output = path.join(state.directory, "codex-host-personal-v0.18.0");
      const commands = (await readFile(path.join(output, "commands.log"), "utf8"))
        .trim()
        .split("\n");
      expect(commands).toHaveLength(7);
      expect(new Set(commands.map((line) => line.split("|")[0])).size).toBe(7);
      expect(commands.every((line) => line.endsWith("|unset"))).toBe(true);
      expect(commands.at(-2)).toContain("exec -- vitest run --config tests/vitest.config.js");
      const short = state.git("rev-parse", "--short=8", "iverson/personal-v0.18.0");
      const dmg = `build/release/0.18.0/macos-arm64/codexhost-0.18.0-personal-${short}-macos-arm64.dmg`;
      expect(await readFile(path.join(output, `${dmg}.sha256`), "utf8")).toMatch(
        /^[0-9a-f]{64}\n$/u,
      );
      expect(result.stdout).toContain("host-runtime.mjs");
    } finally {
      await rm(state.directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("leaves conflicts in the new worktree without building or moving the source", async () => {
    const state = await fixture(true);
    try {
      const result = state.run("v0.18.0");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Rebase stopped");
      expect(result.stderr).toContain("shared.txt");
      expect(state.git("rev-parse", "iverson/personal")).toBe(state.head);
      await expect(
        readFile(path.join(state.directory, "codex-host-personal-v0.18.0/commands.log")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(state.directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("rejects an invalid tag before fetch or branch creation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "personal-upgrade-invalid-"));
    try {
      const scriptPath = path.join(directory, "upgrade-to-official.sh");
      await writeFile(scriptPath, script);
      const result = spawnSync("bash", [scriptPath, "../unsafe"], {
        cwd: directory,
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("expected a release tag");
      expect(result.stderr).not.toContain("not a git repository");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
