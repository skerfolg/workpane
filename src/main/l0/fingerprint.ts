import { createHash } from 'node:crypto'

export type DegradeReason =
  | 'invariant-mismatch'
  | 'unparseable-payload'
  | 'consecutive-decode-errors'
  | 'adapter-disabled'

export interface FingerprintMatch {
  fingerprint: string
  concreteKeys: string[]
}

type JsonRecord = Record<string, unknown>

const NOISE_EVENT_TYPES = new Set([
  'queue-operation',
  'attachment',
  'last-prompt',
  'file-history-snapshot'
])

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getMessageRecord(payload: JsonRecord): JsonRecord | null {
  return isRecord(payload.message) ? payload.message : null
}

function getContentArray(message: JsonRecord): JsonRecord[] {
  const content = message.content
  if (!Array.isArray(content)) {
    return []
  }
  return content.filter(isRecord)
}

function collectConcreteKeys(payload: JsonRecord): string[] {
  const keys = new Set<string>()
  keys.add(`root:${String(payload.type ?? 'unknown')}`)
  for (const key of Object.keys(payload)) {
    keys.add(`root.${key}`)
  }

  const message = getMessageRecord(payload)
  if (message) {
    for (const key of Object.keys(message)) {
      keys.add(`message.${key}`)
    }
    const content = getContentArray(message)
    for (const item of content) {
      const itemType = typeof item.type === 'string' ? item.type : 'unknown'
      keys.add(`content:${itemType}`)
      for (const key of Object.keys(item)) {
        keys.add(`content.${itemType}.${key}`)
      }
    }
  }

  return [...keys].sort()
}

export function isKnownNoiseEnvelope(payload: unknown): boolean {
  return isRecord(payload) && typeof payload.type === 'string' && NOISE_EVENT_TYPES.has(payload.type)
}

export function isIngestibleAssistantEnvelope(payload: unknown): payload is JsonRecord {
  if (!isRecord(payload) || payload.type !== 'assistant') {
    return false
  }

  const message = getMessageRecord(payload)
  return message?.role === 'assistant' && message.type === 'message'
}

export function isToolResultEnvelope(payload: unknown): payload is JsonRecord {
  if (!isRecord(payload) || payload.type !== 'user') {
    return false
  }

  const message = getMessageRecord(payload)
  const content = message ? getContentArray(message) : []
  return content.some((item) => item.type === 'tool_result' && typeof item.tool_use_id === 'string')
}

export function hasAssistantErrorShape(payload: unknown): payload is JsonRecord {
  return isIngestibleAssistantEnvelope(payload) && typeof (payload as JsonRecord).error === 'string'
}

export function hasToolUseShape(payload: unknown): payload is JsonRecord {
  if (!isIngestibleAssistantEnvelope(payload)) {
    return false
  }
  const message = getMessageRecord(payload)
  if (!message) {
    return false
  }
  return getContentArray(message).some(
    (item) => item.type === 'tool_use' && typeof item.id === 'string' && typeof item.name === 'string'
  )
}

export function hasToolResultShape(payload: unknown): payload is JsonRecord {
  return isToolResultEnvelope(payload)
}

export function isIngestibleEnvelope(payload: unknown): payload is JsonRecord {
  return isIngestibleAssistantEnvelope(payload) || isToolResultEnvelope(payload)
}

export function matchClaudeCodeFingerprint(payload: unknown): FingerprintMatch | null {
  if (!isIngestibleEnvelope(payload)) {
    return null
  }

  const keys = collectConcreteKeys(payload)
  const fingerprint = createHash('sha1')
    .update(`sf-2:${keys.join('|')}`)
    .digest('hex')
    .slice(0, 12)

  return {
    fingerprint,
    concreteKeys: keys
  }
}
