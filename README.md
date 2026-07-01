# Colored Token Usage Meter

A small Codex CLI hook package that prints a colored meter from the newest local Codex session JSONL file's native `token_count` events on `SessionStart` and when `UserPromptSubmit` runs before a prompt is sent.

Example output:

```text
Codex session 172k/170k soft cap 101% [##########] ctx in 172k cached 170k out 2k total 174k
```

Colors:

- Green below the warning threshold, default 85% of the soft cap (`144500` with the default soft cap)
- Orange at or above the warning threshold and below the session threshold
- Red at or above the session threshold, default `170000`

The meter uses ten blocks across the active soft cap. The primary numerator is Codex `last_token_usage.input_tokens`; cached input, output, and total tokens are shown as detail fields. The percentage denominator is the lower of the configured soft cap and the `model_context_window` reported in the same Codex `token_count` event.

## Install

```bash
git clone https://github.com/LaaksoTommiErik/colored-token-usage-meter.git
cd colored-token-usage-meter
./install.sh
```

The installer requires `node`, `install`, and `mkdir`. It copies scripts into:

- `~/scripts/openclaw-session-tokens-prompt.js`
- `~/scripts/openclaw-session-tokens-status`
- `~/.codex/hooks/openclaw-session-start.sh`

It then merges these hook entries into `~/.codex/hooks.json`:

- `SessionStart` with matcher `startup|resume`
- `UserPromptSubmit` with no matcher, because Codex ignores matchers for this event

The installer preserves unrelated top-level JSON properties, hook events, matcher groups, and sibling handlers. Re-running it removes duplicate copies of this package's exact handlers and installs one canonical handler for each event.

## Codex Hook Behavior

Verified against Codex CLI `0.142.4` and the current official Codex manual in this environment:

- Hooks are stable and enabled by default. They can be disabled with `[features].hooks = false`.
- Codex discovers hooks in active config-layer files such as `~/.codex/hooks.json`.
- `SessionStart` runs at thread start scope. Its matcher can filter `startup`, `resume`, `clear`, or `compact`.
- `UserPromptSubmit` runs at turn scope before the user prompt is sent. Its matcher is not supported and is ignored.
- Hook `timeout` values are seconds. If omitted, Codex uses `600` seconds.
- Non-managed command hooks must be reviewed and trusted before they run.
- Trust is attached to the exact hook definition hash. Changed hook definitions may need review again.
- Use `/hooks` in the Codex CLI to inspect, review, trust, or disable non-managed hooks.

Current Codex behavior observed in this environment: plain text written to `UserPromptSubmit` stdout may be displayed by Codex as hook context and added as developer context for the turn. This package deliberately keeps that output short, but it is model-visible context and is not a completely independent status-bar extension. Because `UserPromptSubmit` runs before the new prompt is sent, the meter normally reflects the latest completed provider-reported usage already written to the newest local Codex session file. On a brand-new session before Codex has written its first `token_count`, the meter reports token status unavailable instead of falling back to an older session.

Automated ANSI tests prove only the bytes emitted by these scripts. They do not prove that the Codex TUI visibly renders those bytes as color.

## Configuration

Environment variables:

- `OPENCLAW_PROMPT_WARNING_LIMIT`, default 85% of the soft cap (`144500` with the default soft cap)
- `OPENCLAW_PROMPT_SOFT_LIMIT`, default `170000`

Invalid, non-finite, or non-positive threshold values are ignored in favor of defaults. The meter scans `CODEX_HOME/sessions`, or `~/.codex/sessions` when `CODEX_HOME` is unset, and reads only the newest `.jsonl` session file. It does not walk back to older session files when the newest file has no usable `token_count`. Missing token-count events are reported as unavailable. Malformed numeric usage inside a token-count event is treated as zero usage.

## Test Locally

Run the automated test suite:

```bash
tests/run-tests.sh
```

The tests use temporary directories only. They do not read or modify the real user home, real `~/.codex`, `~/.openclaw`, Codex authentication, or live Codex session files.

The suite covers installer safety, exact package-handler merging, idempotence, invalid JSON handling, paths with spaces and quotes, installed permissions, missing dependencies, newest-session selection, unavailable missing-data behavior, Codex `token_count` fixture parsing, threshold boundaries, ANSI bytes, and wrapper failure behavior.

The status hook is intended to run under Codex. It does not require hook JSON on stdin; automated tests cover direct execution with isolated `CODEX_HOME` fixtures and exact ANSI bytes.

## Manual Clean Codex Test

A disposable Linux user is the closest clean Codex CLI test without a VM. Visible color rendering is a manual assertion.

Create and enter a separate user home:

```bash
sudo useradd --create-home --shell /bin/bash codex-hook-test
sudo -iu codex-hook-test
pwd
printf '%s\n' "$HOME"
test "$HOME" = /home/codex-hook-test
```

Verify required tools:

```bash
command -v codex
command -v node
command -v git
command -v bash
command -v install
command -v mkdir
node --version
codex --version
```

Authenticate Codex normally in the test account. Do not copy personal `~/.codex`, auth files, keyrings, or OpenClaw state from another account.

Install:

```bash
git clone https://github.com/LaaksoTommiErik/colored-token-usage-meter.git
cd colored-token-usage-meter
./install.sh
```

Verify installed files and permissions:

```bash
find ~/scripts ~/.codex/hooks -maxdepth 2 -type f -printf '%m %p\n'
node - <<'NODE'
const fs = require('fs')
const path = require('path')
const home = process.env.HOME
const config = JSON.parse(fs.readFileSync(path.join(home, '.codex/hooks.json'), 'utf8'))
const session = config.hooks.SessionStart.flatMap((group) => group.hooks || [])
const prompt = config.hooks.UserPromptSubmit.flatMap((group) => group.hooks || [])
console.log(session.filter((hook) => hook.command.includes('openclaw-session-start.sh')).length)
console.log(prompt.filter((hook) => hook.command.includes('openclaw-session-tokens-status')).length)
NODE
```

Both printed counts should be `1`.

The automated tests cover controlled Codex token fixtures and isolated `CODEX_HOME` session fixtures. For a manual live check, launch Codex:

```bash
codex
```

In Codex:

1. Run `/hooks`.
2. Confirm both installed handlers are listed.
3. Review and trust both handlers.
4. Submit a prompt.
5. Confirm `UserPromptSubmit` runs exactly once for that prompt.
6. Confirm the meter starts with `Codex session` and matches the latest valid Codex-native `token_count` event in the newest local Codex session file.
7. Exit Codex and start it again; confirm `SessionStart` runs on startup.
8. Resume the same session; confirm `SessionStart` runs on resume.

Expected hook context should look like this, with values depending on the current Codex session:

```text
Codex session 172k/170k soft cap 101% [##########] ctx in 172k cached 170k out 2k total 174k >= 170k new session
```

The meter reads only the newest local Codex session file. To test missing-data behavior, use a new or empty session and confirm the hook reports token status unavailable rather than an older session's usage.

Manual-only assertions:

- `/hooks` trust UI shows both handlers.
- Visible terminal color rendering is green, orange, and red in the actual Codex TUI.
- `SessionStart` is visible on startup and resume.
- `UserPromptSubmit` appears exactly once per submitted prompt.
- No timeout or hook-failure warning appears during the missing-data case.
