/**
 * Claude Code hook API compatibility matrix — Slice 2A.
 *
 * CC shipped the PreToolUse / PostToolUse / Session* hook surface used
 * by Option A. The lower bound here was empirically verified in the
 * Slice 0 spike on CC 2.1.119 (captured
 * spike-results/option-a/hook-invocation-summary-win32.json with all
 * L1-required fields present).
 *
 * If CC bumps the surface or breaks compatibility we detect it at
 * runtime via the fingerprint invariant (see src/main/l0/fingerprint.ts)
 * and degrade to Option E / L1 — matching #pol-6 Reactive posture.
 */

export interface CcVersion {
  major: number
  minor: number
  patch: number
  /** Full version string as emitted by `claude --version`, useful for telemetry. */
  raw: string
}

export type CcCompatStatus = 'supported' | 'unsupported' | 'unknown'

export interface CcCompatResult {
  status: CcCompatStatus
  reason: string
  version?: CcVersion
}

// Lower bound: first CC version where the Slice 0 hook fixtures were
// captured successfully. Upper bound is open-ended — newer versions are
// assumed compatible until a fingerprint degrade proves otherwise.
export const MIN_SUPPORTED_VERSION: CcVersion = {
  major: 2,
  minor: 1,
  patch: 119,
  raw: '2.1.119'
}

/**
 * Parse `claude --version` stdout. Accepts both the short form
 * ('2.1.119') and the labelled form ('2.1.119 (Claude Code)').
 */
export function parseCcVersion(stdout: string): CcVersion | null {
  const match = stdout.trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: stdout.trim().split(/\s+/)[0]
  }
}

export function compareVersions(a: CcVersion, b: CcVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

export function checkCompat(version: CcVersion | null): CcCompatResult {
  if (!version) {
    return {
      status: 'unknown',
      reason: 'CC 버전 문자열을 파싱할 수 없습니다 (claude --version 출력 미매칭)'
    }
  }
  if (compareVersions(version, MIN_SUPPORTED_VERSION) < 0) {
    return {
      status: 'unsupported',
      reason: `CC ${version.raw} 은(는) hook ingress 를 지원하지 않습니다. ${MIN_SUPPORTED_VERSION.raw} 이상으로 업그레이드하세요.`,
      version
    }
  }
  return {
    status: 'supported',
    reason: `CC ${version.raw} 은(는) hook ingress 지원 범위입니다`,
    version
  }
}
