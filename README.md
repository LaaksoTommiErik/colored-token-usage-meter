# Colored Token Usage Meter

A small Codex CLI/OpenClaw hook package that prints a colored token usage meter on `SessionStart` and when `UserPromptSubmit` runs before a prompt is sent.

Example output:

```text
OC 68k/272k 25% [######----]
```

Colors:

- Green below the warning threshold, default `90000`
- Orange at or above the warning threshold and below the session threshold
- Red at or above the session threshold, default `100000`

The meter uses one filled block per complete 10,000 tokens, capped at ten filled blocks.

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

Current Codex behavior observed in this environment: plain text written to `UserPromptSubmit` stdout may be displayed by Codex as hook context and added as developer context for the turn. This package deliberately keeps that output short, but it is model-visible context and is not a completely independent status-bar extension.

Automated ANSI tests prove only the bytes emitted by these scripts. They do not prove that the Codex TUI visibly renders those bytes as color.

## Configuration

Environment variables:

- `OPENCLAW_PROMPT_SESSION_KEY`, default `agent:main:main`
- `OPENCLAW_PROMPT_WARNING_LIMIT`, default `90000`
- `OPENCLAW_PROMPT_SOFT_LIMIT`, default `100000`
- `OPENCLAW_PROMPT_CONTEXT_FALLBACK`, default `272000`
- `OPENCLAW_SESSIONS_PATH`, default `~/.openclaw/agents/main/sessions/sessions.json`

Invalid, non-finite, or non-positive threshold and context fallback values are ignored in favor of defaults. Negative or non-numeric token counts normalize to `0`.

## Test Locally

Run the automated test suite:

```bash
tests/run-tests.sh
```

The tests use temporary directories only. They do not read or modify the real user home, `~/.codex`, `~/.openclaw`, Codex authentication, or real OpenClaw sessions.

The suite covers installer safety, exact package-handler merging, idempotence, invalid JSON handling, paths with spaces and quotes, installed permissions, missing dependencies, runtime fixture lookup, a sanitized current-session-shape fixture, numeric validation, threshold boundaries, ANSI bytes, and wrapper failure behavior.

Run the status hook directly after install:

```bash
~/scripts/openclaw-session-tokens-status
```

Inspect ANSI color bytes:

```bash
~/scripts/openclaw-session-tokens-status | od -An -tx1 -c
```

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

Create a controlled 68,000-token fixture:

```bash
mkdir -p ~/.openclaw/agents/main/sessions
cat > ~/.openclaw/agents/main/sessions/sessions.json <<'JSON'
{
  "agent:main:main": {
    "totalTokens": 68000,
    "contextTokens": 272000,
    "totalTokensFresh": true,
    "updatedAt": 100
  }
}
JSON
```

Verify the hook independently:

```bash
~/scripts/openclaw-session-tokens-status
```

Launch Codex:

```bash
codex
```

In Codex:

1. Run `/hooks`.
2. Confirm both installed handlers are listed.
3. Review and trust both handlers.
4. Submit a prompt.
5. Confirm `UserPromptSubmit` runs exactly once for that prompt.
6. Confirm the green meter appears for `68,000` tokens.
7. Exit Codex and start it again; confirm `SessionStart` runs on startup.
8. Resume the same session; confirm `SessionStart` runs on resume.

From another terminal as `codex-hook-test`, switch the fixture to 95,000 tokens:

```bash
python3 - <<'PY'
import json
from pathlib import Path

path = Path.home() / ".openclaw/agents/main/sessions/sessions.json"
data = json.loads(path.read_text())
data["agent:main:main"]["totalTokens"] = 95000
data["agent:main:main"]["updatedAt"] += 1
path.write_text(json.dumps(data, indent=2) + "\n")
PY
```

Submit another prompt. Expected hook context:

```text
OC 95k/272k 35% [#########-]
```

Switch the fixture to 100,000 tokens:

```bash
python3 - <<'PY'
import json
from pathlib import Path

path = Path.home() / ".openclaw/agents/main/sessions/sessions.json"
data = json.loads(path.read_text())
data["agent:main:main"]["totalTokens"] = 100000
data["agent:main:main"]["updatedAt"] += 1
path.write_text(json.dumps(data, indent=2) + "\n")
PY
```

Submit another prompt. Expected hook context:

```text
OC 100k [##########] >= 100k new session
```

Temporarily move the sessions file away and submit one more prompt:

```bash
mv ~/.openclaw/agents/main/sessions/sessions.json ~/.openclaw/agents/main/sessions/sessions.json.bak
```

Expected result: prompt submission is not blocked, no timeout warning appears, and no hook-failure warning appears.

Manual-only assertions:

- `/hooks` trust UI shows both handlers.
- Visible terminal color rendering is green, orange, and red in the actual Codex TUI.
- `SessionStart` is visible on startup and resume.
- `UserPromptSubmit` appears exactly once per submitted prompt.
- No timeout or hook-failure warning appears during the missing-data case.
