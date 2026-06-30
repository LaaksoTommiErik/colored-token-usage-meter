import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'

const repoDir = path.resolve(import.meta.dirname, '..')
const promptScript = path.join(repoDir, 'bin/openclaw-session-tokens-prompt.js')
const statusWrapper = path.join(repoDir, 'bin/openclaw-session-tokens-status')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ctum-runtime-${name}-`))
}

function tokenEvent(record) {
  const info = record.info || {
    total_token_usage: record.total_token_usage || {
      input_tokens: 1000000,
      cached_input_tokens: 900000,
      output_tokens: 10000,
      reasoning_output_tokens: 1000,
      total_tokens: 1010000,
    },
    last_token_usage: {
      input_tokens: record.input_tokens,
      cached_input_tokens: record.cached_input_tokens ?? 0,
      output_tokens: record.output_tokens ?? 0,
      reasoning_output_tokens: record.reasoning_output_tokens ?? 0,
      total_tokens: record.total_tokens ?? record.input_tokens,
    },
    model_context_window: record.model_context_window ?? 258400,
  }

  return {
    timestamp: record.timestamp || '2026-06-30T00:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info,
      ...(record.rate_limits ? { rate_limits: record.rate_limits } : {}),
    },
  }
}

function writeCodexSession(root, records) {
  const codexHome = path.join(root, 'codex-home')
  const sessionDir = path.join(codexHome, 'sessions/2026/06/30')
  fs.mkdirSync(sessionDir, { recursive: true })
  const file = path.join(sessionDir, `${records.name || 'session'}.jsonl`)
  const events = records.events || [records]
  const lines = events.map((record) => JSON.stringify(record.raw || tokenEvent(record)))
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
  return { codexHome, transcriptPath: file }
}

function hookInput(transcriptPath, overrides = {}) {
  return JSON.stringify({
    session_id: 'test-session',
    transcript_path: transcriptPath,
    cwd: repoDir,
    hook_event_name: 'UserPromptSubmit',
    turn_id: 'test-turn',
    ...overrides,
  })
}

function runPrompt(input, env = {}) {
  return spawnSync(promptScript, [], {
    env: { ...process.env, ...env },
    input,
    encoding: 'utf8',
  })
}

function promptOutput(input, env = {}) {
  const result = runPrompt(input, env)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trimEnd()
}

function installWrapperHome(root) {
  const home = path.join(root, 'home')
  fs.mkdirSync(path.join(home, 'scripts'), { recursive: true })
  fs.copyFileSync(promptScript, path.join(home, 'scripts/openclaw-session-tokens-prompt.js'))
  fs.copyFileSync(statusWrapper, path.join(home, 'scripts/openclaw-session-tokens-status'))
  fs.chmodSync(path.join(home, 'scripts/openclaw-session-tokens-prompt.js'), 0o755)
  fs.chmodSync(path.join(home, 'scripts/openclaw-session-tokens-status'), 0o755)
  return home
}

function runInstalledStatus(home, input) {
  return spawnSync(path.join(home, 'scripts/openclaw-session-tokens-status'), [], {
    env: { ...process.env, HOME: home },
    input,
  })
}

function hex(buffer) {
  return buffer.toString('hex')
}

test('missing hook input produces no output and exit code zero', () => {
  const result = runPrompt('')
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})

test('hook input without transcript_path produces no output', () => {
  assert.equal(promptOutput(JSON.stringify({ hook_event_name: 'UserPromptSubmit' })), '')
  assert.equal(promptOutput(JSON.stringify({ transcript_path: null })), '')
})

test('missing transcript produces no output and exit code zero', () => {
  const result = runPrompt(hookInput(path.join(tmpDir('missing'), 'missing.jsonl')))
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})

test('malformed Codex session lines are ignored', () => {
  const root = tmpDir('malformed')
  const file = path.join(root, 'session.jsonl')
  fs.writeFileSync(file, '{bad\\n')
  assert.equal(promptOutput(hookInput(file)), '')
})

test('parses a sanitized real Codex token_count record shape', () => {
  const root = tmpDir('real-shape')
  const rateLimits = {
    limit_id: 'codex',
    limit_name: null,
    primary: { used_percent: 68.0, window_minutes: 300, resets_at: 1782845811 },
    secondary: { used_percent: 21.0, window_minutes: 10080, resets_at: 1783414597 },
    credits: null,
    individual_limit: null,
    plan_type: 'plus',
    rate_limit_reached_type: null,
  }
  const { transcriptPath } = writeCodexSession(root, {
    timestamp: '2026-06-30T15:28:10.444Z',
    input_tokens: 193911,
    cached_input_tokens: 191872,
    output_tokens: 589,
    reasoning_output_tokens: 71,
    total_tokens: 194500,
    model_context_window: 258400,
    total_token_usage: {
      input_tokens: 8668251,
      cached_input_tokens: 8230016,
      output_tokens: 62546,
      reasoning_output_tokens: 9363,
      total_tokens: 8730797,
    },
    rate_limits: rateLimits,
  })

  assert.equal(promptOutput(hookInput(transcriptPath)), '91	CX 193k/258k 75% [##########] in 193k cached 191k out 589 total 194k >= 100k new session')
})

test('uses transcript_path instead of the newest modified session file', () => {
  const root = tmpDir('active-session')
  const active = writeCodexSession(root, { name: 'active', input_tokens: 30000, model_context_window: 258400 })
  const newer = writeCodexSession(root, { name: 'newer', input_tokens: 170000, model_context_window: 258400 })
  fs.utimesSync(active.transcriptPath, new Date('2026-06-30T00:00:00Z'), new Date('2026-06-30T00:00:00Z'))
  fs.utimesSync(newer.transcriptPath, new Date('2026-06-30T00:01:00Z'), new Date('2026-06-30T00:01:00Z'))

  assert.equal(promptOutput(hookInput(active.transcriptPath)), '32	CX 30k/258k 12% [###-------] in 30k cached 0 out 0 total 30k')
})

test('empty active transcript does not fall back to another session', () => {
  const root = tmpDir('empty-active')
  const active = path.join(root, 'active.jsonl')
  fs.writeFileSync(active, '')
  writeCodexSession(root, { name: 'other', input_tokens: 170000, model_context_window: 258400 })

  assert.equal(promptOutput(hookInput(active)), '')
})

test('latest malformed token_count is skipped in favor of older valid usage', () => {
  const root = tmpDir('older-valid')
  const { transcriptPath } = writeCodexSession(root, {
    events: [
      { input_tokens: 68000, cached_input_tokens: 64000, output_tokens: 500, total_tokens: 68500, model_context_window: 258400 },
      { raw: { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 'bad' }, model_context_window: 258400 } } } },
    ],
  })

  assert.equal(promptOutput(hookInput(transcriptPath)), '32	CX 68k/258k 26% [######----] in 68k cached 64k out 500 total 68.5k')
})

test('invalid primary token values produce no output instead of zero usage', () => {
  const cases = [
    { input_tokens: -5, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0, model_context_window: 258400 },
    { info: { last_token_usage: { cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model_context_window: 258400 } },
    { info: { last_token_usage: { input_tokens: '68000', cached_input_tokens: 0, output_tokens: 0, total_tokens: 68000 }, model_context_window: 258400 } },
  ]

  for (const record of cases) {
    const { transcriptPath } = writeCodexSession(tmpDir('invalid-primary'), record)
    assert.equal(promptOutput(hookInput(transcriptPath)), '')
  }
})

test('missing or invalid context window produces no synthetic denominator', () => {
  const cases = [
    { info: { last_token_usage: { input_tokens: 68000, cached_input_tokens: 0, output_tokens: 0, total_tokens: 68000 } } },
    { input_tokens: 68000, model_context_window: -1 },
  ]

  for (const record of cases) {
    const { transcriptPath } = writeCodexSession(tmpDir('invalid-context'), record)
    assert.equal(promptOutput(hookInput(transcriptPath)), '')
  }
})

test('token boundaries use Codex input tokens against model_context_window', () => {
  const cases = [
    [0, '32	CX 0/258k 0% [----------] in 0 cached 0 out 0 total 0'],
    [9999, '32	CX 9.9k/258k 4% [----------] in 9.9k cached 0 out 0 total 9.9k'],
    [10000, '32	CX 10k/258k 4% [#---------] in 10k cached 0 out 0 total 10k'],
    [68000, '32	CX 68k/258k 26% [######----] in 68k cached 0 out 0 total 68k'],
    [89999, '32	CX 89.9k/258k 35% [########--] in 89.9k cached 0 out 0 total 89.9k'],
    [90000, '33	CX 90k/258k 35% [#########-] in 90k cached 0 out 0 total 90k'],
    [99999, '33	CX 99.9k/258k 39% [#########-] in 99.9k cached 0 out 0 total 99.9k'],
    [100000, '91	CX 100k/258k 39% [##########] in 100k cached 0 out 0 total 100k >= 100k new session'],
  ]
  for (const [input_tokens, expected] of cases) {
    const { transcriptPath } = writeCodexSession(tmpDir(`boundary-${input_tokens}`), { input_tokens })
    assert.equal(promptOutput(hookInput(transcriptPath)), expected)
  }
})

test('custom thresholds are honored without changing reported context', () => {
  const { transcriptPath } = writeCodexSession(tmpDir('custom'), { input_tokens: 50000, model_context_window: 258400 })
  assert.equal(promptOutput(hookInput(transcriptPath), {
    OPENCLAW_PROMPT_WARNING_LIMIT: '40000',
    OPENCLAW_PROMPT_SOFT_LIMIT: '60000',
  }), '33	CX 50k/258k 19% [#####-----] in 50k cached 0 out 0 total 50k')
})

test('wrapper forwards hook stdin and emits exact green, orange, and red ANSI prefixes', () => {
  const root = tmpDir('ansi')
  const home = installWrapperHome(root)
  const cases = [
    [68000, '1b5b313b33326d'],
    [95000, '1b5b33383b353b3230386d'],
    [100000, '1b5b313b39316d'],
  ]
  for (const [input_tokens, prefix] of cases) {
    const { transcriptPath } = writeCodexSession(tmpDir(`ansi-${input_tokens}`), { input_tokens })
    const result = runInstalledStatus(home, hookInput(transcriptPath))
    assert.equal(result.status, 0)
    const bytes = hex(result.stdout)
    assert.equal(bytes.startsWith(prefix), true)
    assert.equal(bytes.endsWith('1b5b306d0a'), true)
    assert.equal([...result.stdout].filter((byte) => byte === 0x0a).length, 1)
  }
})

test('wrapper failure does not block the hook', () => {
  const root = tmpDir('failure')
  const home = installWrapperHome(root)
  fs.writeFileSync(path.join(home, 'scripts/openclaw-session-tokens-prompt.js'), '#!/usr/bin/env bash\nexit 42\n')
  fs.chmodSync(path.join(home, 'scripts/openclaw-session-tokens-prompt.js'), 0o755)
  const result = runInstalledStatus(home, hookInput(path.join(root, 'missing.jsonl')))
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 0)
})
