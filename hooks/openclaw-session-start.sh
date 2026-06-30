#!/usr/bin/env bash
set -euo pipefail

prompt_script="$HOME/scripts/openclaw-session-tokens-prompt.js"
log_file="$HOME/.codex/openclaw-session-start.log"

mkdir -p "$(dirname "$log_file")"

if [[ ! -x "$prompt_script" ]]; then
  printf '%s openclaw token prompt script not found: %s\n' "$(date -Is)" "$prompt_script" >>"$log_file"
  exit 0
fi

raw="$($prompt_script 2>/dev/null || true)"
if [[ -z "$raw" ]]; then
  printf '%s openclaw token status unavailable\n' "$(date -Is)" >>"$log_file"
  exit 0
fi

color="${raw%%$'\t'*}"
text="${raw#*$'\t'}"

if [[ "$color" == "$raw" ]]; then
  color=""
fi

printf '%s %s\n' "$(date -Is)" "$text" >>"$log_file"

case "$color" in
  32) sgr="1;32" ;;
  33) sgr="38;5;208" ;;
  91) sgr="1;91" ;;
  *) sgr="" ;;
esac

if [[ -n "$sgr" ]]; then
  printf '\033[%sm%s\033[0m\n' "$sgr" "$text"
else
  printf '%s\n' "$text"
fi
