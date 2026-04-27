/**
 * Preload bridge types — pure data shapes that cross the IPC boundary.
 *
 * Kept in its own file so both `src/preload/index.ts` (runtime) and
 * `src/preload/index.d.ts` (ambient Window augmentation) can import
 * the shapes without introducing a self-import cycle
 * (typescript-reviewer HIGH — TS2459).
 */

export interface L0PathStateShape {
  hook_installed: boolean
  hook_fires: boolean
  session_log_accessible: boolean
  session_log_latency_p95_ms: number | null
  regex_pipeline_available: boolean
}

export interface L0PathDecisionShape {
  selected: 'L0-A' | 'L0-E' | 'L1-regex' | 'NONE'
  rationale: string
  fallback_chain: string[]
  realtime: boolean
  precision: string
  reason_not_lower_tier: string | null
}

export interface L0CcVersionShape {
  major: number
  minor: number
  patch: number
  raw: string
}

export interface L0CcDetectionShape {
  kind: 'supported' | 'unsupported' | 'unknown' | 'not-installed' | 'detection-failed'
  reason: string
  /**
   * Present for supported / unsupported / unknown kinds. Renderer can
   * display the version string or gate UI on the numeric parts.
   * typescript-reviewer MEDIUM — previous inline shape dropped this.
   */
  version?: L0CcVersionShape
}

export interface L0PathSnapshotShape {
  decision: L0PathDecisionShape
  state: L0PathStateShape
  cc: L0CcDetectionShape
  sessionLogProjectDir?: string
  probedAt: number
  terminalId: string | null
}

export interface L0HookInstallResult {
  kind:
    | 'installed'
    | 'already-installed'
    | 'uninstalled'
    | 'no-op-not-installed'
    | 'abort-parse-error'
    | 'abort-verify-fail'
    | 'abort-io-error'
  reason?: string
  backupPath?: string
  appliedAt?: number
  restoredAt?: number
  restored?: boolean
  stage?: 'precheck' | 'backup' | 'write' | 'rename' | 'verify'
}
