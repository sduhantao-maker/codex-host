#!/usr/bin/env bash
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }
[ "$#" -eq 1 ] || die "usage: tools/personal/upgrade-to-official.sh <new-tag>"
tag="$1"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || die "expected a release tag such as v0.18.0"
root="$(git rev-parse --show-toplevel)"
[ "$root" != /Users/iverson ] || die "refusing the home-directory repository"
cd "$root"
source_branch="$(git symbolic-ref --short HEAD)"
[[ "$source_branch" == iverson/personal || "$source_branch" == iverson/personal-v* ]] || die "start from a personal patch branch"
[ -z "$(git status --porcelain)" ] || die "commit or preserve local changes before upgrading"
base="$(git describe --tags --match 'v[0-9]*' --abbrev=0 HEAD)"
source_commit="$(git rev-parse HEAD)"
patches="$(git rev-list --count "$base..$source_commit")"
[ "$patches" -ge 1 ] && [ "$patches" -le 6 ] || die "expected one to six remaining personal patches after $base"
[[ "$(git log -1 --format=%s)" == P5:* || "$(git log -1 --format=%s)" == P6:* ]] || die "P5 or P6 must be the final patch"

node_bin="$(command -v node || true)"
if [ -z "$node_bin" ] || [[ "$("$node_bin" --version)" != v24.* ]]; then
  node_bin=/Applications/codexhost.app/Contents/Resources/runtime/node
fi
[ -x "$node_bin" ] && [[ "$("$node_bin" --version)" == v24.* ]] || die "Node 24 is required"
tool_root="$root/.codexhost"
if [ ! -d "$tool_root/toolchain/cargo" ]; then
  tool_root="$(dirname "$root")/codex-host-personal/.codexhost"
fi
cache="${npm_config_cache:-${HOME}/.npm}"
cargo_home="${CARGO_HOME:-${HOME}/.cargo}"
rustup_home="${RUSTUP_HOME:-${HOME}/.rustup}"
[ ! -d "$tool_root/toolchain/cargo" ] || cargo_home="$tool_root/toolchain/cargo"
[ ! -d "$tool_root/toolchain/rustup" ] || rustup_home="$tool_root/toolchain/rustup"
build_path="$(dirname "$node_bin"):$tool_root/tools/bin:$cargo_home/bin:$PATH"
browser="${CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH:-}"
asar="${CODEXHOST_SIDECHAT_ASAR:-/Applications/ChatGPT.app/Contents/Resources/app.asar}"
[ -r "$asar" ] || die "installed Desktop audit requires CODEXHOST_SIDECHAT_ASAR"
isolated() {
  local temp_home result
  temp_home="$(mktemp -d "${TMPDIR:-/tmp}/codexhost-personal-home.XXXXXX")"
  result=0
  env -i PATH="$build_path" HOME="$temp_home" USERPROFILE="$temp_home" \
    XDG_CONFIG_HOME="$temp_home/.config" XDG_CACHE_HOME="$temp_home/.cache" \
    TMPDIR="${TMPDIR:-/tmp}" CARGO_HOME="$cargo_home" RUSTUP_HOME="$rustup_home" \
    npm_config_cache="$cache" \
    PLAYWRIGHT_BROWSERS_PATH=/Users/iverson/Library/Caches/ms-playwright \
    CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH="$browser" CODEXHOST_SIDECHAT_ASAR="$asar" "$@" || result=$?
  rm -rf "$temp_home"
  return "$result"
}

# Git keeps the caller's credentials; all build/test processes use fresh homes.
git fetch upstream --tags
git rev-parse --verify "refs/tags/$tag^{commit}" >/dev/null
[ "$tag" != "$base" ] || die "already based on $tag"
git merge-base --is-ancestor "$base" "$tag" || die "target tag must descend from $base"
overlap="$(mktemp "${TMPDIR:-/tmp}/codexhost-personal-overlap.XXXXXX")"
trap 'rm -f "$overlap"' EXIT
comm -12 <(git diff --name-only "$base" "$tag" | LC_ALL=C sort) \
  <(git diff --name-only "$base" "$source_commit" | LC_ALL=C sort) > "$overlap"
echo "Official $base -> $tag changes overlapping P1-P6:"
cat "$overlap"
if [ -s "$overlap" ]; then
  paths=()
  while IFS= read -r file; do paths+=("$file"); done < "$overlap"
  git log --format='%h %s' "$base..$tag" -- "${paths[@]}"
fi
echo "Compare these changes against docs/personal/requirements.md; remove a patch only after verifying official equivalence."

branch="iverson/personal-$tag"
worktree="$(dirname "$root")/codex-host-personal-$tag"
! git show-ref --verify --quiet "refs/heads/$branch" || die "branch already exists: $branch"
[ ! -e "$worktree" ] || die "worktree path already exists: $worktree"
git worktree add -b "$branch" "$worktree" "$source_commit"
cd "$worktree"
if ! git rebase --onto "$tag" "$base"; then
  echo "Rebase stopped. Conflict files (resolve in $worktree):" >&2
  git diff --name-only --diff-filter=U >&2
  exit 1
fi
[ "$(git -C "$root" rev-parse "$source_branch")" = "$source_commit" ] || die "source branch changed during upgrade"

isolated npm ci
isolated npm run format:check
isolated npm run typecheck
isolated npm run lint
isolated npm run build
isolated bash tools/personal/quick-tests.sh
isolated npm run release:package -- --target macos-arm64

version="$("$node_bin" -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')"
short="$(git rev-parse --short=8 HEAD)"
release="build/release/$version/macos-arm64"
original="$release/codexhost-$version-macos-arm64.dmg"
dmg="$release/codexhost-$version-personal-$short-macos-arm64.dmg"
[ -s "$original" ] || die "missing packaged DMG: $original"
[ ! -e "$dmg" ] || die "candidate already exists: $dmg"
cp "$original" "$dmg"
runtime="$release/codexhost.app/Contents/Resources/app/host-runtime.mjs"
[ -s "$runtime" ] || die "missing packaged runtime: $runtime"
dmg_hash="$(shasum -a 256 "$dmg" | awk '{print $1}')"
printf '%s\n' "$dmg_hash" > "$dmg.sha256"
echo "$dmg_hash  $dmg"
shasum -a 256 "$runtime"
echo "DMG: $worktree/$dmg"
echo "Candidate built only; no install, tag, release, push, or application restart performed."
