import React, { useCallback, useEffect, useState } from 'react'
import type { L0PathSnapshotShape } from '../../../../preload/index'

/**
 * Hook ingress settings panel — Slice 2C.
 *
 * Renders the 3-state L0 supervision badge:
 *   - L0 Hook active          (green)  — Option A primary, real-time + L1-ready
 *   - L0 Session-log active   (blue)   — Option E fallback, history-grade
 *   - L1 heuristic only       (gray)   — regex fallback when A/E unavailable
 *
 * Uses window.l0 IPC surface from Slice 2E. No local state beyond the
 * cached snapshot; all facts flow from the orchestrator probe in main.
 */

type TierKind = 'L0-A' | 'L0-E' | 'L1-regex' | 'NONE'

interface BadgeCopy {
  label: string
  color: string
  borderColor: string
  description: string
}

const BADGE_COPY: Record<TierKind, BadgeCopy> = {
  'L0-A': {
    label: 'L0 Hook active',
    color: '#2b7a2b',
    borderColor: '#2b7a2b',
    description:
      'Claude Code PreToolUse / PostToolUse 이벤트를 실시간으로 수신합니다. 승인 대기 신호 가장 정확.'
  },
  'L0-E': {
    label: 'L0 Session-log active (fallback)',
    color: '#1f5aa8',
    borderColor: '#1f5aa8',
    description:
      '~/.claude/projects 세션 로그를 tailing 합니다. 승인 대기 real-time 은 아님 (p95 ~972ms). 이력 / 요약용.'
  },
  'L1-regex': {
    label: 'L1 heuristic only',
    color: '#8a8a8a',
    borderColor: '#8a8a8a',
    description:
      'Hook + session log 모두 사용 불가. 기존 stdout 정규식 감시로 동작하며 false-positive/negative 가능.'
  },
  NONE: {
    label: 'Supervision disabled',
    color: '#b84040',
    borderColor: '#b84040',
    description:
      '감시 경로가 없습니다. Claude Code 를 설치하거나 approval-detector 의존성 복원이 필요합니다.'
  }
}

export function HookIngressSettings(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<L0PathSnapshotShape | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastActionResult, setLastActionResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.l0.getPathSnapshot().then((initial) => {
      if (!cancelled) setSnapshot(initial)
    })

    const unsubscribeSnapshot = window.l0.onPathSnapshot((next) => {
      setSnapshot(next)
      setProbeError(null)
    })
    const unsubscribeError = window.l0.onPathProbeError((err) => {
      setProbeError(err.reason)
    })

    return () => {
      cancelled = true
      unsubscribeSnapshot()
      unsubscribeError()
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    setBusy(true)
    try {
      const next = await window.l0.refreshPath()
      setSnapshot(next)
      setProbeError(null)
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    setBusy(true)
    try {
      const result = await window.l0.installHooks()
      if (result.kind === 'installed') {
        setLastActionResult({
          ok: true,
          message: `Hook 설치 완료. Backup: ${result.backupPath ?? '(n/a)'}`
        })
      } else if (result.kind === 'already-installed') {
        setLastActionResult({ ok: true, message: result.reason ?? '이미 설치됨' })
      } else {
        setLastActionResult({
          ok: false,
          message: `설치 실패 (${result.kind}): ${result.reason ?? 'unknown'}`
        })
      }
    } catch (error) {
      setLastActionResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
    }
  }, [])

  const handleUninstall = useCallback(async () => {
    setBusy(true)
    try {
      const result = await window.l0.uninstallHooks()
      if (result.kind === 'uninstalled') {
        setLastActionResult({
          ok: true,
          message: `Hook 제거 완료. Backup: ${result.backupPath ?? '(n/a)'}`
        })
      } else if (result.kind === 'no-op-not-installed') {
        setLastActionResult({ ok: true, message: '설치되어 있지 않음' })
      } else {
        setLastActionResult({
          ok: false,
          message: `제거 실패 (${result.kind}): ${result.reason ?? 'unknown'}`
        })
      }
    } catch (error) {
      setLastActionResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
    }
  }, [])

  if (!snapshot) {
    return (
      <div className="hook-ingress-settings" data-testid="hook-ingress-settings">
        <p style={{ margin: 0, color: '#888' }}>L0 path 감지 중...</p>
        {probeError ? (
          <p style={{ color: '#b84040', margin: '8px 0 0' }} data-testid="hook-ingress-error">
            감지 실패: {probeError}
          </p>
        ) : null}
        <button type="button" onClick={handleRefresh} disabled={busy} style={{ marginTop: 8 }}>
          {busy ? '감지 중...' : '다시 시도'}
        </button>
      </div>
    )
  }

  const tier = snapshot.decision.selected as TierKind
  const copy = BADGE_COPY[tier] ?? BADGE_COPY.NONE
  const cc = snapshot.cc

  return (
    <div className="hook-ingress-settings" data-testid="hook-ingress-settings">
      <div
        role="status"
        aria-label={copy.label}
        data-testid="hook-ingress-badge"
        data-tier={tier}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '6px 10px',
          borderRadius: 4,
          border: `1px solid ${copy.borderColor}`,
          color: copy.color,
          background: 'transparent',
          fontWeight: 600,
          fontSize: 13
        }}
      >
        {copy.label}
      </div>

      <p style={{ marginTop: 8 }}>{copy.description}</p>

      <dl className="hook-ingress-settings__facts" style={{ margin: '12px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 4 }}>
          <dt style={{ color: '#888' }}>Claude Code</dt>
          <dd data-testid="hook-ingress-cc" style={{ margin: 0 }}>
            {cc.kind === 'supported' || cc.kind === 'unsupported'
              ? `${cc.kind === 'supported' ? '✅' : '⚠'} ${cc.reason}`
              : cc.kind === 'not-installed'
                ? '🚫 Claude Code 미설치'
                : cc.kind === 'detection-failed'
                  ? `⚠ ${cc.reason}`
                  : cc.reason}
          </dd>

          <dt style={{ color: '#888' }}>Hook installed</dt>
          <dd data-testid="hook-ingress-hook" style={{ margin: 0 }}>
            {snapshot.state.hook_installed ? '✅ settings.json 에 워크페인 마커 있음' : '➖ 미설치'}
          </dd>

          <dt style={{ color: '#888' }}>Session log</dt>
          <dd data-testid="hook-ingress-sessionlog" style={{ margin: 0 }}>
            {snapshot.state.session_log_accessible
              ? `✅ ${snapshot.sessionLogProjectDir ?? '프로젝트 디렉토리 접근 가능'}`
              : '➖ 접근 불가'}
          </dd>

          <dt style={{ color: '#888' }}>Fallback chain</dt>
          <dd style={{ margin: 0 }} data-testid="hook-ingress-chain">
            {snapshot.decision.fallback_chain.join(' → ') || '(none)'}
          </dd>

          <dt style={{ color: '#888' }}>Probed at</dt>
          <dd style={{ margin: 0 }}>{new Date(snapshot.probedAt).toLocaleTimeString()}</dd>
        </div>
      </dl>

      {probeError ? (
        <p style={{ color: '#b84040', marginTop: 8 }} data-testid="hook-ingress-error">
          감지 오류: {probeError}
        </p>
      ) : null}

      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={handleRefresh} disabled={busy} data-testid="hook-ingress-refresh">
          {busy ? '감지 중...' : '상태 재확인'}
        </button>

        {snapshot.cc.kind === 'supported' && !snapshot.state.hook_installed ? (
          <button
            type="button"
            onClick={handleInstall}
            disabled={busy}
            data-testid="hook-ingress-install"
            style={{ background: '#2b7a2b', color: 'white', border: '1px solid #2b7a2b' }}
          >
            {busy ? '설치 중...' : 'Hook 설치 (one-click)'}
          </button>
        ) : null}

        {snapshot.state.hook_installed ? (
          <button
            type="button"
            onClick={handleUninstall}
            disabled={busy}
            data-testid="hook-ingress-uninstall"
          >
            {busy ? '제거 중...' : 'Hook 제거'}
          </button>
        ) : null}
      </div>

      {lastActionResult ? (
        <p
          data-testid="hook-ingress-action-result"
          style={{
            marginTop: 8,
            color: lastActionResult.ok ? '#2b7a2b' : '#b84040',
            fontSize: 12
          }}
        >
          {lastActionResult.ok ? '✅' : '⚠'} {lastActionResult.message}
        </p>
      ) : null}
    </div>
  )
}

export default HookIngressSettings
