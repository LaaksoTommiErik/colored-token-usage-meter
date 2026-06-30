#!/usr/bin/env node

const fs = require('fs')

const DEFAULT_WARNING_LIMIT = 90000
const DEFAULT_SESSION_LIMIT = 100000

const warningLimit = positiveFiniteFromEnv('OPENCLAW_PROMPT_WARNING_LIMIT', DEFAULT_WARNING_LIMIT)
const sessionLimit = positiveFiniteFromEnv('OPENCLAW_PROMPT_SOFT_LIMIT', DEFAULT_SESSION_LIMIT)

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

function positiveFiniteFromEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function validNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function readHookInput() {
  let stat
  try {
    stat = fs.fstatSync(0)
  } catch {
    return null
  }

  if (stat.isCharacterDevice()) return null

  let text
  try {
    text = fs.readFileSync(0, 'utf8')
  } catch {
    return null
  }

  if (!text.trim()) return null

  try {
    const input = JSON.parse(text)
    if (input && typeof input === 'object' && typeof input.transcript_path === 'string' && input.transcript_path.length > 0) {
      return input
    }
  } catch {
    return null
  }

  return null
}

function lastValidTokenCountInFile(file) {
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

    if (event?.type !== 'event_msg' || event.payload?.type !== 'token_count') {
      continue
    }

    const tokenCount = parseTokenCount(event.payload.info)
    if (tokenCount) return tokenCount
  }
  return null
}

function parseTokenCount(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null
  if (!validPositiveNumber(info.model_context_window)) return null

  const last = info.last_token_usage
  if (!last || typeof last !== 'object' || Array.isArray(last)) return null

  const required = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'total_tokens']
  if (!required.every((field) => validNonNegativeNumber(last[field]))) return null

  return {
    used: last.input_tokens,
    cached: last.cached_input_tokens,
    output: last.output_tokens,
    total: last.total_tokens,
    context: info.model_context_window,
  }
}

const hookInput = readHookInput()
if (!hookInput) process.exit(0)

const tokenCount = lastValidTokenCountInFile(hookInput.transcript_path)
if (!tokenCount) process.exit(0)

const { used, cached, output, total, context } = tokenCount
const percent = Math.round((used / context) * 100)
const overLimit = used >= sessionLimit
const meter = formatMeter(used)
const detail = `in ${formatTokens(used)} cached ${formatTokens(cached)} out ${formatTokens(output)} total ${formatTokens(total)}`

const label = overLimit
  ? `CX ${formatTokens(used)}/${formatTokens(context)} ${percent}% ${meter} ${detail} >= ${formatTokens(sessionLimit)} new session`
  : `CX ${formatTokens(used)}/${formatTokens(context)} ${percent}% ${meter} ${detail}`

const color = used >= sessionLimit ? '91' : used >= warningLimit ? '33' : '32'
console.log(`${color}	${label}`)
