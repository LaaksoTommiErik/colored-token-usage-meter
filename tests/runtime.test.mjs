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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function runPrompt(sessionsPath, env = {}) {
  return spawnSync(promptScript, [], {
    env: { ...process.env, OPENCLAW_SESSIONS_PATH: sessionsPath, ...env },
    encoding: 'utf8',
  })
}

function promptOutput(sessionsPath, env = {}) {
  const result = runPrompt(sessionsPath, env)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trimEnd()
}

function writeSession(root, record, key = 'agent:main:main') {
  const sessions = path.join(root, 'sessions.json')
  writeJson(sessions, { [key]: record })
  return sessions
}

function runInstalledStatus(home, sessionsPath, extraEnv = {}) {
  return spawnSync(path.join(home, 'scripts/openclaw-session-tokens-status'), [], {
    env: { ...process.env, HOME: home, OPENCLAW_SESSIONS_PATH: sessionsPath, ...extraEnv },
  })
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

function hex(buffer) {
  return buffer.toString('hex')
}

test('missing sessions file produces no output and exit code zero', () => {
  const result = runPrompt(path.join(tmpDir('missing'), 'missing.json'))
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})

test('malformed sessions JSON produces no output and exit code zero', () => {
  const root = tmpDir('malformed')
  const sessions = path.join(root, 'sessions.json')
  fs.writeFileSync(sessions, '{bad\n')
  const result = runPrompt(sessions)
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})

test('empty sessions object produces no output', () => {
  const root = tmpDir('empty')
  const sessions = path.join(root, 'sessions.json')
  writeJson(sessions, {})
  assert.equal(promptOutput(sessions), '')
})

test('exact configured session key is used', () => {
  const root = tmpDir('exact-key')
  const sessions = path.join(root, 'sessions.json')
  writeJson(sessions, {
    'agent:main:main': { totalTokens: 10000, contextTokens: 272000, updatedAt: 2 },
    custom: { totalTokens: 68000, contextTokens: 272000, updatedAt: 1 },
  })
  assert.equal(promptOutput(sessions, { OPENCLAW_PROMPT_SESSION_KEY: 'custom' }), '32\tOC 68k/272k 25% [######----]')
})

test('missing configured key falls back to newest numeric updatedAt session', () => {
  const root = tmpDir('newest')
  const sessions = path.join(root, 'sessions.json')
  writeJson(sessions, {
    old: { totalTokens: 10000, contextTokens: 272000, updatedAt: 1 },
    badTime: { totalTokens: 50000, contextTokens: 272000, updatedAt: 'not-a-number' },
    newest: { totalTokens: 95000, contextTokens: 272000, updatedAt: 20 },
  })
  assert.equal(promptOutput(sessions, { OPENCLAW_PROMPT_SESSION_KEY: 'missing' }), '33\tOC 95k/272k 35% [#########-]')
})

test('sanitized fixture based on current OpenClaw session-record shape', () => {
  const root = tmpDir('sanitized')
  const sessions = writeSession(root, {
    abortedLastRun: false,
    agentHarnessId: 'main',
    cacheRead: 123,
    cacheWrite: 456,
    chatType: 'codex',
    compactionCount: 0,
    contextTokens: 272000,
    deliveryContext: { channel: 'cli' },
    endedAt: 1000,
    estimatedCostUsd: 0.01,
    inputTokens: 60000,
    lastChannel: 'commentary',
    lastInteractionAt: 1000,
    model: 'gpt-5',
    modelProvider: 'openai',
    origin: { provider: 'openclaw', surface: 'cli', chatType: 'codex' },
    outputTokens: 8000,
    route: { channel: 'main' },
    runtimeMs: 1000,
    sessionFile: '/redacted/session.jsonl',
    sessionId: '00000000-0000-4000-8000-000000000000',
    sessionStartedAt: 900,
    skillsSnapshot: { skills: [], version: 1, promptFormatVersion: 1, promptRef: 'redacted' },
    startedAt: 900,
    status: 'idle',
    systemPromptReport: { source: 'redacted', generatedAt: 900, sessionId: 'redacted', sessionKey: 'agent:main:main' },
    systemSent: true,
    totalTokens: 68000,
    totalTokensFresh: true,
    updatedAt: 1000,
  })
  assert.equal(promptOutput(sessions), '32\tOC 68k/272k 25% [######----]')
})

test('stale token data is marked with tilde', () => {
  const root = tmpDir('stale')
  const sessions = writeSession(root, { totalTokens: 68000, contextTokens: 272000, totalTokensFresh: false, updatedAt: 1 })
  assert.equal(promptOutput(sessions), '32\tOC ~68k/272k 25% [######----]')
})

test('missing and invalid context values use safe fallback', () => {
  const root = tmpDir('context')
  let sessions = writeSession(root, { totalTokens: 50000, updatedAt: 1 })
  assert.equal(promptOutput(sessions, { OPENCLAW_PROMPT_CONTEXT_FALLBACK: '200000' }), '32\tOC 50k/200k 25% [#####-----]')

  sessions = writeSession(root, { totalTokens: 50000, contextTokens: -1, modelContextWindow: 'bad', updatedAt: 1 })
  assert.equal(promptOutput(sessions, { OPENCLAW_PROMPT_CONTEXT_FALLBACK: 'bad' }), '32\tOC 50k/272k 18% [#####-----]')
})

test('negative and non-numeric token counts normalize to zero', () => {
  const root = tmpDir('bad-total')
  let sessions = writeSession(root, { totalTokens: -50, contextTokens: 272000, updatedAt: 1 })
  assert.equal(promptOutput(sessions), '32\tOC 0/272k 0% [----------]')

  sessions = writeSession(root, { totalTokens: 'not-a-number', contextTokens: 272000, updatedAt: 1 })
  assert.equal(promptOutput(sessions), '32\tOC 0/272k 0% [----------]')
})

test('invalid environment-variable values fall back to defaults', () => {
  const root = tmpDir('bad-env')
  const sessions = writeSession(root, { totalTokens: 95000, contextTokens: 272000, updatedAt: 1 })
  assert.equal(promptOutput(sessions, {
    OPENCLAW_PROMPT_WARNING_LIMIT: 'bad',
    OPENCLAW_PROMPT_SOFT_LIMIT: '-1',
    OPENCLAW_PROMPT_CONTEXT_FALLBACK: 'NaN',
  }), '33\tOC 95k/272k 35% [#########-]')
})

test('custom sessions path, warning threshold, and session threshold', () => {
  const root = tmpDir('custom-env')
  const sessions = writeSession(root, { totalTokens: 50000, contextTokens: 200000, updatedAt: 1 }, 'custom')
  assert.equal(promptOutput(sessions, {
    OPENCLAW_PROMPT_SESSION_KEY: 'custom',
    OPENCLAW_PROMPT_WARNING_LIMIT: '40000',
    OPENCLAW_PROMPT_SOFT_LIMIT: '60000',
  }), '33\tOC 50k/200k 25% [#####-----]')
  assert.equal(promptOutput(sessions, {
    OPENCLAW_PROMPT_SESSION_KEY: 'custom',
    OPENCLAW_PROMPT_WARNING_LIMIT: '40000',
    OPENCLAW_PROMPT_SOFT_LIMIT: '50000',
  }), '91\tOC 50k [#####-----] >= 50k new session')
})

test('token boundaries, meter blocks, threshold colors, and non-misleading formatting', () => {
  const cases = [
    [0, '32\tOC 0/272k 0% [----------]'],
    [9999, '32\tOC 9.9k/272k 4% [----------]'],
    [10000, '32\tOC 10k/272k 4% [#---------]'],
    [68000, '32\tOC 68k/272k 25% [######----]'],
    [89999, '32\tOC 89.9k/272k 33% [########--]'],
    [90000, '33\tOC 90k/272k 33% [#########-]'],
    [99999, '33\tOC 99.9k/272k 37% [#########-]'],
    [100000, '91\tOC 100k [##########] >= 100k new session'],
    [150000, '91\tOC 150k [##########] >= 100k new session'],
    [1250000, '91\tOC 1.25M [##########] >= 100k new session'],
  ]

  for (const [total, expected] of cases) {
    const root = tmpDir(`boundary-${total}`)
    const sessions = writeSession(root, { totalTokens: total, contextTokens: 272000, updatedAt: 1 })
    assert.equal(promptOutput(sessions), expected)
  }
})

test('context percentage rounding and values exceeding context window', () => {
  const root = tmpDir('percent')
  let sessions = writeSession(root, { totalTokens: 1, contextTokens: 3, updatedAt: 1 })
  assert.equal(promptOutput(sessions), '32\tOC 1/3 33% [----------]')

  sessions = writeSession(root, { totalTokens: 150000, contextTokens: 100000, updatedAt: 1 })
  assert.equal(promptOutput(sessions), '91\tOC 150k [##########] >= 100k new session')
})

test('wrapper emits exact green, orange, and red ANSI prefixes with reset and one trailing newline', () => {
  const root = tmpDir('ansi')
  const home = installWrapperHome(root)
  const cases = [
    [68000, '1b5b313b33326d'],
    [95000, '1b5b33383b353b3230386d'],
    [100000, '1b5b313b39316d'],
  ]

  for (const [total, prefix] of cases) {
    const sessions = writeSession(root, { totalTokens: total, contextTokens: 272000, updatedAt: total })
    const result = runInstalledStatus(home, sessions)
    assert.equal(result.status, 0)
    const bytes = hex(result.stdout)
    assert.equal(bytes.startsWith(prefix), true)
    assert.equal(bytes.endsWith('1b5b306d0a'), true)
    assert.equal([...result.stdout].filter((byte) => byte === 0x0a).length, 1)
  }
})

test('wrapper produces no output and exit code zero when data is unavailable', () => {
  const root = tmpDir('wrapper-empty')
  const home = installWrapperHome(root)
  const result = runInstalledStatus(home, path.join(root, 'missing.json'))
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 0)
})

test('runtime reader failure does not block the Codex hook', () => {
  const root = tmpDir('reader-failure')
  const home = installWrapperHome(root)
  fs.writeFileSync(path.join(home, 'scripts/openclaw-session-tokens-prompt.js'), '#!/usr/bin/env bash\nexit 42\n')
  fs.chmodSync(path.join(home, 'scripts/openclaw-session-tokens-prompt.js'), 0o755)
  const result = runInstalledStatus(home, path.join(root, 'sessions.json'))
  assert.equal(result.status, 0)
  assert.equal(result.stdout.length, 0)
})

test('wrapper paths containing spaces execute successfully', () => {
  const root = tmpDir('wrapper-spaces')
  const home = path.join(root, 'home with spaces')
  fs.mkdirSync(path.join(home, 'scripts'), { recursive: true })
  fs.copyFileSync(promptScript, path.join(home, 'scripts/openclaw-session-tokens-prompt.js'))
  fs.copyFileSync(statusWrapper, path.join(home, 'scripts/openclaw-session-tokens-status'))
  fs.chmodSync(path.join(home, 'scripts/openclaw-session-tokens-prompt.js'), 0o755)
  fs.chmodSync(path.join(home, 'scripts/openclaw-session-tokens-status'), 0o755)
  const sessions = writeSession(root, { totalTokens: 68000, contextTokens: 272000, updatedAt: 1 })
  const result = runInstalledStatus(home, sessions)
  assert.equal(result.status, 0)
  assert.match(result.stdout.toString('utf8'), /OC 68k\/272k 25% \[######----\]/)
})
