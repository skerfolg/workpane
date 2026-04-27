import type { L0DegradeReason, L0Event } from '../../../shared/types'
import { l0Telemetry } from '../telemetry'
import type { AdapterStatusSnapshot, IngestResult, L0Adapter } from './L0Adapter'

/**
 * CcHookAdapter — Option A (primary) L0Adapter.
 *
 * Consumes one parsed Claude Code hook payload per ingest() call. The
 * transport is the hook-server IPC; the adapter itself is transport-neutral
 * and can run against test fixtures with zero I/O.
 *
 * L0 scope (this adapter): emit L0Events for the two shapes that map to
 * the existing pipeline contract —
 *   - PreToolUse  → tool-use-pending (approval category)
 *   - PostToolUse (is_error) → error
 * All other hook events (Session lifecycle, UserPromptSubmit, Stop,
 * PostToolUse success) stay as no-ops at L0 and are handled by the L1
 * classifier downstream per Plan v3 Slice 1E. Keeping L0 narrow mirrors
 * CcStreamJsonAdapter / CcSessionLogAdapter semantics and lets the status
 * badge's "active" transition happen on the first meaningful event.
 */

const HOOK_FINGERPRINT = 'cc:hook:v1'

interface HookPayload {
  hook_event_name?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: {
    is_error?: boolean
    content?: unknown
    type?: string
  }
  session_id?: string
  cwd?: string
  permission_mode?: string
  timestamp?: string | number
}

interface AdapterState {
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

function parseObservedAt(payload: HookPayload): number {
  if (typeof payload.timestamp === 'number') {
    return payload.timestamp
  }
  if (typeof payload.timestamp === 'string') {
    const parsed = Date.parse(payload.timestamp)
    return Number.isFinite(parsed) ? parsed : Date.now()
  }
  return Date.now()
}

function toL0EventsFromHook(terminalId: string, payload: HookPayload): L0Event[] {
  const observedAt = parseObservedAt(payload)
  const event = payload.hook_event_name

  if (event === 'PreToolUse') {
    const toolName = payload.tool_name ?? 'tool'
    return [{
      terminalId,
      vendor: 'claude-code',
      schemaFingerprint: HOOK_FINGERPRINT,
      eventKind: 'tool-use-pending',
      rawPayload: payload as Record<string, unknown>,
      observedAt,
      category: 'approval',
      summary: `${toolName} requested by Claude Code`,
      matchedText: toolName
    }]
  }

  if (event === 'PostToolUse' && payload.tool_response?.is_error === true) {
    const detail = typeof payload.tool_response.content === 'string'
      ? payload.tool_response.content
      : (payload.tool_response.type ?? 'Tool execution returned an error')
    return [{
      terminalId,
      vendor: 'claude-code',
      schemaFingerprint: HOOK_FINGERPRINT,
      eventKind: 'error',
      rawPayload: payload as Record<string, unknown>,
      observedAt,
      category: 'error',
      summary: detail,
      matchedText: detail
    }]
  }

  return []
}

export class CcHookAdapter implements L0Adapter {
  private stateByTerminalId = new Map<string, AdapterState>()

  /**
   * Accepts either a parsed hook payload object or its JSON string form.
   * Non-object / non-JSON input no-ops so a bad frame cannot crash the
   * pipeline (RCE-adjacent hardening; hook IPC lives in hook-server).
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

    if (typeof payload.hook_event_name !== 'string') {
      return { kind: 'noop', suppressApprovalDetector: false }
    }

    if (state.mode === 'awaiting-first-event') {
      state.envelopesSeenBeforeFirstEvent += 1
      state.mode = 'active'
      l0Telemetry.recordFirstEventWaitChunks(state.envelopesSeenBeforeFirstEvent)
    }

    l0Telemetry.recordInvariantCheck(true)

    const events = toL0EventsFromHook(terminalId, payload)
    const suppressApprovalDetector = true

    if (events.length > 0) {
      return { kind: 'event', events, suppressApprovalDetector }
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
      fingerprint: HOOK_FINGERPRINT,
      lastDegradeReason: state.lastDegradeReason
    }
  }

  private coercePayload(input: unknown): HookPayload | null {
    if (isRecord(input)) {
      return input as HookPayload
    }
    if (typeof input === 'string') {
      const trimmed = input.trim()
      if (trimmed.length === 0) {
        return null
      }
      try {
        const parsed: unknown = JSON.parse(trimmed)
        return isRecord(parsed) ? (parsed as HookPayload) : null
      } catch {
        return null
      }
    }
    return null
  }
}
