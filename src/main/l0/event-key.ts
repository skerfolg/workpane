import crypto from 'node:crypto'
import type { L0Event } from '../../shared/types'

/**
 * Event key derivation for cross-source dedup (RW-C).
 *
 * Hook and session-log adapters can both emit L0Events for the same
 * logical CC tool call because they observe different surfaces. This
 * module produces a stable key that collapses both observations into
 * a single dedup slot.
 *
 * Three-tier strategy (per Plan v3 Slice 2 Phase 2 D2):
 *   1. `id`         — session-log message.content[*].id when present
 *      (hook payloads do not expose this consistently, so this tier
 *      only strengthens dedup from session-log side; hook side relies
 *      on tier 2 matching the same content)
 *   2. `content`    — tool_name + canonical JSON of tool_input.
 *      Identical across both sources by construction.
 *   3. `kind-time`  — for errors / lifecycle / anything without the
 *      above signals. event-kind + summary + 1s time bucket.
 *
 * The accompanying pipeline dedup uses a 2-second window, so two
 * genuinely separate calls with the same (tool_name, input) within
 * 2s would collapse. That is an accepted tradeoff per RW-R3 and
 * will surface via l0_dedup_dropped_by_source telemetry if abused.
 */

export type EventKeyTier = 'id' | 'content' | 'kind-time'

export type EventKeySource = 'hook' | 'session-log' | 'stdout'

export interface EventKeyResult {
  key: string
  tier: EventKeyTier
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extract a tool_use id when the raw payload is an assistant envelope
 * (session-log) or when the hook payload ships an explicit `tool_use_id`
 * field. Hook payloads observed in the Slice 0 spike do not carry it, so
 * this commonly returns null for the hook source.
 */
function extractToolUseId(event: L0Event): string | null {
  const payload = event.rawPayload
  if (!isRecord(payload)) return null

  if (typeof payload.tool_use_id === 'string' && payload.tool_use_id) {
    return payload.tool_use_id
  }

  const message = payload.message
  if (isRecord(message)) {
    const content = message.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          isRecord(block) &&
          (block.type === 'tool_use' || block.type === 'tool_result') &&
          typeof block.id === 'string' &&
          block.id
        ) {
          return block.id
        }
      }
    }
  }

  return null
}

/**
 * Canonical JSON stringify — keys sorted at every nesting depth so the
 * hash is deterministic across sources that may serialize objects with
 * different key order.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(',')}}`
}

function sha1(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex')
}

/**
 * Extract the (tool_name, tool_input) pair from whichever raw shape
 * surfaced the event. Returns null when the event is not tool-use
 * shaped.
 */
function extractContentSignature(event: L0Event): string | null {
  if (event.eventKind !== 'tool-use-pending') {
    return null
  }

  const payload = event.rawPayload
  if (!isRecord(payload)) return null

  // Hook payload shape: { hook_event_name, tool_name, tool_input, ... }
  if (typeof payload.tool_name === 'string') {
    const input = isRecord(payload.tool_input) ? payload.tool_input : {}
    return sha1(`${payload.tool_name}|${canonicalStringify(input)}`)
  }

  // Session-log / stdout shape: { type: 'assistant', message: { content: [...] } }
  const message = payload.message
  if (isRecord(message)) {
    const content = message.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (isRecord(block) && block.type === 'tool_use' && typeof block.name === 'string') {
          const input = isRecord(block.input) ? block.input : {}
          return sha1(`${block.name}|${canonicalStringify(input)}`)
        }
      }
    }
  }

  return null
}

/**
 * One-second bucket — events within the same wall-clock second collapse
 * under the kind-time tier.
 */
function bucketSeconds(observedAt: number): number {
  return Math.floor(observedAt / 1000)
}

export function deriveEventKey(
  event: L0Event,
  _source: EventKeySource = 'hook'
): EventKeyResult {
  // For tool-use events content-tier ALWAYS wins over id-tier. The hook
  // payload does not expose tool_use_id at a stable path (spike data
  // confirmed this), so using id-tier when only the session-log has
  // the id would break cross-source dedup. Content-tier is derivable
  // from both surfaces identically by construction (tool_name +
  // canonical(tool_input)).
  const contentSig = extractContentSignature(event)
  if (contentSig !== null) {
    return { key: `${event.eventKind}:content:${contentSig}`, tier: 'content' }
  }

  // For non-tool-use events (errors, lifecycle, tool_result), an id
  // remains useful when the envelope provides one.
  const id = extractToolUseId(event)
  if (id !== null) {
    return { key: `${event.eventKind}:id:${id}`, tier: 'id' }
  }

  const bucket = bucketSeconds(event.observedAt)
  // Hash the summary to avoid including long error messages verbatim.
  const summaryDigest = sha1(event.summary ?? '')
  return { key: `${event.eventKind}:kind:${summaryDigest}:${bucket}`, tier: 'kind-time' }
}

/**
 * Bounded dedup map specialized for L0 events. Tracks (key → timestamp
 * of first observation) and treats a second observation within the
 * window as a duplicate. Windows are cheap to evaluate because map
 * entries expire lazily on insert.
 */
export class EventDedupWindow {
  private readonly windowMs: number
  private readonly entries = new Map<string, number>()
  private readonly perTerminalKeys = new Map<string, Set<string>>()

  constructor(windowMs = 2_000) {
    this.windowMs = windowMs
  }

  /** Returns true when the event should be emitted; false when it is a duplicate. */
  shouldEmit(terminalId: string, key: string, now = Date.now()): boolean {
    const fullKey = `${terminalId}|${key}`
    const priorTs = this.entries.get(fullKey)
    if (priorTs !== undefined && now - priorTs <= this.windowMs) {
      return false
    }
    this.entries.set(fullKey, now)
    let terminalSet = this.perTerminalKeys.get(terminalId)
    if (!terminalSet) {
      terminalSet = new Set<string>()
      this.perTerminalKeys.set(terminalId, terminalSet)
    }
    terminalSet.add(fullKey)
    this.vacuum(now)
    return true
  }

  clearTerminal(terminalId: string): void {
    const keys = this.perTerminalKeys.get(terminalId)
    if (!keys) return
    for (const fullKey of keys) {
      this.entries.delete(fullKey)
    }
    this.perTerminalKeys.delete(terminalId)
  }

  /** Test-only: inspect current size. */
  get sizeForTest(): number {
    return this.entries.size
  }

  private vacuum(now: number): void {
    // Cheap linear sweep; map sizes stay small (O(events per 2s window)).
    for (const [fullKey, ts] of this.entries) {
      if (now - ts > this.windowMs * 2) {
        this.entries.delete(fullKey)
      }
    }
  }
}
