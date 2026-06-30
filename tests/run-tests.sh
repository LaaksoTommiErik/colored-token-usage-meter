#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

failures=0

fail() {
  printf 'not ok - %s\n' "$1" >&2
  failures=$((failures + 1))
}

pass() {
  printf 'ok - %s\n' "$1"
}

run_test() {
  local name="$1"
  shift
  if "$@"; then
    pass "$name"
  else
    fail "$name"
  fi
}

require_node() {
  command -v node >/dev/null 2>&1 || {
    printf 'Node.js is required for tests.\n' >&2
    exit 1
  }
}

assert_node() {
  local code="$1"
  shift
  node -e "$code" "$@"
}

install_into() {
  local home_dir="$1"
  HOME="$home_dir" "$repo_dir/install.sh" >/dev/null
}

write_json() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
  cat >"$file"
}

status_output() {
  local home_dir="$1"
  local sessions_file="$2"
  OPENCLAW_SESSIONS_PATH="$sessions_file" HOME="$home_dir" "$home_dir/scripts/openclaw-session-tokens-status"
}

raw_output() {
  local sessions_file="$1"
  shift
  OPENCLAW_SESSIONS_PATH="$sessions_file" "$repo_dir/bin/openclaw-session-tokens-prompt.js" "$@"
}

setup_home() {
  local name="$1"
  local home_dir="$tmp_root/$name"
  mkdir -p "$home_dir"
  printf '%s\n' "$home_dir"
}

static_checks() {
  bash -n "$repo_dir/install.sh"
  bash -n "$repo_dir/bin/openclaw-session-tokens-status"
  bash -n "$repo_dir/hooks/openclaw-session-start.sh"
  node --check "$repo_dir/install-hooks.mjs" >/dev/null
  node --check "$repo_dir/bin/openclaw-session-tokens-prompt.js" >/dev/null
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck "$repo_dir/install.sh" \
      "$repo_dir/bin/openclaw-session-tokens-status" \
      "$repo_dir/hooks/openclaw-session-start.sh"
  else
    printf 'skip - shellcheck not installed\n'
  fi
}

fresh_install() {
  local home_dir
  home_dir="$(setup_home fresh)"
  install_into "$home_dir"
  test -x "$home_dir/scripts/openclaw-session-tokens-prompt.js"
  test -x "$home_dir/scripts/openclaw-session-tokens-status"
  test -x "$home_dir/.codex/hooks/openclaw-session-start.sh"
  assert_node '
    const fs = require("fs")
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const session = config.hooks.SessionStart || []
    const prompt = config.hooks.UserPromptSubmit || []
    const hasSession = session.some((group) => (group.hooks || []).some((hook) => hook.command.endsWith("/.codex/hooks/openclaw-session-start.sh")))
    const hasPrompt = prompt.some((group) => (group.hooks || []).some((hook) => hook.command.endsWith("/scripts/openclaw-session-tokens-status")))
    if (!hasSession || !hasPrompt) process.exit(1)
  ' "$home_dir/.codex/hooks.json"
}

preserves_unrelated_events() {
  local home_dir
  home_dir="$(setup_home unrelated-events)"
  write_json "$home_dir/.codex/hooks.json" <<'JSON'
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "/tmp/stop-hook", "timeout": 1 }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "/tmp/pre-tool", "timeout": 1 }
        ]
      }
    ]
  }
}
JSON
  install_into "$home_dir"
  assert_node '
    const fs = require("fs")
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    if (config.hooks.Stop?.[0]?.hooks?.[0]?.command !== "/tmp/stop-hook") process.exit(1)
    if (config.hooks.PreToolUse?.[0]?.hooks?.[0]?.command !== "/tmp/pre-tool") process.exit(1)
  ' "$home_dir/.codex/hooks.json"
}

preserves_sibling_handler() {
  local home_dir
  home_dir="$(setup_home sibling-handler)"
  mkdir -p "$home_dir/.codex"
  HOME="$home_dir" node - <<'NODE' >"$home_dir/.codex/hooks.json"
const path = require('path')
const home = process.env.HOME
console.log(JSON.stringify({
  hooks: {
    UserPromptSubmit: [
      {
        hooks: [
          { type: 'command', command: path.join(home, 'scripts/openclaw-session-tokens-status'), timeout: 1, statusMessage: 'old' },
          { type: 'command', command: '/tmp/sibling', timeout: 2, statusMessage: 'keep me' }
        ]
      }
    ]
  }
}, null, 2))
NODE
  install_into "$home_dir"
  assert_node '
    const fs = require("fs")
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const handlers = config.hooks.UserPromptSubmit[0].hooks
    if (!handlers.some((hook) => hook.command === "/tmp/sibling")) process.exit(1)
    const meters = handlers.filter((hook) => hook.command.endsWith("/scripts/openclaw-session-tokens-status"))
    if (meters.length !== 1 || meters[0].timeout !== 10 || meters[0].statusMessage !== "Loading OpenClaw session token status") process.exit(1)
  ' "$home_dir/.codex/hooks.json"
}

idempotent_reinstall() {
  local home_dir
  home_dir="$(setup_home reinstall)"
  install_into "$home_dir"
  install_into "$home_dir"
  assert_node '
    const fs = require("fs")
    const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const count = (event, suffix) => (config.hooks[event] || []).flatMap((group) => group.hooks || []).filter((hook) => hook.command.endsWith(suffix)).length
    if (count("SessionStart", "/.codex/hooks/openclaw-session-start.sh") !== 1) process.exit(1)
    if (count("UserPromptSubmit", "/scripts/openclaw-session-tokens-status") !== 1) process.exit(1)
  ' "$home_dir/.codex/hooks.json"
}

invalid_json_fails() {
  local home_dir output status
  home_dir="$(setup_home invalid-json)"
  mkdir -p "$home_dir/.codex"
  printf '{ invalid json\n' >"$home_dir/.codex/hooks.json"
  set +e
  output="$(HOME="$home_dir" "$repo_dir/install.sh" 2>&1 >/dev/null)"
  status=$?
  set -e
  [[ "$status" -ne 0 ]]
  [[ "$output" == *"SyntaxError"* || "$output" == *"JSON"* ]]
  [[ ! -e "$home_dir/scripts/openclaw-session-tokens-status" ]]
}

home_with_spaces() {
  local home_dir
  home_dir="$(setup_home 'home with spaces')"
  install_into "$home_dir"
  test -x "$home_dir/scripts/openclaw-session-tokens-status"
  assert_node '
    const fs = require("fs")
    JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  ' "$home_dir/.codex/hooks.json"
}

missing_node_fails() {
  local home_dir fake_path output status cmd
  home_dir="$(setup_home missing-node)"
  fake_path="$tmp_root/fake-path"
  mkdir -p "$fake_path"
  for cmd in bash cat cd chmod cp dirname env install mkdir mktemp rm sed sh test; do
    if command -v "$cmd" >/dev/null 2>&1; then
      ln -s "$(command -v "$cmd")" "$fake_path/$cmd" 2>/dev/null || true
    fi
  done
  set +e
  output="$(PATH="$fake_path" HOME="$home_dir" /usr/bin/env bash "$repo_dir/install.sh" 2>&1 >/dev/null)"
  status=$?
  set -e
  [[ "$status" -ne 0 ]]
  [[ "$output" == *"Node.js is required"* ]]
  [[ ! -e "$home_dir/scripts/openclaw-session-tokens-status" ]]
}

make_sessions() {
  local file="$1" total="$2" context="${3:-272000}" fresh="${4:-true}"
  write_json "$file" <<JSON
{
  "agent:main:main": {
    "totalTokens": $total,
    "contextTokens": $context,
    "totalTokensFresh": $fresh,
    "updatedAt": 100
  }
}
JSON
}

runtime_no_output_for_missing_or_bad_data() {
  local home_dir sessions out
  home_dir="$(setup_home runtime-empty)"
  install_into "$home_dir"
  sessions="$tmp_root/missing.json"
  out="$(status_output "$home_dir" "$sessions")"
  [[ -z "$out" ]]
  printf '{bad\n' >"$tmp_root/bad.json"
  out="$(status_output "$home_dir" "$tmp_root/bad.json")"
  [[ -z "$out" ]]
}

runtime_core_cases() {
  local sessions out
  sessions="$tmp_root/core-sessions.json"
  make_sessions "$sessions" 68000
  out="$(raw_output "$sessions")"
  [[ "$out" == $'32\tOC 68k/272k 25% [######----]' ]]

  make_sessions "$sessions" 0
  [[ "$(raw_output "$sessions")" == $'32\tOC 0/272k 0% [----------]' ]]

  make_sessions "$sessions" 10000
  [[ "$(raw_output "$sessions")" == $'32\tOC 10k/272k 4% [#---------]' ]]

  make_sessions "$sessions" 89999
  [[ "$(raw_output "$sessions")" == $'32\tOC 90k/272k 33% [########--]' ]]

  make_sessions "$sessions" 90000
  [[ "$(raw_output "$sessions")" == $'33\tOC 90k/272k 33% [#########-]' ]]

  make_sessions "$sessions" 99999
  [[ "$(raw_output "$sessions")" == $'33\tOC 100k/272k 37% [#########-]' ]]

  make_sessions "$sessions" 100000
  [[ "$(raw_output "$sessions")" == $'91\tOC 100k [##########] >= 100k new session' ]]
}

runtime_fallbacks_and_env() {
  local sessions out
  sessions="$tmp_root/fallback-sessions.json"
  write_json "$sessions" <<'JSON'
{
  "older": { "totalTokens": 10000, "contextTokens": 272000, "updatedAt": 1 },
  "newer": { "totalTokens": 95000, "contextTokens": 272000, "totalTokensFresh": false, "updatedAt": 2 }
}
JSON
  out="$(OPENCLAW_PROMPT_SESSION_KEY=missing OPENCLAW_SESSIONS_PATH="$sessions" "$repo_dir/bin/openclaw-session-tokens-prompt.js")"
  [[ "$out" == $'33\tOC ~95k/272k 35% [#########-]' ]]

  write_json "$sessions" <<'JSON'
{
  "custom": { "totalTokens": 50000, "updatedAt": 1 }
}
JSON
  out="$(OPENCLAW_PROMPT_SESSION_KEY=custom OPENCLAW_PROMPT_CONTEXT_FALLBACK=200000 OPENCLAW_SESSIONS_PATH="$sessions" "$repo_dir/bin/openclaw-session-tokens-prompt.js")"
  [[ "$out" == $'32\tOC 50k/200k 25% [#####-----]' ]]

  out="$(OPENCLAW_PROMPT_SESSION_KEY=custom OPENCLAW_PROMPT_SOFT_LIMIT=50000 OPENCLAW_SESSIONS_PATH="$sessions" "$repo_dir/bin/openclaw-session-tokens-prompt.js")"
  [[ "$out" == $'32\tOC 50k [#####-----] >= 50k new session' ]]

  write_json "$sessions" <<'JSON'
{
  "agent:main:main": { "totalTokens": 1250000, "contextTokens": 2000000, "updatedAt": 1 }
}
JSON
  out="$(OPENCLAW_SESSIONS_PATH="$sessions" "$repo_dir/bin/openclaw-session-tokens-prompt.js")"
  [[ "$out" == $'91\tOC 1.25M [##########] >= 100k new session' ]]
}

ansi_sequences() {
  local home_dir sessions bytes
  home_dir="$(setup_home ansi)"
  install_into "$home_dir"
  sessions="$tmp_root/ansi-sessions.json"

  make_sessions "$sessions" 68000
  bytes="$(status_output "$home_dir" "$sessions" | od -An -tx1 | tr -d ' \n')"
  [[ "$bytes" == 1b5b313b33326d*1b5b306d0a ]]

  make_sessions "$sessions" 95000
  bytes="$(status_output "$home_dir" "$sessions" | od -An -tx1 | tr -d ' \n')"
  [[ "$bytes" == 1b5b33383b353b3230386d*1b5b306d0a ]]

  make_sessions "$sessions" 100000
  bytes="$(status_output "$home_dir" "$sessions" | od -An -tx1 | tr -d ' \n')"
  [[ "$bytes" == 1b5b313b39316d*1b5b306d0a ]]
}

require_node
run_test 'static checks' static_checks
run_test 'fresh isolated HOME install' fresh_install
run_test 'preserves unrelated hook events' preserves_unrelated_events
run_test 'preserves sibling handlers in same matcher group' preserves_sibling_handler
run_test 'reinstall is idempotent' idempotent_reinstall
run_test 'invalid hooks.json fails before copying files' invalid_json_fails
run_test 'HOME path containing spaces works' home_with_spaces
run_test 'missing Node.js fails clearly before copying files' missing_node_fails
run_test 'missing and malformed session data are silent' runtime_no_output_for_missing_or_bad_data
run_test 'runtime token boundaries and labels' runtime_core_cases
run_test 'runtime fallbacks and environment overrides' runtime_fallbacks_and_env
run_test 'green orange red ANSI wrappers reset correctly' ansi_sequences

if [[ "$failures" -ne 0 ]]; then
  printf '%s test(s) failed.\n' "$failures" >&2
  exit 1
fi

printf 'All tests passed.\n'
