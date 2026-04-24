import type { L0DegradeReason, L0Event, L0Mode } from '../../../shared/types'
import type { DegradeReason } from '../fingerprint'

export type IngestResult =
  | {
    kind: 'event'
    events: L0Event[]
    suppressApprovalDetector: boolean
  }
  | {
    kind: 'noop'
    suppressApprovalDetector: boolean
  }
  | {
    kind: 'degrade'
    reason: DegradeReason
    fingerprintSeen?: string
    suppressApprovalDetector: false
  }

export interface AdapterStatusSnapshot {
  mode: L0Mode
  fingerprint?: string
  lastDegradeReason?: L0DegradeReason
}

/**
 * L0Adapter — transport-neutral L0 event extraction contract.
 *
 * Each implementation owns the parsing logic for its source:
 * - `CcStreamJsonAdapter` (stdout): string chunks with ANSI codes, partial lines
 * - `CcHookAdapter` (Option A): complete JSON payload per hook invocation
 * - `CcSessionLogAdapter` (Option E): complete jsonl line per file append
 *
 * Pipeline depends only on this contract, so swapping / combining adapters
 * does not require pipeline changes.
 */
export interface L0Adapter {
  /**
   * Consume input from this adapter's source and emit any derived L0Events.
   * Input shape is adapter-specific; implementations must validate.
   */
  ingest(terminalId: string, input: unknown): IngestResult
  reset(terminalId: string): void
  dispose(): void
  getStatus(terminalId: string): AdapterStatusSnapshot | undefined
}
