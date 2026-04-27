import type { L0DegradeReason, L0Event } from '../../../shared/types'
import {
  isIngestibleAssistantEnvelope,
  isKnownNoiseEnvelope,
  matchClaudeCodeFingerprint
} from '../fingerprint'
import { l0Telemetry } from '../telemetry'
import type { AdapterStatusSnapshot, IngestResult, L0Adapter } from './L0Adapter'
import { toL0Events } from './cc-stream-json-adapter'

/**
 * CcSessionLogAdapter — Option E (fallback / default) L0Adapter.
 *
 * Consumes already-parsed session-log entries (one jsonl line = one
 * payload object). The tailer (session-log-tailer.ts) owns the file I/O
 * and passes parsed objects here, which lets this adapter stay pure +
 * testable without touching disk.
 *
 * Shares fingerprint + toL0Events with CcStreamJsonAdapter since the
 * session log emits the same assistant / tool_use / tool_result envelope
 * shape. The adapter layer only differs in input semantics (one envelope
 * per ingest() call instead of a byte stream).
 *
 * Latency posture per Plan v3: p95 was 972ms on Windows in the Slice 0
 * spike, so this adapter is positioned as fallback / default. It is
 * suitable for L-summary / L-insight and history scrubbing; Option A
 * hook IPC remains primary for L-state real-time approval detection.
 */

interface AdapterState {
  fingerprint?: string
  mode: 'awaiting-first-event' | 'active' | 'degraded'
  lastDegradeReason?: L0DegradeReason
  envelopesSeenBeforeFirstEvent: number
}

function createState(): AdapterState {
  return {
    mode: 'awaiting-first-event',
    envelopesSeenBeforeFirstEvent: 0
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class CcSessionLogAdapter implements L0Adapter {
  private stateByTerminalId = new Map<string, AdapterState>()

  /**
   * Accepts either a parsed envelope object (preferred) or a single
   * jsonl line string (convenience — tailer typically parses upstream
   * so the type discriminator only mis-routes on bugs).
   */
  ingest(terminalId: string, input: unknown): IngestResult {
    const state = this.stateByTerminalId.get(terminalId) ?? createState()
    this.stateByTerminalId.set(terminalId, state)

    if (state.mode === 'degraded') {
      return { kind: 'noop', suppressApprovalDetector: false }
    }

    const payload = this.coercePayload(input)
    if (!payload) {
      return { kind: 'noop', suppressApprovalDetector: false }
    }

    if (state.mode === 'awaiting-first-event') {
      state.envelopesSeenBeforeFirstEvent += 1
    }

    if (isKnownNoiseEnvelope(payload)) {
      return { kind: 'noop', suppressApprovalDetector: false }
    }

    const fingerprintMatch = matchClaudeCodeFingerprint(payload)
    if (!fingerprintMatch) {
      l0Telemetry.recordInvariantCheck(false)
      return { kind: 'noop', suppressApprovalDetector: false }
    }
    l0Telemetry.recordInvariantCheck(true)

    if (state.mode === 'awaiting-first-event') {
      state.mode = 'active'
      state.fingerprint = fingerprintMatch.fingerprint
      l0Telemetry.recordFirstEventWaitChunks(state.envelopesSeenBeforeFirstEvent)
    }

    const suppressApprovalDetector = true

    if (isIngestibleAssistantEnvelope(payload)) {
      const events = toL0Events(
        terminalId,
        payload,
        state.fingerprint ?? fingerprintMatch.fingerprint
      )
      if (events.length > 0) {
        return { kind: 'event', events, suppressApprovalDetector }
      }
    }

    return { kind: 'noop', suppressApprovalDetector }
  }

  reset(terminalId: string): void {
    this.stateByTerminalId.delete(terminalId)
  }

  dispose(): void {
    this.stateByTerminalId.clear()
  }

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

  private coercePayload(input: unknown): Record<string, unknown> | null {
    if (isRecord(input)) {
      return input
    }
    if (typeof input === 'string') {
      const trimmed = input.trim()
      if (trimmed.length === 0) {
        return null
      }
      try {
        const parsed: unknown = JSON.parse(trimmed)
        return isRecord(parsed) ? parsed : null
      } catch {
        return null
      }
    }
    return null
  }
}
