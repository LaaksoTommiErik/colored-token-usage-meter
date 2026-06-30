#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const DEFAULT_SESSION_KEY = 'agent:main:main'
const DEFAULT_CONTEXT_FALLBACK = 272000
const DEFAULT_WARNING_LIMIT = 90000
const DEFAULT_SESSION_LIMIT = 100000

const home = process.env.HOME || ''
const sessionsPath = process.env.OPENCLAW_SESSIONS_PATH || path.join(home, '.openclaw/agents/main/sessions/sessions.json')
const sessionKey = process.env.OPENCLAW_PROMPT_SESSION_KEY || DEFAULT_SESSION_KEY
const warningLimit = positiveFiniteFromEnv('OPENCLAW_PROMPT_WARNING_LIMIT', DEFAULT_WARNING_LIMIT)
const sessionLimit = positiveFiniteFromEnv('OPENCLAW_PROMPT_SOFT_LIMIT', DEFAULT_SESSION_LIMIT)
const contextFallback = positiveFiniteFromEnv('OPENCLAW_PROMPT_CONTEXT_FALLBACK', DEFAULT_CONTEXT_FALLBACK)

function formatTokens(value) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) return `${trimFixed(value / 1_000_000, 2)}M`
  if (value >= 100_000) return `${Math.floor(value / 1000)}k`
  if (value >= 10_000) {
    const wholeThousands = value / 1000
    if (Number.isInteger(wholeThousands)) return `${wholeThousands}k`
    return `${trimFixed(Math.floor(wholeThousands * 10) / 10, 1)}k`
  }
  if (value >= 1000) return `${trimFixed(Math.floor((value / 1000) * 10) / 10, 1)}k`
  return String(Math.round(value))
}

function trimFixed(value, digits) {
  return value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
}

function formatMeter(value) {
  const blockSize = 10_000
  const blockCount = 10
  const filled = Math.max(0, Math.min(blockCount, Math.floor(value / blockSize)))
  return `[${'#'.repeat(filled)}${'-'.repeat(blockCount - filled)}]`
}

function readSessions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function positiveFiniteFromEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeFinite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function positiveFinite(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function updatedAtValue(record) {
  if (!record || typeof record !== 'object') return 0
  const value = Number(record.updatedAt)
  return Number.isFinite(value) ? value : 0
}

function pickRecord(sessions) {
  if (!sessions) return null
  if (sessions[sessionKey] && typeof sessions[sessionKey] === 'object') {
    return sessions[sessionKey]
  }

  return Object.values(sessions)
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .sort((a, b) => updatedAtValue(b) - updatedAtValue(a))[0] || null
}

const record = pickRecord(readSessions())

if (!record) {
  process.exit(0)
}

const total = nonNegativeFinite(record.totalTokens)
const context = positiveFinite(record.contextTokens, positiveFinite(record.modelContextWindow, contextFallback))
const percent = Math.round((total / context) * 100)
const stale = record.totalTokensFresh === false ? '~' : ''
const overLimit = total >= sessionLimit
const meter = formatMeter(total)

const label = overLimit
  ? `OC ${stale}${formatTokens(total)} ${meter} >= ${formatTokens(sessionLimit)} new session`
  : `OC ${stale}${formatTokens(total)}/${formatTokens(context)} ${percent}% ${meter}`

const color = total >= sessionLimit ? '91' : total >= warningLimit ? '33' : '32'
console.log(`${color}\t${label}`)
