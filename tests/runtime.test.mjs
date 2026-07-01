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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctum-runtime-' + name + '-'))
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
  const file = path.join(sessionDir, (records.name || 'session') + '.jsonl')
  const events = records.events || [records]
  const lines = events.map((record) => JSON.stringify(record.raw || tokenEvent(record)))
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return { codexHome, transcriptPath: file }
}

function runPrompt(env = {}) {
  return spawnSync(promptScript, [], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

function promptOutput(env = {}) {
  const result = runPrompt(env)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trimEnd()
}

function emptyCodexHome(root = tmpDir('empty-codex-home')) {
  const codexHome = path.join(root, 'codex-home')
  fs.mkdirSync(codexHome, { recursive: true })
  return codexHome
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

function runInstalledStatus(home, env = {}) {
  return spawnSync(path.join(home, 'scripts/openclaw-session-tokens-status'), [], {
    env: { ...process.env, HOME: home, ...env },
  })
}

function hex(buffer) {
  return buffer.toString('hex')
}

test('missing session data reports unavailable instead of stale usage', () => {
  assert.equal(promptOutput({ CODEX_HOME: emptyCodexHome() }), '33	Codex session: token status unavailable; no token-count event found')
})

test('empty newest transcript reports unavailable instead of falling back to older sessions', () => {
  const root = tmpDir('empty-newest')
  const older = writeCodexSession(root, { name: 'older', input_tokens: 170000, model_context_window: 258400 })
  const empty = writeCodexSession(root, { name: 'newest', events: [] })
  fs.utimesSync(older.transcriptPath, new Date('2026-06-30T00:00:00Z'), new Date('2026-06-30T00:00:00Z'))
  fs.utimesSync(empty.transcriptPath, new Date('2026-06-30T00:01:00Z'), new Date('2026-06-30T00:01:00Z'))

  assert.equal(promptOutput({ CODEX_HOME: older.codexHome }), '33	Codex session: token status unavailable; no token-count event found')
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
  const { codexHome } = writeCodexSession(root, {
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

  assert.equal(promptOutput({ CODEX_HOME: codexHome }), '91	Codex session 193k/170k soft cap 114% [##########] ctx in 193k cached 191k out 589 total 194k >= 170k new session')
})

test('uses the newest modified session file only', () => {
  const root = tmpDir('newest-session')
  const older = writeCodexSession(root, { name: 'older', input_tokens: 30000, model_context_window: 258400 })
  const newer = writeCodexSession(root, { name: 'newer', input_tokens: 170000, model_context_window: 258400 })
  fs.utimesSync(older.transcriptPath, new Date('2026-06-30T00:00:00Z'), new Date('2026-06-30T00:00:00Z'))
  fs.utimesSync(newer.transcriptPath, new Date('2026-06-30T00:01:00Z'), new Date('2026-06-30T00:01:00Z'))

  assert.equal(promptOutput({ CODEX_HOME: older.codexHome }), '91	Codex session 170k/170k soft cap 100% [##########] ctx in 170k cached 0 out 0 total 170k >= 170k new session')
})

test('latest malformed token_count falls back to zero instead of older usage', () => {
  const { codexHome } = writeCodexSession(tmpDir('malformed-latest'), {
    events: [
      { input_tokens: 68000, cached_input_tokens: 64000, output_tokens: 500, total_tokens: 68500, model_context_window: 258400 },
      { raw: { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 'bad' }, model_context_window: 258400 } } } },
    ],
  })

  assert.equal(promptOutput({ CODEX_HOME: codexHome }), '32	Codex session 0/170k soft cap 0% [----------] ctx in 0 cached 0 out 0 total 0')
})

test('token boundaries use Codex input tokens against the 170k soft cap', () => {
  const cases = [
    [0, '32	Codex session 0/170k soft cap 0% [----------] ctx in 0 cached 0 out 0 total 0'],
    [9999, '32	Codex session 9.9k/170k soft cap 6% [----------] ctx in 9.9k cached 0 out 0 total 9.9k'],
    [10000, '32	Codex session 10k/170k soft cap 6% [----------] ctx in 10k cached 0 out 0 total 10k'],
    [68000, '32	Codex session 68k/170k soft cap 40% [####------] ctx in 68k cached 0 out 0 total 68k'],
    [89999, '32	Codex session 89.9k/170k soft cap 53% [#####-----] ctx in 89.9k cached 0 out 0 total 89.9k'],
    [90000, '32	Codex session 90k/170k soft cap 53% [#####-----] ctx in 90k cached 0 out 0 total 90k'],
    [99999, '32	Codex session 99.9k/170k soft cap 59% [#####-----] ctx in 99.9k cached 0 out 0 total 99.9k'],
    [100000, '32	Codex session 100k/170k soft cap 59% [#####-----] ctx in 100k cached 0 out 0 total 100k'],
    [144499, '32	Codex session 144k/170k soft cap 85% [########--] ctx in 144k cached 0 out 0 total 144k'],
    [144500, '33	Codex session 144k/170k soft cap 85% [########--] ctx in 144k cached 0 out 0 total 144k'],
    [169999, '33	Codex session 169k/170k soft cap 100% [#########-] ctx in 169k cached 0 out 0 total 169k'],
    [170000, '91	Codex session 170k/170k soft cap 100% [##########] ctx in 170k cached 0 out 0 total 170k >= 170k new session'],
  ]
  for (const [input_tokens, expected] of cases) {
    const { codexHome } = writeCodexSession(tmpDir('boundary-' + input_tokens), { input_tokens })
    assert.equal(promptOutput({ CODEX_HOME: codexHome }), expected)
  }
})

test('custom thresholds and soft cap are honored', () => {
  const { codexHome } = writeCodexSession(tmpDir('custom'), { input_tokens: 50000, model_context_window: 258400 })
  assert.equal(promptOutput({
    CODEX_HOME: codexHome,
    OPENCLAW_PROMPT_WARNING_LIMIT: '40000',
    OPENCLAW_PROMPT_SOFT_LIMIT: '60000',
  }), '33	Codex session 50k/60k soft cap 83% [########--] ctx in 50k cached 0 out 0 total 50k')
})

test('wrapper emits exact green, orange, and red ANSI prefixes', () => {
  const root = tmpDir('ansi')
  const home = installWrapperHome(root)
  const cases = [
    [68000, '1b5b313b33326d'],
    [144500, '1b5b33383b353b3230386d'],
    [170000, '1b5b313b39316d'],
  ]
  for (const [input_tokens, prefix] of cases) {
    const { codexHome } = writeCodexSession(tmpDir('ansi-' + input_tokens), { input_tokens })
    const result = runInstalledStatus(home, { CODEX_HOME: codexHome })
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
  const result = runInstalledStatus(home, { CODEX_HOME: emptyCodexHome(root) })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 0)
})
