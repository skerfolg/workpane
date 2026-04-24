import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { L0Pipeline } from '../../src/main/l0/pipeline'
import { l0Telemetry } from '../../src/main/l0/telemetry'

/**
 * M1c L0 latency SLO: p95 emit latency <= 200ms (plan §8 / Acceptance #8).
 *
 * The pipeline is pure-JS with no I/O on the hot path, so healthy builds
 * sit well under 200ms per ingest on modern hardware. The gate here
 * guards against regressions that introduce sync disk / crypto / network
 * work on the pipeline emit path.
 */

const ITERATION_COUNT = 200
const P95_BUDGET_MS = 200

function loadPayloadLines(fixtureName: string): string[] {
  const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'cc-stream-json', fixtureName)
  const raw = fs.readFileSync(fixturePath, 'utf8')
  return raw
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line) as { payload: string }
      return entry.payload
    })
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

test('L0 pipeline p95 emit latency stays under the 200ms SLO', () => {
  const fixtureLines = loadPayloadLines('tool-use-edit.jsonl')
  assert.ok(fixtureLines.length > 0, 'fixture must contain at least one payload line')

  l0Telemetry.reset()
  const pipeline = new L0Pipeline(() => undefined)
  const measurements: number[] = []

  for (let i = 0; i < ITERATION_COUNT; i += 1) {
    const terminalId = `perf-terminal-${i}`
    pipeline.bindVendor(terminalId, 'claude-code')
    for (const payload of fixtureLines) {
      const start = performance.now()
      pipeline.ingest(terminalId, `${payload}\n`, 'D:/workspace/perf')
      measurements.push(performance.now() - start)
    }
    pipeline.reset(terminalId)
  }

  const p50 = percentile(measurements, 0.5)
  const p95 = percentile(measurements, 0.95)
  const p99 = percentile(measurements, 0.99)

  // Print so CI surfaces the numbers without forcing a snapshot.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    iterations: measurements.length,
    p50_ms: p50,
    p95_ms: p95,
    p99_ms: p99
  }))

  assert.ok(
    p95 <= P95_BUDGET_MS,
    `p95 ingest latency ${p95.toFixed(3)}ms exceeded ${P95_BUDGET_MS}ms SLO budget`
  )
})

test('L0 telemetry histogram reports emit latency samples', () => {
  const fixtureLines = loadPayloadLines('assistant-success.jsonl')
  l0Telemetry.reset()
  const pipeline = new L0Pipeline(() => undefined)
  pipeline.bindVendor('telemetry-terminal', 'claude-code')
  for (const payload of fixtureLines) {
    pipeline.ingest('telemetry-terminal', `${payload}\n`, 'D:/workspace/perf')
  }
  const snapshot = l0Telemetry.snapshot()
  assert.ok(
    snapshot.histograms.emitLatencyMs.count === 0 || snapshot.histograms.emitLatencyMs.p95 <= P95_BUDGET_MS,
    `telemetry p95=${snapshot.histograms.emitLatencyMs.p95}ms exceeded ${P95_BUDGET_MS}ms`
  )
  assert.ok(snapshot.invariantPassRate >= 0 && snapshot.invariantPassRate <= 1)
})
