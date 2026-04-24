import type { L0DegradeReason, L0Event } from '../../../shared/types'
import { stripAnsi } from '../../approval-detector'
import {
  hasAssistantErrorShape,
  hasToolResultShape,
  hasToolUseShape,
  isIngestibleAssistantEnvelope,
  isKnownNoiseEnvelope,
  matchClaudeCodeFingerprint
} from '../fingerprint'
import { l0Telemetry } from '../telemetry'
import type { AdapterStatusSnapshot, IngestResult, L0Adapter } from './L0Adapter'

// Re-export so existing imports of IngestResult / AdapterStatusSnapshot from
// this module keep working after the interface extraction (Slice 1A).
export type { AdapterStatusSnapshot, IngestResult }

interface AdapterState {
  fingerprint?: string
  mode: 'awaiting-first-event' | 'active' | 'degraded'
  pending: string
  consecutiveDecodeErrors: number
  lastDegradeReason?: L0DegradeReason
  chunksSeenBeforeFirstEvent: number
}

const MAX_CONSECUTIVE_DECODE_ERRORS = 3
const MAX_PENDING_BYTES = 1_048_576 // 1 MB — bounds memory growth from missing newline (Security M-1)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createState(): AdapterState {
  return {
    mode: 'awaiting-first-event',
    pending: '',
    consecutiveDecodeErrors: 0,
    chunksSeenBeforeFirstEvent: 0
  }
}

function safeParse(rawLine: string): unknown | null {
  try {
    return JSON.parse(rawLine)
  } catch {
    return null
  }
}

function toL0Events(
  terminalId: string,
  payload: Record<string, unknown>,
  fingerprint: string
): L0Event[] {
  const observedAt = typeof payload.timestamp === 'string'
    ? Date.parse(payload.timestamp)
    : (typeof payload.timestamp === 'number' ? payload.timestamp : Date.now())

  if (hasToolUseShape(payload)) {
    const payloadRecord = payload as Record<string, unknown>
    const message = payloadRecord.message as Record<string, unknown>
    const content = Array.isArray(message.content) ? message.content : []
    const toolUse = content.find((item) => typeof item === 'object' && item !== null && (item as Record<string, unknown>).type === 'tool_use') as Record<string, unknown> | undefined
    const toolName = typeof toolUse?.name === 'string' ? toolUse.name : 'tool'

    return [{
      terminalId,
      vendor: 'claude-code',
      schemaFingerprint: fingerprint,
      eventKind: 'tool-use-pending',
      rawPayload: payload,
      observedAt,
      category: 'approval',
      summary: `${toolName} requested by Claude Code`,
      matchedText: toolName
    }]
  }

  if (hasAssistantErrorShape(payload)) {
    const payloadRecord = payload as Record<string, unknown>
    const message = payloadRecord.message as Record<string, unknown>
    const content = Array.isArray(message.content) ? message.content : []
    const firstText = content.find((item) => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).text === 'string') as Record<string, unknown> | undefined
    const detail = typeof firstText?.text === 'string'
      ? firstText.text
      : (typeof payloadRecord.error === 'string' ? payloadRecord.error : 'Claude Code reported an error')

    return [{
      terminalId,
      vendor: 'claude-code',
      schemaFingerprint: fingerprint,
      eventKind: 'error',
      rawPayload: payload,
      observedAt,
      category: 'error',
      summary: detail,
      matchedText: detail
    }]
  }

  if (hasToolResultShape(payload)) {
    const payloadRecord = payload as Record<string, unknown>
    const message = payloadRecord.message as Record<string, unknown>
    const content = Array.isArray(message.content) ? message.content : []
    const toolResult = content.find((item) => typeof item === 'object' && item !== null && (item as Record<string, unknown>).type === 'tool_result') as Record<string, unknown> | undefined
    const isError = toolResult?.is_error === true
    if (!isError) {
      return []
    }

    const detail = typeof toolResult.content === 'string'
      ? toolResult.content
      : 'Tool execution returned an error'

    return [{
      terminalId,
      vendor: 'claude-code',
      schemaFingerprint: fingerprint,
      eventKind: 'error',
      rawPayload: payload,
      observedAt,
      category: 'error',
      summary: detail,
      matchedText: detail
    }]
  }

  if (isIngestibleAssistantEnvelope(payload)) {
    return []
  }

  return []
}

export class CcStreamJsonAdapter implements L0Adapter {
  private stateByTerminalId = new Map<string, AdapterState>()

  /**
   * L0Adapter contract. Accepts stdout chunks (string) and delegates to
   * `ingestStdout`. Non-string inputs no-op so a misrouted hook/session-log
   * payload cannot crash the pipeline.
   */
  ingest(terminalId: string, input: unknown): IngestResult {
    if (typeof input !== 'string') {
      return { kind: 'noop', suppressApprovalDetector: false }
    }
    return this.ingestStdout(terminalId, stripAnsi(input))
  }

  ingestStdout(terminalId: string, chunk: string): IngestResult {
    const state = this.stateByTerminalId.get(terminalId) ?? createState()
    this.stateByTerminalId.set(terminalId, state)

    if (state.mode === 'degraded') {
      return { kind: 'noop', suppressApprovalDetector: false }
    }

    if (state.mode === 'awaiting-first-event') {
      state.chunksSeenBeforeFirstEvent += 1
    }

    if (Buffer.byteLength(state.pending) + Buffer.byteLength(chunk) > MAX_PENDING_BYTES) {
      state.mode = 'degraded'
      state.lastDegradeReason = 'unparseable-payload'
      state.pending = ''
      l0Telemetry.recordDegrade('unparseable-payload')
      return {
        kind: 'degrade',
        reason: 'unparseable-payload',
        fingerprintSeen: state.fingerprint,
        suppressApprovalDetector: false
      }
    }

    state.pending += chunk
    const lines = state.pending.split(/\r?\n/)
    state.pending = lines.pop() ?? ''

    const events: L0Event[] = []
    let suppressApprovalDetector = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) {
        continue
      }

      const parsed = safeParse(trimmed)
      if (parsed == null) {
        state.consecutiveDecodeErrors += 1
        l0Telemetry.recordConsecutiveDecodeError()
        if (state.consecutiveDecodeErrors >= MAX_CONSECUTIVE_DECODE_ERRORS) {
          state.mode = 'degraded'
          state.lastDegradeReason = 'consecutive-decode-errors'
          return {
            kind: 'degrade',
            reason: 'consecutive-decode-errors',
            fingerprintSeen: state.fingerprint,
            suppressApprovalDetector: false
          }
        }
        continue
      }

      state.consecutiveDecodeErrors = 0

      if (isKnownNoiseEnvelope(parsed)) {
        continue
      }

      const fingerprintMatch = matchClaudeCodeFingerprint(parsed)
      if (!fingerprintMatch) {
        l0Telemetry.recordInvariantCheck(false)
        continue
      }
      l0Telemetry.recordInvariantCheck(true)

      if (state.mode === 'awaiting-first-event') {
        state.mode = 'active'
        state.fingerprint = fingerprintMatch.fingerprint
        l0Telemetry.recordFirstEventWaitChunks(state.chunksSeenBeforeFirstEvent)
      }

      suppressApprovalDetector = true
      if (isRecord(parsed)) {
        events.push(...toL0Events(terminalId, parsed, state.fingerprint ?? fingerprintMatch.fingerprint))
      }
    }

    if (events.length > 0) {
      return {
        kind: 'event',
        events,
        suppressApprovalDetector
      }
    }

    return {
      kind: 'noop',
      suppressApprovalDetector
    }
  }

  reset(terminalId: string): void {
    this.stateByTerminalId.delete(terminalId)
  }

  dispose(): void {
    this.stateByTerminalId.clear()
  }

  /**
   * Return a read-only snapshot of per-terminal adapter state. Returns
   * `undefined` when the terminal has never been ingested, so callers can
   * infer an `'inactive'` L0 mode at the pipeline layer.
   */
  getStatus(terminalId: string): AdapterStatusSnapshot | undefined {
    const state = this.stateByTerminalId.get(terminalId)
    if (!state) {
      return undefined
    }
    return {
      mode: state.mode,
      fingerprint: state.fingerprint,
      lastDegradeReason: state.lastDegradeReason
    }
  }
}
