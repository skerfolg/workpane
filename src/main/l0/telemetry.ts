import type { L0DegradeReason, L0Vendor } from '../../shared/types'

/**
 * In-memory telemetry sink for M1c L0 pipeline observability.
 *
 * Scope:
 * - Counters (monotonic): l0_events_emitted, l0_degrade_triggered,
 *   l0_consecutive_decode_errors, l0_invariant_pass_count, l0_invariant_fail_count.
 * - Histograms (bounded ring buffer): l0_first_event_wait_chunks,
 *   l0_emit_latency_ms (used by tests/perf/l0-latency.spec.ts).
 *
 * Out of scope:
 * - External sink (disk / Prometheus / OTEL). Slice 3 micro-decision defers
 *   this; values are read by perf tests and the (future) observability
 *   dashboard via `snapshot()`.
 */

export interface HistogramSample {
  value: number
  recordedAt: number
}

export interface HistogramSummary {
  count: number
  min: number
  max: number
  p50: number
  p95: number
  p99: number
  mean: number
}

export interface L0TelemetrySnapshot {
  counters: {
    eventsEmitted: number
    degradeTriggered: Record<L0DegradeReason, number>
    invariantPassCount: number
    invariantFailCount: number
    consecutiveDecodeErrors: number
  }
  histograms: {
    firstEventWaitChunks: HistogramSummary
    emitLatencyMs: HistogramSummary
  }
  invariantPassRate: number
}

const HISTOGRAM_CAPACITY = 2048

const EMPTY_SUMMARY: HistogramSummary = {
  count: 0,
  min: 0,
  max: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  mean: 0
}

class Histogram {
  private samples: number[] = []
  private writeIndex = 0

  record(value: number): void {
    if (!Number.isFinite(value) || value < 0) {
      return
    }
    if (this.samples.length < HISTOGRAM_CAPACITY) {
      this.samples.push(value)
      return
    }
    this.samples[this.writeIndex] = value
    this.writeIndex = (this.writeIndex + 1) % HISTOGRAM_CAPACITY
  }

  reset(): void {
    this.samples = []
    this.writeIndex = 0
  }

  summary(): HistogramSummary {
    if (this.samples.length === 0) {
      return EMPTY_SUMMARY
    }
    const sorted = [...this.samples].sort((a, b) => a - b)
    const count = sorted.length
    const sum = sorted.reduce((acc, v) => acc + v, 0)
    const percentile = (p: number): number => {
      const index = Math.min(count - 1, Math.floor(p * count))
      return sorted[index]
    }
    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      mean: sum / count
    }
  }
}

export class L0Telemetry {
  private eventsEmitted = 0
  private invariantPassCount = 0
  private invariantFailCount = 0
  private consecutiveDecodeErrors = 0
  private readonly degradeTriggered: Record<L0DegradeReason, number> = {
    'invariant-mismatch': 0,
    'unparseable-payload': 0,
    'consecutive-decode-errors': 0,
    'adapter-disabled': 0
  }
  private readonly firstEventWaitChunks = new Histogram()
  private readonly emitLatencyMs = new Histogram()

  recordEventEmitted(vendor: L0Vendor, latencyMs: number): void {
    void vendor
    this.eventsEmitted += 1
    this.emitLatencyMs.record(latencyMs)
  }

  recordInvariantCheck(passed: boolean): void {
    if (passed) {
      this.invariantPassCount += 1
    } else {
      this.invariantFailCount += 1
    }
  }

  recordFirstEventWaitChunks(chunkCount: number): void {
    this.firstEventWaitChunks.record(chunkCount)
  }

  recordDegrade(reason: L0DegradeReason): void {
    this.degradeTriggered[reason] += 1
  }

  recordConsecutiveDecodeError(): void {
    this.consecutiveDecodeErrors += 1
  }

  snapshot(): L0TelemetrySnapshot {
    const totalChecks = this.invariantPassCount + this.invariantFailCount
    return {
      counters: {
        eventsEmitted: this.eventsEmitted,
        degradeTriggered: { ...this.degradeTriggered },
        invariantPassCount: this.invariantPassCount,
        invariantFailCount: this.invariantFailCount,
        consecutiveDecodeErrors: this.consecutiveDecodeErrors
      },
      histograms: {
        firstEventWaitChunks: this.firstEventWaitChunks.summary(),
        emitLatencyMs: this.emitLatencyMs.summary()
      },
      invariantPassRate: totalChecks === 0 ? 1 : this.invariantPassCount / totalChecks
    }
  }

  reset(): void {
    this.eventsEmitted = 0
    this.invariantPassCount = 0
    this.invariantFailCount = 0
    this.consecutiveDecodeErrors = 0
    for (const reason of Object.keys(this.degradeTriggered) as L0DegradeReason[]) {
      this.degradeTriggered[reason] = 0
    }
    this.firstEventWaitChunks.reset()
    this.emitLatencyMs.reset()
  }
}

/**
 * Shared singleton used by L0Pipeline / L0 adapters for in-process
 * accounting. Tests can import this directly and call `reset()` to
 * isolate between cases.
 */
export const l0Telemetry = new L0Telemetry()
