import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'

const repoDir = path.resolve(import.meta.dirname, '..')
const installScript = path.join(repoDir, 'install.sh')
const hookStatus = 'Loading OpenClaw session token status'

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ctum-${name}-`))
}

function runInstall(home, extraEnv = {}) {
  return spawnSync('bash', [installScript], {
    cwd: repoDir,
    env: { ...process.env, ...extraEnv, HOME: home },
    encoding: 'utf8',
  })
}

function installOk(home, extraEnv = {}) {
  const result = runInstall(home, extraEnv)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result
}

function readHooks(home) {
  return JSON.parse(fs.readFileSync(path.join(home, '.codex/hooks.json'), 'utf8'))
}

function writeHooks(home, value) {
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
  fs.writeFileSync(path.join(home, '.codex/hooks.json'), `${JSON.stringify(value, null, 2)}\n`)
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function canonicalCommands(home) {
  return {
    session: shellQuote(path.join(home, '.codex/hooks/openclaw-session-start.sh')),
    prompt: shellQuote(path.join(home, 'scripts/openclaw-session-tokens-status')),
    legacySession: path.join(home, '.codex/hooks/openclaw-session-start.sh'),
    legacyPrompt: path.join(home, 'scripts/openclaw-session-tokens-status'),
  }
}

function commandHandlers(config, event) {
  return (config.hooks[event] || []).flatMap((group) => group.hooks || [])
}

function groupsWithCommand(config, event, command) {
  return (config.hooks[event] || []).filter((group) =>
    (group.hooks || []).some((handler) => handler.command === command),
  )
}

function mode(file) {
  return fs.statSync(file).mode & 0o777
}

test('fresh installation into an empty temporary HOME', () => {
  const home = tmpDir('fresh')
  installOk(home)
  const commands = canonicalCommands(home)
  const config = readHooks(home)

  assert.equal(groupsWithCommand(config, 'SessionStart', commands.session).length, 1)
  assert.equal(groupsWithCommand(config, 'UserPromptSubmit', commands.prompt).length, 1)
  assert.equal(config.hooks.SessionStart.at(-1).matcher, 'startup|resume')
  assert.equal(commandHandlers(config, 'SessionStart').find((handler) => handler.command === commands.session).timeout, 10)
  assert.equal(commandHandlers(config, 'UserPromptSubmit').find((handler) => handler.command === commands.prompt).statusMessage, hookStatus)
})

test('preserves unrelated top-level JSON properties', () => {
  const home = tmpDir('top-level')
  writeHooks(home, { customProperty: { keep: true }, hooks: {} })
  installOk(home)
  assert.deepEqual(readHooks(home).customProperty, { keep: true })
})

test('preserves unrelated hook events', () => {
  const home = tmpDir('events')
  writeHooks(home, {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: '/tmp/stop-hook', timeout: 1 }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/tmp/pre-tool', timeout: 2 }] }],
    },
  })
  installOk(home)
  const config = readHooks(home)
  assert.equal(config.hooks.Stop[0].hooks[0].command, '/tmp/stop-hook')
  assert.equal(config.hooks.PreToolUse[0].matcher, 'Bash')
})

test('preserves unrelated matcher groups', () => {
  const home = tmpDir('groups')
  writeHooks(home, {
    hooks: {
      SessionStart: [
        { matcher: 'clear', hooks: [{ type: 'command', command: '/tmp/clear-hook' }] },
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: '/tmp/prompt-hook' }] },
      ],
    },
  })
  installOk(home)
  const config = readHooks(home)
  assert.equal(config.hooks.SessionStart[0].matcher, 'clear')
  assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].command, '/tmp/prompt-hook')
})

test('preserves sibling handler in the same matcher group and adds canonical group separately', () => {
  const home = tmpDir('sibling')
  const commands = canonicalCommands(home)
  writeHooks(home, {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            { type: 'command', command: commands.legacyPrompt, timeout: 1, statusMessage: 'old meter' },
            { type: 'command', command: '/tmp/sibling', timeout: 2, statusMessage: 'keep me' },
          ],
        },
      ],
    },
  })
  installOk(home)
  const config = readHooks(home)
  assert.equal(config.hooks.UserPromptSubmit[0].hooks.length, 1)
  assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].command, '/tmp/sibling')
  assert.equal(groupsWithCommand(config, 'UserPromptSubmit', commands.prompt).length, 1)
  assert.equal(config.hooks.UserPromptSubmit.at(-1).hooks[0].command, commands.prompt)
})

test('removes duplicate copies of exact package-owned handlers', () => {
  const home = tmpDir('duplicates')
  const commands = canonicalCommands(home)
  writeHooks(home, {
    hooks: {
      SessionStart: [
        { matcher: 'startup|resume', hooks: [{ type: 'command', command: commands.session }] },
        { matcher: 'resume', hooks: [{ type: 'command', command: commands.legacySession }] },
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: commands.prompt }] },
        { hooks: [{ type: 'command', command: commands.legacyPrompt }] },
      ],
    },
  })
  installOk(home)
  const config = readHooks(home)
  assert.equal(commandHandlers(config, 'SessionStart').filter((handler) => handler.command === commands.session).length, 1)
  assert.equal(commandHandlers(config, 'UserPromptSubmit').filter((handler) => handler.command === commands.prompt).length, 1)
  assert.equal(commandHandlers(config, 'SessionStart').some((handler) => handler.command === commands.legacySession), false)
  assert.equal(commandHandlers(config, 'UserPromptSubmit').some((handler) => handler.command === commands.legacyPrompt), false)
})

test('reinstallation is idempotent', () => {
  const home = tmpDir('idempotent')
  installOk(home)
  const once = fs.readFileSync(path.join(home, '.codex/hooks.json'), 'utf8')
  installOk(home)
  const twice = fs.readFileSync(path.join(home, '.codex/hooks.json'), 'utf8')
  assert.equal(twice, once)
})

test('invalid existing hooks.json fails before copying files and leaves original unchanged', () => {
  const home = tmpDir('invalid')
  const hooksDir = path.join(home, '.codex')
  fs.mkdirSync(hooksDir, { recursive: true })
  const hooksPath = path.join(hooksDir, 'hooks.json')
  const original = '{ invalid json\n'
  fs.writeFileSync(hooksPath, original)

  const result = runInstall(home)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /JSON|SyntaxError/)
  assert.equal(fs.readFileSync(hooksPath, 'utf8'), original)
  assert.equal(fs.existsSync(path.join(home, 'scripts/openclaw-session-tokens-status')), false)
})

test('HOME path containing spaces works and hook command executes through a shell', () => {
  const root = tmpDir('spaces')
  const home = path.join(root, 'home with spaces')
  fs.mkdirSync(home)
  installOk(home)
  const config = readHooks(home)
  const command = config.hooks.UserPromptSubmit.at(-1).hooks[0].command
  assert.equal(command, canonicalCommands(home).prompt)

  const sessions = path.join(root, 'sessions.json')
  fs.writeFileSync(sessions, JSON.stringify({
    'agent:main:main': { totalTokens: 68000, contextTokens: 272000, totalTokensFresh: true, updatedAt: 100 },
  }))
  const output = execFileSync('bash', ['-lc', command], {
    env: { ...process.env, HOME: home, OPENCLAW_SESSIONS_PATH: sessions },
    encoding: 'utf8',
  })
  assert.match(output, /OC 68k\/272k 25% \[######----\]/)
})

test('HOME path containing shell-sensitive quote is shell-quoted safely', () => {
  const root = tmpDir('quote')
  const home = path.join(root, "home with 'quote'")
  fs.mkdirSync(home)
  installOk(home)
  const command = readHooks(home).hooks.UserPromptSubmit.at(-1).hooks[0].command
  assert.equal(command, canonicalCommands(home).prompt)
})

test('installed file permissions are 0755', () => {
  const home = tmpDir('modes')
  installOk(home)
  assert.equal(mode(path.join(home, 'scripts/openclaw-session-tokens-prompt.js')), 0o755)
  assert.equal(mode(path.join(home, 'scripts/openclaw-session-tokens-status')), 0o755)
  assert.equal(mode(path.join(home, '.codex/hooks/openclaw-session-start.sh')), 0o755)
})

test('missing required dependency produces a clear failure before copying files', () => {
  const home = tmpDir('missing-dependency')
  const fakePath = path.join(tmpDir('fake-path'), 'bin')
  fs.mkdirSync(fakePath, { recursive: true })
  for (const command of ['bash', 'dirname', 'mkdir']) {
    const resolved = spawnSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).stdout.trim()
    fs.symlinkSync(resolved, path.join(fakePath, command))
  }

  const result = spawnSync('/usr/bin/env', ['bash', installScript], {
    cwd: repoDir,
    env: { ...process.env, HOME: home, PATH: fakePath },
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /required command not found: node/)
  assert.equal(fs.existsSync(path.join(home, 'scripts/openclaw-session-tokens-status')), false)
})

test('failed installation does not corrupt or truncate hooks.json', () => {
  const home = tmpDir('failed-no-corrupt')
  const original = '{ malformed but important\n'
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
  fs.writeFileSync(path.join(home, '.codex/hooks.json'), original)
  const result = runInstall(home)
  assert.notEqual(result.status, 0)
  assert.equal(fs.readFileSync(path.join(home, '.codex/hooks.json'), 'utf8'), original)
})
