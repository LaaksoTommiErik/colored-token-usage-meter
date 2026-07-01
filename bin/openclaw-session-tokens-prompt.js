#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const DEFAULT_CONTEXT_FALLBACK = 170000
const DEFAULT_WARNING_LIMIT = 144500
const DEFAULT_SESSION_LIMIT = 170000

const home = process.env.HOME || ''
const codexHome = process.env.CODEX_HOME || path.join(home, '.codex')
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
  const blockSize = 17_000
  const blockCount = 10
  const filled = Math.max(0, Math.min(blockCount, Math.floor(value / blockSize)))
  return `[${'#'.repeat(filled)}${'-'.repeat(blockCount - filled)}]`
}

function positiveFiniteFromEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeFinite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}


function collectSessionFiles(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSessionFiles(full, out)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        out.push({ file: full, mtimeMs: fs.statSync(full).mtimeMs })
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }
  return out
}

function latestCodexTokenCount() {
  const latest = collectSessionFiles(path.join(codexHome, 'sessions'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file))[0]

  if (!latest) return null
  return lastTokenCountInFile(latest.file)
}

function lastTokenCountInFile(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }

  const lines = text.trimEnd().split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let event
    try {
      event = JSON.parse(lines[i])
    } catch {
      continue
    }
    if (event?.type === 'event_msg' && event.payload?.type === 'token_count') {
      return event.payload.info || null
    }
  }
  return null
}

const tokenCount = latestCodexTokenCount() || {
  last_token_usage: {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  },
  model_context_window: contextFallback,
}

const last = tokenCount.last_token_usage || {}
const used = nonNegativeFinite(last.input_tokens)
const total = nonNegativeFinite(last.total_tokens)
const cached = nonNegativeFinite(last.cached_input_tokens)
const output = nonNegativeFinite(last.output_tokens)
const context = contextFallback
const percent = Math.round((used / context) * 100)
const overLimit = used >= sessionLimit
const meter = formatMeter(used)
const detail = `in ${formatTokens(used)} cached ${formatTokens(cached)} out ${formatTokens(output)} total ${formatTokens(total)}`

const label = overLimit
  ? `CX ${formatTokens(used)}/${formatTokens(context)} ${percent}% ${meter} ${detail} >= ${formatTokens(sessionLimit)} new session`
  : `CX ${formatTokens(used)}/${formatTokens(context)} ${percent}% ${meter} ${detail}`

const color = used >= sessionLimit ? '91' : used >= warningLimit ? '33' : '32'
console.log(`${color}\t${label}`)
