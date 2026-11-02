#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
if [ -f tools/sidechat-installed-contract.test.mjs ]; then
  export CODEXHOST_SIDECHAT_ASAR="${CODEXHOST_SIDECHAT_ASAR:-/Applications/ChatGPT.app/Contents/Resources/app.asar}"
  [ -r "$CODEXHOST_SIDECHAT_ASAR" ] || {
    echo "Installed Desktop audit requires CODEXHOST_SIDECHAT_ASAR" >&2
    exit 1
  }
fi
tests=()
while IFS= read -r -d '' file; do
  tests+=("$file")
done < <(git ls-files -z -- \
  'packages/*/test/*side*test.ts' \
  'packages/host-runtime/test/app-server-host.projection-*.test.ts' \
  'packages/host-runtime/test/*recovery*.test.ts' \
  'packages/host-runtime/test/*steer*.test.ts' \
  'packages/host-runtime/test/*inject*.test.ts' \
  'packages/host-runtime/test/external-thread-fork.test.ts' \
  'packages/host-runtime/test/external-thread-list.test.ts' \
  'packages/host-runtime/test/external-thread-idle-release.test.ts' \
  'packages/host-runtime/test/*controlled-updates.test.ts' \
  'packages/harness-broker/test/broker-fork.test.ts' \
  'packages/harness-broker/test/broker-steer-*.test.ts' \
  'packages/adapters/deepseek-harness/test/**/*.test.ts' \
  'packages/adapters/claude-code/test/claude-code-adapter.test.ts' \
  'packages/adapters/claude-code/test/sdk-transport.test.ts' \
  'packages/adapters/claude-code/test/claude-active-fork.test.ts' \
  'packages/adapters/claude-code/test/claude-transcript.test.ts' \
  'packages/protocol-core/test/codex-ui-projector.test.ts' \
  'packages/protocol-core/test/thread-fork.test.ts' \
  'packages/desktop-control/test/renderer-host-rpc-routing.test.ts' \
  'packages/desktop-control/test/renderer-rpc-steering*.test.ts' \
  'packages/renderer-extension/test/renderer-rpc-steering*.test.ts' \
  'packages/renderer-extension/test/*sidechat*.test.ts' \
  'packages/renderer-extension/test/install-renderer-binding-isolation.test.ts' \
  'packages/renderer-extension/test/settings/pages.test.ts' \
  'packages/console-server/test/*updates.test.ts' \
  'packages/update-manager/test/*.test.ts' \
  'tests/release/*.test.mjs' \
  'tools/sidechat-installed-contract.test.mjs' \
  'tools/personal/*.test.mjs')

if [ "${#tests[@]}" -eq 0 ]; then
  echo "No personal patch tests found" >&2
  exit 1
fi
npm exec -- vitest run --config tests/vitest.config.js "${tests[@]}"
