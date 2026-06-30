#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hooks_json="$HOME/.codex/hooks.json"

if ! command -v node >/dev/null 2>&1; then
  printf 'Error: Node.js is required to install colored-token-usage-meter.\n' >&2
  exit 1
fi

if [[ -f "$hooks_json" ]]; then
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$hooks_json" >/dev/null
fi

mkdir -p "$HOME/scripts" "$HOME/.codex/hooks"
install -m 755 "$repo_dir/bin/openclaw-session-tokens-prompt.js" "$HOME/scripts/openclaw-session-tokens-prompt.js"
install -m 755 "$repo_dir/bin/openclaw-session-tokens-status" "$HOME/scripts/openclaw-session-tokens-status"
install -m 755 "$repo_dir/hooks/openclaw-session-start.sh" "$HOME/.codex/hooks/openclaw-session-start.sh"
node "$repo_dir/install-hooks.mjs"

printf 'Installed colored token usage meter hooks. Restart Codex or submit a prompt to see the meter.\n'
