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

function writeCodexSession(root, records) {
  const codexHome = path.join(root, 'codex-home')
  const sessionDir = path.join(codexHome, 'sessions/2026/06/30')
  fs.mkdirSync(sessionDir, { recursive: true })
  const file = path.join(sessionDir, `${records.name || 'session'}.jsonl`)
  const lines = (records.events || [records]).map((record) => JSON.stringify({
    timestamp: record.timestamp || '2026-06-30T00:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
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
      },
    },
  }))
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
  return codexHome
}

function runPrompt(codexHome, env = {}) {
  return spawnSync(promptScript, [], {
    env: { ...process.env, CODEX_HOME: codexHome, ...env },
    encoding: 'utf8',
  })
}

function promptOutput(codexHome, env = {}) {
  const result = runPrompt(codexHome, env)
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

function runInstalledStatus(home, codexHome) {
  return spawnSync(path.join(home, 'scripts/openclaw-session-tokens-status'), [], {
    env: { ...process.env, HOME: home, CODEX_HOME: codexHome },
  })
}

function hex(buffer) {
  return buffer.toString('hex')
}

test('missing Codex sessions produce no output and exit code zero', () => {
  const result = runPrompt(path.join(tmpDir('missing'), 'codex-home'))
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})

test('malformed Codex session lines are ignored', () => {
  const root = tmpDir('malformed')
  const codexHome = path.join(root, 'codex-home')
  const dir = path.join(codexHome, 'sessions/2026/06/30')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'bad.jsonl'), '{bad\n')
  assert.equal(promptOutput(codexHome), '')
})

test('parses a sanitized real Codex token_count record shape', () => {
  const root = tmpDir('real-shape')
  const codexHome = path.join(root, 'codex-home')
  const sessionDir = path.join(codexHome, 'sessions/2026/06/30')
  fs.mkdirSync(sessionDir, { recursive: true })

  const record = {
    timestamp: '2026-06-30T15:28:10.444Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 8668251,
          cached_input_tokens: 8230016,
          output_tokens: 62546,
          reasoning_output_tokens: 9363,
          total_tokens: 8730797,
        },
        last_token_usage: {
          input_tokens: 193911,
          cached_input_tokens: 191872,
          output_tokens: 589,
          reasoning_output_tokens: 71,
          total_tokens: 194500,
        },
        model_context_window: 258400,
      },
      rate_limits: {
        limit_id: 'codex',
        limit_name: null,
        primary: { used_percent: 68.0, window_minutes: 300, resets_at: 1782845811 },
        secondary: { used_percent: 21.0, window_minutes: 10080, resets_at: 1783414597 },
        credits: null,
        individual_limit: null,
        plan_type: 'plus',
        rate_limit_reached_type: null,
      },
    },
  }
  assert.equal(record.payload.info.last_token_usage.input_tokens, 193911)
  assert.equal(record.payload.info.model_context_window, 258400)
  fs.writeFileSync(path.join(sessionDir, 'session.jsonl'), `${JSON.stringify(record)}\n`)

  assert.equal(promptOutput(codexHome), '91\tCX 193k/258k 75% [##########] in 193k cached 191k out 589 total 194k >= 100k new session')
})

test('uses latest Codex token_count event from newest session file', () => {
  const root = tmpDir('latest')
  const oldHome = writeCodexSession(root, { name: 'old', input_tokens: 10000, model_context_window: 258400 })
  const dir = path.join(oldHome, 'sessions/2026/06/30')
  const old = path.join(dir, 'old.jsonl')
  const latest = path.join(dir, 'latest.jsonl')
  fs.writeFileSync(latest, `${JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 150916, cached_input_tokens: 134016, output_tokens: 645, reasoning_output_tokens: 211, total_tokens: 151561 }, model_context_window: 258400 } } })}\n`)
  fs.utimesSync(old, new Date('2026-06-30T00:00:00Z'), new Date('2026-06-30T00:00:00Z'))
  fs.utimesSync(latest, new Date('2026-06-30T00:01:00Z'), new Date('2026-06-30T00:01:00Z'))
  assert.equal(promptOutput(oldHome), '91\tCX 150k/258k 58% [##########] in 150k cached 134k out 645 total 151k >= 100k new session')
})

test('token boundaries use Codex input tokens against model_context_window', () => {
  const cases = [
    [0, '32\tCX 0/258k 0% [----------] in 0 cached 0 out 0 total 0'],
    [9999, '32\tCX 9.9k/258k 4% [----------] in 9.9k cached 0 out 0 total 9.9k'],
    [10000, '32\tCX 10k/258k 4% [#---------] in 10k cached 0 out 0 total 10k'],
    [68000, '32\tCX 68k/258k 26% [######----] in 68k cached 0 out 0 total 68k'],
    [89999, '32\tCX 89.9k/258k 35% [########--] in 89.9k cached 0 out 0 total 89.9k'],
    [90000, '33\tCX 90k/258k 35% [#########-] in 90k cached 0 out 0 total 90k'],
    [99999, '33\tCX 99.9k/258k 39% [#########-] in 99.9k cached 0 out 0 total 99.9k'],
    [100000, '91\tCX 100k/258k 39% [##########] in 100k cached 0 out 0 total 100k >= 100k new session'],
  ]
  for (const [input_tokens, expected] of cases) {
    const codexHome = writeCodexSession(tmpDir(`boundary-${input_tokens}`), { input_tokens })
    assert.equal(promptOutput(codexHome), expected)
  }
})

test('custom thresholds and context fallback are honored', () => {
  const codexHome = writeCodexSession(tmpDir('custom'), { input_tokens: 50000, model_context_window: -1 })
  assert.equal(promptOutput(codexHome, {
    OPENCLAW_PROMPT_CONTEXT_FALLBACK: '200000',
    OPENCLAW_PROMPT_WARNING_LIMIT: '40000',
    OPENCLAW_PROMPT_SOFT_LIMIT: '60000',
  }), '33\tCX 50k/200k 25% [#####-----] in 50k cached 0 out 0 total 50k')
})

test('invalid token values normalize safely', () => {
  const codexHome = writeCodexSession(tmpDir('invalid'), { input_tokens: -5, cached_input_tokens: 'bad', output_tokens: 'bad', total_tokens: 'bad' })
  assert.equal(promptOutput(codexHome), '32\tCX 0/258k 0% [----------] in 0 cached 0 out 0 total 0')
})

test('wrapper emits exact green, orange, and red ANSI prefixes with reset and one trailing newline', () => {
  const root = tmpDir('ansi')
  const home = installWrapperHome(root)
  const cases = [
    [68000, '1b5b313b33326d'],
    [95000, '1b5b33383b353b3230386d'],
    [100000, '1b5b313b39316d'],
  ]
  for (const [input_tokens, prefix] of cases) {
    const result = runInstalledStatus(home, writeCodexSession(tmpDir(`ansi-${input_tokens}`), { input_tokens }))
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
  const result = runInstalledStatus(home, path.join(root, 'missing-codex-home'))
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 0)
})
