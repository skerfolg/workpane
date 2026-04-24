import type { L0Event, L0Status, L0Vendor, SessionMonitoringState } from '../../shared/types'
import type { IngestResult, L0Adapter } from './adapters/L0Adapter'
import { deriveEventKey, EventDedupWindow, type EventKeySource } from './event-key'
import { l0Telemetry } from './telemetry'

export interface L0PipelineResult {
  emittedEvents: number
  suppressApprovalDetector: boolean
}

export type L0StatusListener = (status: L0Status) => void

export class L0Pipeline {
  private readonly defaultAdapter: L0Adapter
  private readonly onMonitoringUpsert: (state: SessionMonitoringState) => void
  private readonly vendorByTerminalId = new Map<string, L0Vendor>()
  private readonly statusListeners = new Set<L0StatusListener>()
  private readonly lastBroadcastMode = new Map<string, string>()
  // RW-A: optional per-terminal adapter override. When absent, the default
  // adapter from the constructor is used (preserves existing callers).
  private readonly adapterByTerminalId = new Map<string, L0Adapter>()
  // RW-C: cross-source dedup so hook + session-log cannot emit the same
  // event twice. Window keyed by (terminalId, eventKey).
  private readonly dedupWindow = new EventDedupWindow()
  // RW-C: per-terminal source tag so we bump the right telemetry bucket
  // when a duplicate is dropped. setAdapterFor sets this based on the
  // adapter type; default adapter is 'stdout'.
  private readonly sourceTagByTerminalId = new Map<string, EventKeySource>()

  constructor(adapter: L0Adapter, onMonitoringUpsert: (state: SessionMonitoringState) => void) {
    this.defaultAdapter = adapter
    this.onMonitoringUpsert = onMonitoringUpsert
  }

  /**
   * RW-A: bind a dedicated adapter to a single terminal. Used by
   * terminal-manager when it knows the terminal runs Claude Code with a
   * hook server or session-log tailer that feeds the pipeline via ingest
   * with source-shaped payload objects. Default adapter is preserved for
   * terminals that have no override.
   * `source` (RW-C) tags which side of A/E this override corresponds to
   * so dedup telemetry is accurate when an event is dropped.
   */
  setAdapterFor(terminalId: string, adapter: L0Adapter, source: EventKeySource = 'hook'): void {
    this.adapterByTerminalId.set(terminalId, adapter)
    this.sourceTagByTerminalId.set(terminalId, source)
    // Broadcast so listeners pick up any difference in the adapter's
    // initial getStatus snapshot (e.g. freshly constructed hook adapter
    // reports 'awaiting-first-event').
    this.lastBroadcastMode.delete(terminalId)
    this.broadcastStatus(terminalId)
  }

  /**
   * RW-A: drop the per-terminal adapter override, returning the terminal
   * to the default adapter. Disposes the per-terminal adapter to release
   * any state it held for this id.
   */
  clearAdapterFor(terminalId: string): void {
    const adapter = this.adapterByTerminalId.get(terminalId)
    if (!adapter) {
      return
    }
    try {
      adapter.reset(terminalId)
    } catch {
      // Best-effort cleanup; never let an adapter reset failure leak
      // through the pipeline boundary.
    }
    this.adapterByTerminalId.delete(terminalId)
    this.sourceTagByTerminalId.delete(terminalId)
    this.lastBroadcastMode.delete(terminalId)
    this.broadcastStatus(terminalId)
  }

  private adapterFor(terminalId: string): L0Adapter {
    return this.adapterByTerminalId.get(terminalId) ?? this.defaultAdapter
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
   * `source` lets callers tell the dedup layer where this input came from
   * (hook vs session-log vs stdout) so telemetry buckets are correct.
   */
  ingest(
    terminalId: string,
    input: unknown,
    workspacePath: string,
    source?: EventKeySource
  ): L0PipelineResult {
    const vendor = this.vendorByTerminalId.get(terminalId)
    if (!vendor) {
      return { emittedEvents: 0, suppressApprovalDetector: false }
    }
    const effectiveSource = source ?? this.sourceTagByTerminalId.get(terminalId) ?? 'stdout'
    const ingestStartedAt = performance.now()
    const result = this.adapterFor(terminalId).ingest(terminalId, input)
    if (result.kind === 'degrade') {
      l0Telemetry.recordDegrade(result.reason)
    }
    const pipelineResult = this.handleResult(
      result,
      workspacePath,
      vendor,
      ingestStartedAt,
      terminalId,
      effectiveSource
    )
    this.broadcastStatus(terminalId)
    return pipelineResult
  }

  /**
   * RW-E helper: feed already-parsed L0Events through the dedup + upsert
   * path without invoking any adapter. Used when two sources must share
   * the same dedup window but each has its own parsing pipeline (e.g.
   * the session-log tailer emits parsed envelopes while the hook
   * adapter stays installed as the per-terminal override).
   */
  ingestEvents(
    terminalId: string,
    events: L0Event[],
    workspacePath: string,
    source: EventKeySource
  ): L0PipelineResult {
    const vendor = this.vendorByTerminalId.get(terminalId)
    if (!vendor) {
      return { emittedEvents: 0, suppressApprovalDetector: false }
    }
    const ingestStartedAt = performance.now()
    const emitted: L0Event[] = []
    for (const event of events) {
      const { tier, key } = deriveEventKey(event, source)
      if (this.dedupWindow.shouldEmit(terminalId, key)) {
        emitted.push(event)
        this.onMonitoringUpsert(this.toMonitoringState(event, workspacePath))
        l0Telemetry.recordDedupKeyTier(tier)
      } else {
        l0Telemetry.recordDedupDropped(source)
      }
    }
    if (emitted.length > 0) {
      l0Telemetry.recordEventEmitted(vendor, performance.now() - ingestStartedAt)
    }
    this.broadcastStatus(terminalId)
    return { emittedEvents: emitted.length, suppressApprovalDetector: emitted.length > 0 }
  }

  reset(terminalId: string): void {
    this.defaultAdapter.reset(terminalId)
    const override = this.adapterByTerminalId.get(terminalId)
    if (override) {
      try {
        override.reset(terminalId)
      } catch {
        // Swallow; reset is best-effort cleanup.
      }
      this.adapterByTerminalId.delete(terminalId)
    }
    this.vendorByTerminalId.delete(terminalId)
    this.sourceTagByTerminalId.delete(terminalId)
    this.dedupWindow.clearTerminal(terminalId)
    this.lastBroadcastMode.delete(terminalId)
  }

  dispose(): void {
    this.defaultAdapter.dispose()
    for (const adapter of this.adapterByTerminalId.values()) {
      try {
        adapter.dispose()
      } catch {
        // Continue tearing down the rest.
      }
    }
    this.adapterByTerminalId.clear()
    this.vendorByTerminalId.clear()
    this.statusListeners.clear()
    this.lastBroadcastMode.clear()
  }

  getStatus(terminalId: string): L0Status {
    const vendor = this.vendorByTerminalId.get(terminalId)
    if (!vendor) {
      return { terminalId, mode: 'inactive' }
    }
    const snapshot = this.adapterFor(terminalId).getStatus(terminalId)
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
    ingestStartedAt: number,
    terminalId: string,
    source: EventKeySource
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

    // RW-C: filter out duplicates across sources before the monitoring
    // callback fires. Dropped events bump the per-source counter so we
    // can see which side arrived second.
    const emittedEvents: L0Event[] = []
    for (const event of result.events) {
      const { tier, key } = deriveEventKey(event, source)
      if (this.dedupWindow.shouldEmit(terminalId, key)) {
        emittedEvents.push(event)
        this.onMonitoringUpsert(this.toMonitoringState(event, workspacePath))
        l0Telemetry.recordDedupKeyTier(tier)
      } else {
        l0Telemetry.recordDedupDropped(source)
      }
    }
    if (emittedEvents.length > 0) {
      l0Telemetry.recordEventEmitted(vendor, performance.now() - ingestStartedAt)
    }

    return {
      emittedEvents: emittedEvents.length,
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
