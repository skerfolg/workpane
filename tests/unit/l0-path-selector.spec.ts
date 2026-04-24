import test from 'node:test'
import assert from 'node:assert/strict'
import { pickSupervisionPath, type L0PathSelectorState } from '../../src/main/l0/l0-path-selector'

/**
 * Regression suite for Slice 0 spike Test Y (fallback chain simulator).
 * Mirrors the 6 scenarios in
 * spike-results/option-a/fallback-chain-simulation-win32.json so any
 * change to the decision table is caught before it lands.
 */

test('Scenario 1 — Option A 정상 → L0-A primary', () => {
  const state: L0PathSelectorState = {
    hook_installed: true,
    hook_fires: true,
    session_log_accessible: true,
    session_log_latency_p95_ms: 972,
    regex_pipeline_available: true
  }
  const decision = pickSupervisionPath(state)
  assert.equal(decision.selected, 'L0-A')
  assert.equal(decision.realtime, true)
  assert.equal(decision.precision, 'high')
  assert.deepEqual(decision.fallback_chain, ['L0-A', 'L0-E', 'L1-regex'])
  assert.equal(decision.reason_not_lower_tier, null)
})

test('Scenario 2 — Hook 미설치 → L0-E fallback', () => {
  const state: L0PathSelectorState = {
    hook_installed: false,
    hook_fires: false,
    session_log_accessible: true,
    session_log_latency_p95_ms: 972,
    regex_pipeline_available: true
  }
  const decision = pickSupervisionPath(state)
  assert.equal(decision.selected, 'L0-E')
  assert.equal(decision.realtime, false, '972ms is above the 500ms real-time gate')
  assert.deepEqual(decision.fallback_chain, ['L0-E', 'L1-regex'])
  assert.ok(decision.rationale.includes('session log default path'))
})

test('Scenario 3 — Hook 설치됐으나 발화 실패 → L0-E fallback with hook-failure rationale', () => {
  const state: L0PathSelectorState = {
    hook_installed: true,
    hook_fires: false,
    session_log_accessible: true,
    session_log_latency_p95_ms: 972,
    regex_pipeline_available: true
  }
  const decision = pickSupervisionPath(state)
  assert.equal(decision.selected, 'L0-E')
  assert.ok(decision.rationale.includes('Hook 설치됐으나 발화 실패'))
})

test('Scenario 4 — L0 양축 모두 불가 → L1 regex', () => {
  const state: L0PathSelectorState = {
    hook_installed: false,
    hook_fires: false,
    session_log_accessible: false,
    session_log_latency_p95_ms: null,
    regex_pipeline_available: true
  }
  const decision = pickSupervisionPath(state)
  assert.equal(decision.selected, 'L1-regex')
  assert.equal(decision.realtime, true, 'regex observes stdout in real-time')
  assert.deepEqual(decision.fallback_chain, ['L1-regex'])
})

test('Scenario 5 — 전체 실패 → NONE with warning rationale', () => {
  const state: L0PathSelectorState = {
    hook_installed: false,
    hook_fires: false,
    session_log_accessible: false,
    session_log_latency_p95_ms: null,
    regex_pipeline_available: false
  }
  const decision = pickSupervisionPath(state)
  assert.equal(decision.selected, 'NONE')
  assert.equal(decision.realtime, false)
  assert.deepEqual(decision.fallback_chain, [])
  assert.ok(decision.rationale.includes('경고'))
})

test('Scenario 6 — theoretical best case (A + E both healthy) → L0-A', () => {
  const state: L0PathSelectorState = {
    hook_installed: true,
    hook_fires: true,
    session_log_accessible: true,
    session_log_latency_p95_ms: 100,
    regex_pipeline_available: true
  }
  const decision = pickSupervisionPath(state)
  assert.equal(decision.selected, 'L0-A')
  assert.equal(decision.precision, 'high')
})

test('Session log latency below the 500ms threshold marks L0-E realtime=true', () => {
  const decision = pickSupervisionPath({
    hook_installed: false,
    hook_fires: false,
    session_log_accessible: true,
    session_log_latency_p95_ms: 250,
    regex_pipeline_available: true
  })
  assert.equal(decision.selected, 'L0-E')
  assert.equal(decision.realtime, true)
  assert.equal(decision.precision, 'medium-high')
})

test('L0-E with unknown latency reports medium precision without NaN', () => {
  const decision = pickSupervisionPath({
    hook_installed: false,
    hook_fires: false,
    session_log_accessible: true,
    session_log_latency_p95_ms: null,
    regex_pipeline_available: true
  })
  assert.equal(decision.selected, 'L0-E')
  assert.equal(decision.realtime, false)
  assert.ok(decision.precision.startsWith('medium (latency'))
})
