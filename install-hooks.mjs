#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const hooksPath = path.join(os.homedir(), '.codex/hooks.json')
const config = readJson(hooksPath) || {}
config.hooks ||= {}

ensureHook(config.hooks, 'SessionStart', {
  matcher: 'startup|resume',
  hooks: [
    {
      type: 'command',
      command: path.join(os.homedir(), '.codex/hooks/openclaw-session-start.sh'),
      timeout: 10,
      statusMessage: 'Loading OpenClaw session token status',
    },
  ],
})

ensureHook(config.hooks, 'UserPromptSubmit', {
  hooks: [
    {
      type: 'command',
      command: path.join(os.homedir(), 'scripts/openclaw-session-tokens-status'),
      timeout: 10,
      statusMessage: 'Loading OpenClaw session token status',
    },
  ],
})

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
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function ensureHook(hooks, event, entry) {
  hooks[event] ||= []

  const desiredHandlers = entry.hooks || []
  const desiredCommands = new Set(
    desiredHandlers
      .map((handler) => handler?.command)
      .filter((command) => typeof command === 'string'),
  )

  const groupIndex = hooks[event].findIndex((candidate) =>
    candidate?.hooks?.some((handler) => desiredCommands.has(handler?.command)),
  )

  if (groupIndex === -1) {
    hooks[event].push(entry)
    return
  }

  const existingGroup = hooks[event][groupIndex]
  const existingHandlers = Array.isArray(existingGroup.hooks) ? existingGroup.hooks : []
  const mergedHandlers = [
    ...existingHandlers.filter((handler) => !desiredCommands.has(handler?.command)),
    ...desiredHandlers,
  ]

  hooks[event][groupIndex] = {
    ...existingGroup,
    ...entry,
    hooks: mergedHandlers,
  }
}
