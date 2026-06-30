#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$repo_dir/install.sh"
bash -n "$repo_dir/bin/openclaw-session-tokens-status"
bash -n "$repo_dir/hooks/openclaw-session-start.sh"

node --check "$repo_dir/install-hooks.mjs" >/dev/null
node --check "$repo_dir/bin/openclaw-session-tokens-prompt.js" >/dev/null
node --check "$repo_dir/tests/installer.test.mjs" >/dev/null
node --check "$repo_dir/tests/runtime.test.mjs" >/dev/null

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "$repo_dir/install.sh" \
    "$repo_dir/bin/openclaw-session-tokens-status" \
    "$repo_dir/hooks/openclaw-session-start.sh" \
    "$repo_dir/tests/run-tests.sh"
else
  printf 'skip - shellcheck not installed\n'
fi

node --test "$repo_dir/tests"/*.test.mjs
