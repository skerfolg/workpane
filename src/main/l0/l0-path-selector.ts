/**
 * L0 path selector — Slice 1D (port of
 * scripts/phase-2/simulate-fallback-chain.mjs from the Slice 0 spike).
 *
 * Decides which supervision tier is active based on observed capabilities.
 * Pure function: no I/O, no timers. Callers (main process bootstrap, Slice
 * 2 settings UI, health heartbeat) supply the state; the selector returns
 * the chosen path + rationale.
 *
 * Fallback order: L0-A (hook IPC, real-time + L1-ready)
 *              → L0-E (session log tail, fallback / default)
 *              → L1-regex (existing approval-detector heuristic)
 *              → NONE (warn + disable supervision)
 *
 * Real-time gate for L0-E: p95 < 500ms (Slice 0 observed 972ms on Windows,
 * which is why E is positioned as fallback/default, not primary).
 */

export type L0PathTier = 'L0-A' | 'L0-E' | 'L1-regex' | 'NONE'

export type L0PathPrecision =
  | 'high'
  | 'medium-high'
  | 'medium'
  | 'low (pattern-dependent, false-positive/negative 가능)'
  | 'none'

export interface L0PathSelectorState {
  hook_installed: boolean
  hook_fires: boolean
  session_log_accessible: boolean
  /** null means session log latency is unknown / unmeasured. */
  session_log_latency_p95_ms: number | null
  regex_pipeline_available: boolean
}

export interface L0PathDecision {
  selected: L0PathTier
  rationale: string
  fallback_chain: L0PathTier[]
  realtime: boolean
  /** Human-readable precision descriptor surfaced in Settings / telemetry. */
  precision: string
  /** Why lower tiers were not chosen (or null for NONE). */
  reason_not_lower_tier: string | null
}

const REALTIME_THRESHOLD_MS = 500

/**
 * Decide the active L0 supervision path for the given capability snapshot.
 * Mirrors the Slice 0 spike decision table 1:1 so the 6-scenario regression
 * suite keeps passing.
 */
export function pickSupervisionPath(state: L0PathSelectorState): L0PathDecision {
  // Tier 1 — L0-A Hook IPC (real-time + L1-ready)
  if (state.hook_installed && state.hook_fires) {
    return {
      selected: 'L0-A',
      rationale: 'Hook 설치 + 실발화 확인 — real-time + L1-ready',
      fallback_chain: ['L0-A', 'L0-E', 'L1-regex'],
      realtime: true,
      precision: 'high',
      reason_not_lower_tier: null
    }
  }

  // Tier 2 — L0-E Session Log (fallback default)
  if (state.session_log_accessible) {
    const latency = state.session_log_latency_p95_ms
    const realtimeOk = latency != null && latency < REALTIME_THRESHOLD_MS
    return {
      selected: 'L0-E',
      rationale: state.hook_installed
        ? 'Hook 설치됐으나 발화 실패 → session log 로 fallback'
        : 'Hook 미설치 또는 미지원 → session log default path',
      fallback_chain: ['L0-E', 'L1-regex'],
      realtime: realtimeOk,
      precision: realtimeOk ? 'medium-high' : `medium (latency ${latency}ms)`,
      reason_not_lower_tier: 'Option A unavailable or failed'
    }
  }

  // Tier 3 — L1 regex (existing approval-detector)
  if (state.regex_pipeline_available) {
    return {
      selected: 'L1-regex',
      rationale: 'L0 양축 모두 불가 → 기존 approval-detector.ts regex 경로',
      fallback_chain: ['L1-regex'],
      realtime: true,
      precision: 'low (pattern-dependent, false-positive/negative 가능)',
      reason_not_lower_tier: 'Both L0 paths unavailable'
    }
  }

  // No supervision path available
  return {
    selected: 'NONE',
    rationale: 'No supervision path available — 사용자에게 경고 + 감시 비활성화',
    fallback_chain: [],
    realtime: false,
    precision: 'none',
    reason_not_lower_tier: 'All supervision layers unavailable'
  }
}
