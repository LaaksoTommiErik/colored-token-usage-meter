# Colored Token Usage Meter

A small Codex CLI/OpenClaw hook package that prints a colored token usage meter on session start and after each submitted prompt.

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

The installer copies scripts into:

- `~/scripts/openclaw-session-tokens-prompt.js`
- `~/scripts/openclaw-session-tokens-status`
- `~/.codex/hooks/openclaw-session-start.sh`

It then merges these hook entries into `~/.codex/hooks.json`:

- `SessionStart` for startup and resume
- `UserPromptSubmit` after each submitted prompt

Existing unrelated hooks are preserved.

## Configuration

Environment variables:

- `OPENCLAW_PROMPT_SESSION_KEY`, default `agent:main:main`
- `OPENCLAW_PROMPT_SOFT_LIMIT`, default `100000`
- `OPENCLAW_PROMPT_CONTEXT_FALLBACK`, default `272000`
- `OPENCLAW_SESSIONS_PATH`, default `~/.openclaw/agents/main/sessions/sessions.json`

## Test

Run the status hook directly:

```bash
~/scripts/openclaw-session-tokens-status
```

To inspect ANSI color bytes:

```bash
~/scripts/openclaw-session-tokens-status | od -An -tx1 -c
```
