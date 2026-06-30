#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')

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
fs.writeFileSync(hooksPath, `${JSON.stringify(config, null, 2)}\n`)

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error(`${file} is not valid JSON: ${error.message}`)
  }
}

function ensureHook(hooks, event, entry) {
  hooks[event] ||= []
  const command = entry.hooks?.[0]?.command
  const existingIndex = hooks[event].findIndex((candidate) =>
    candidate?.hooks?.some((hook) => hook?.command === command),
  )

  if (existingIndex === -1) {
    hooks[event].push(entry)
  } else {
    hooks[event][existingIndex] = entry
  }
}
