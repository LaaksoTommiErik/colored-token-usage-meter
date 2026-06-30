#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOOK_STATUS = 'Loading OpenClaw session token status'
const SESSION_START_MATCHER = 'startup|resume'

const hooksPath = path.join(os.homedir(), '.codex/hooks.json')
const sessionStartPath = path.join(os.homedir(), '.codex/hooks/openclaw-session-start.sh')
const promptStatusPath = path.join(os.homedir(), 'scripts/openclaw-session-tokens-status')

const canonicalSessionCommand = shellQuote(sessionStartPath)
const canonicalPromptCommand = shellQuote(promptStatusPath)

// Exact package-owned commands from this package. The unquoted variants are
// recognized only to clean up releases that installed the same absolute paths
// before shell quoting was added.
const packageCommands = {
  SessionStart: new Set([canonicalSessionCommand, sessionStartPath]),
  UserPromptSubmit: new Set([canonicalPromptCommand, promptStatusPath]),
}

const canonicalGroups = {
  SessionStart: {
    matcher: SESSION_START_MATCHER,
    hooks: [
      {
        type: 'command',
        command: canonicalSessionCommand,
        timeout: 10,
        statusMessage: HOOK_STATUS,
      },
    ],
  },
  UserPromptSubmit: {
    hooks: [
      {
        type: 'command',
        command: canonicalPromptCommand,
        timeout: 10,
        statusMessage: HOOK_STATUS,
      },
    ],
  },
}

const config = readJson(hooksPath) || {}
if (!isPlainObject(config.hooks)) {
  config.hooks = {}
}

installCanonicalHook(config.hooks, 'SessionStart')
installCanonicalHook(config.hooks, 'UserPromptSubmit')

fs.mkdirSync(path.dirname(hooksPath), { recursive: true })
writeJsonAtomic(hooksPath, config)

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error(`${file} is not valid JSON: ${error.message}`)
  }
}

function writeJsonAtomic(file, value) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`)
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function installCanonicalHook(hooks, event) {
  const groups = Array.isArray(hooks[event]) ? hooks[event] : []
  const ownedCommands = packageCommands[event]
  const keptGroups = []

  for (const group of groups) {
    if (!isPlainObject(group)) {
      keptGroups.push(group)
      continue
    }

    const handlers = Array.isArray(group.hooks) ? group.hooks : []
    const keptHandlers = handlers.filter((handler) => !isPackageOwnedHandler(handler, ownedCommands))

    if (keptHandlers.length > 0) {
      keptGroups.push({
        ...group,
        hooks: keptHandlers,
      })
    } else if (handlers.length === 0) {
      keptGroups.push(group)
    }
  }

  hooks[event] = [...keptGroups, canonicalGroups[event]]
}

function isPackageOwnedHandler(handler, ownedCommands) {
  return isPlainObject(handler)
    && handler.type === 'command'
    && typeof handler.command === 'string'
    && ownedCommands.has(handler.command)
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
