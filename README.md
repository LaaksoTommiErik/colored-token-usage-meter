# Colored Token Usage Meter

A small Codex CLI/OpenClaw hook package that prints a colored token usage meter on session start and when a prompt is submitted.

Example output:

```text
OC 68k/272k 25% [######----]
```

Colors:

- Green below 90k tokens
- Orange from 90k tokens
- Red from 100k tokens

## Install

```bash
git clone https://github.com/LaaksoTommiErik/colored-token-usage-meter.git
cd colored-token-usage-meter
./install.sh
```

The installer requires Node.js. It copies scripts into:

- `~/scripts/openclaw-session-tokens-prompt.js`
- `~/scripts/openclaw-session-tokens-status`
- `~/.codex/hooks/openclaw-session-start.sh`

It then merges these hook entries into `~/.codex/hooks.json`:

- `SessionStart` for startup and resume
- `UserPromptSubmit` when each prompt is submitted, before it is sent

Existing unrelated hook events, matcher groups, and sibling handlers are preserved. Re-running the installer updates this package's hook handlers without creating duplicates.

## Trust Hooks

Codex may require newly installed hooks to be reviewed before they run. After installing, start Codex and run:

```text
/hooks
```

Review and trust the installed commands. If a hook command changes later, Codex may require it to be reviewed again.

`UserPromptSubmit` output is added to the prompt as hook context. In Codex, it can appear as hook context similar to:

```text
UserPromptSubmit hook (completed)
hook context: OC 68k/272k 25% [######----]
```

## Configuration

Environment variables:

- `OPENCLAW_PROMPT_SESSION_KEY`, default `agent:main:main`
- `OPENCLAW_PROMPT_SOFT_LIMIT`, default `100000`
- `OPENCLAW_PROMPT_CONTEXT_FALLBACK`, default `272000`
- `OPENCLAW_SESSIONS_PATH`, default `~/.openclaw/agents/main/sessions/sessions.json`

## Test Locally

Run the automated test suite:

```bash
tests/run-tests.sh
```

The tests use temporary directories only. They do not read or modify the real user home, Codex configuration, or OpenClaw session data.

The suite covers installer merging, idempotence, invalid JSON handling, homes with spaces, missing Node.js handling, runtime session fixtures, token thresholds, and ANSI color bytes.

Run the status hook directly after install:

```bash
~/scripts/openclaw-session-tokens-status
```

Inspect ANSI color bytes:

```bash
~/scripts/openclaw-session-tokens-status | od -An -tx1 -c
```

## Manual Clean-User Test

A disposable Linux user is the closest clean Codex CLI test without a VM.

```bash
sudo useradd --create-home --shell /bin/bash codex-hook-test
sudo -iu codex-hook-test
```

Inside the test account, verify prerequisites and sign in to Codex normally:

```bash
command -v node
command -v git
command -v codex
node --version
codex --version
```

Install the package:

```bash
git clone https://github.com/LaaksoTommiErik/colored-token-usage-meter.git
cd colored-token-usage-meter
./install.sh
```

Create controlled OpenClaw token data:

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

Verify the status hook independently:

```bash
~/scripts/openclaw-session-tokens-status
```

Launch Codex:

```bash
codex
```

Run `/hooks`, review and trust both installed commands, then submit a prompt. Expected hook context:

```text
OC 68k/272k 25% [######----]
```

While Codex remains open, update the fixture from another terminal as the test user:

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

Repeat with `100000` tokens. Expected red hook context:

```text
OC 100k [##########] >= 100k new session
```
