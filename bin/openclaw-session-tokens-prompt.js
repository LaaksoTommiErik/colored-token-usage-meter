#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const home = process.env.HOME || ''
const sessionsPath = process.env.OPENCLAW_SESSIONS_PATH || path.join(home, '.openclaw/agents/main/sessions/sessions.json')
const sessionKey = process.env.OPENCLAW_PROMPT_SESSION_KEY || 'agent:main:main'
const softLimit = Number(process.env.OPENCLAW_PROMPT_SOFT_LIMIT || 100000)
const contextFallback = Number(process.env.OPENCLAW_PROMPT_CONTEXT_FALLBACK || 272000)

function formatTokens(value) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

function formatMeter(value) {
  const blockSize = 10_000
  const blockCount = 10
  const filled = Math.max(0, Math.min(blockCount, Math.floor(value / blockSize)))
  return `[${'#'.repeat(filled)}${'-'.repeat(blockCount - filled)}]`
}

function readSessions() {
  try {
    return JSON.parse(fs.readFileSync(sessionsPath, 'utf8'))
  } catch {
    return null
  }
}

const sessions = readSessions()
const record = sessions?.[sessionKey] || Object.values(sessions || {})
  .filter((entry) => entry && typeof entry === 'object')
  .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0]

if (!record) {
  process.exit(0)
}

const total = Number(record.totalTokens || 0)
const context = Number(record.contextTokens || record.modelContextWindow || contextFallback)
const percent = context > 0 ? Math.round((total / context) * 100) : 0
const stale = record.totalTokensFresh === false ? '~' : ''
const overLimit = total >= softLimit
const meter = formatMeter(total)

const label = overLimit
  ? `OC ${stale}${formatTokens(total)} ${meter} >= ${formatTokens(softLimit)} new session`
  : `OC ${stale}${formatTokens(total)}/${formatTokens(context)} ${percent}% ${meter}`

const color = total >= 100_000 ? '91' : total >= 90_000 ? '33' : '32'
console.log(`${color}\t${label}`)
