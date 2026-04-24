import type { L0Event, L0Status, L0Vendor, SessionMonitoringState } from '../../shared/types'
import type { IngestResult, L0Adapter } from './adapters/L0Adapter'
import { l0Telemetry } from './telemetry'

export interface L0PipelineResult {
  emittedEvents: number
  suppressApprovalDetector: boolean
}

export type L0StatusListener = (status: L0Status) => void

export class L0Pipeline {
  private readonly adapter: L0Adapter
  private readonly onMonitoringUpsert: (state: SessionMonitoringState) => void
  private readonly vendorByTerminalId = new Map<string, L0Vendor>()
  private readonly statusListeners = new Set<L0StatusListener>()
  private readonly lastBroadcastMode = new Map<string, string>()

  constructor(adapter: L0Adapter, onMonitoringUpsert: (state: SessionMonitoringState) => void) {
    this.adapter = adapter
    this.onMonitoringUpsert = onMonitoringUpsert
  }

  /**
   * Mark a terminal as vendor-hinted. Must be called before the first
   * `ingest()` for the L0 adapter to observe its chunks. Without a binding,
   * `getStatus()` reports `'inactive'` and `ingest()` is a no-op.
   */
  bindVendor(terminalId: string, vendor: L0Vendor): void {
    this.vendorByTerminalId.set(terminalId, vendor)
    // Invalidate broadcast cache so a re-bind always re-emits even if the
    // (mode, fingerprint, reason) tuple happens to match the prior emit
    // (Code-reviewer MEDIUM: broadcast key collapse on rebind).
    this.lastBroadcastMode.delete(terminalId)
    this.broadcastStatus(terminalId)
  }

  /**
   * Ingest raw input (adapter-specific shape: string chunk for stdout,
   * parsed payload object for hook/session-log). The bound adapter validates
   * and normalizes the input before emitting L0Events.
   */
  ingest(terminalId: string, input: unknown, workspacePath: string): L0PipelineResult {
    const vendor = this.vendorByTerminalId.get(terminalId)
    if (!vendor) {
      return { emittedEvents: 0, suppressApprovalDetector: false }
    }
    const ingestStartedAt = performance.now()
    const result = this.adapter.ingest(terminalId, input)
    if (result.kind === 'degrade') {
      l0Telemetry.recordDegrade(result.reason)
    }
    const pipelineResult = this.handleResult(result, workspacePath, vendor, ingestStartedAt)
    this.broadcastStatus(terminalId)
    return pipelineResult
  }

  reset(terminalId: string): void {
    this.adapter.reset(terminalId)
    this.vendorByTerminalId.delete(terminalId)
    this.lastBroadcastMode.delete(terminalId)
  }

  dispose(): void {
    this.adapter.dispose()
    this.vendorByTerminalId.clear()
    this.statusListeners.clear()
    this.lastBroadcastMode.clear()
  }

  getStatus(terminalId: string): L0Status {
    const vendor = this.vendorByTerminalId.get(terminalId)
    if (!vendor) {
      return { terminalId, mode: 'inactive' }
    }
    const snapshot = this.adapter.getStatus(terminalId)
    return {
      terminalId,
      vendor,
      mode: snapshot?.mode ?? 'awaiting-first-event',
      fingerprint: snapshot?.fingerprint,
      lastDegradeReason: snapshot?.lastDegradeReason
    }
  }

  onStatusChanged(listener: L0StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  private broadcastStatus(terminalId: string): void {
    const status = this.getStatus(terminalId)
    const key = `${status.mode}|${status.fingerprint ?? ''}|${status.lastDegradeReason ?? ''}`
    if (this.lastBroadcastMode.get(terminalId) === key) {
      return
    }
    this.lastBroadcastMode.set(terminalId, key)
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }

  private handleResult(
    result: IngestResult,
    workspacePath: string,
    vendor: L0Vendor,
    ingestStartedAt: number
  ): L0PipelineResult {
    if (result.kind === 'degrade') {
      return {
        emittedEvents: 0,
        suppressApprovalDetector: false
      }
    }

    if (result.kind === 'noop') {
      return {
        emittedEvents: 0,
        suppressApprovalDetector: result.suppressApprovalDetector
      }
    }

    for (const event of result.events) {
      this.onMonitoringUpsert(this.toMonitoringState(event, workspacePath))
    }
    // Record once per ingest call so the histogram is not skewed by per-event
    // accumulation when multiple events come out of a single chunk
    // (Code-reviewer MEDIUM: handleResult emit latency).
    if (result.events.length > 0) {
      l0Telemetry.recordEventEmitted(vendor, performance.now() - ingestStartedAt)
    }

    return {
      emittedEvents: result.events.length,
      suppressApprovalDetector: result.suppressApprovalDetector
    }
  }

  private toMonitoringState(event: L0Event, workspacePath: string): SessionMonitoringState {
    return {
      terminalId: event.terminalId,
      workspacePath,
      patternName: `${event.vendor}:${event.eventKind}`,
      matchedText: event.matchedText,
      status: 'attention-needed',
      category: event.category,
      confidence: 'high',
      source: 'l0-vendor-event',
      summary: event.summary,
      timestamp: event.observedAt
    }
  }
}
