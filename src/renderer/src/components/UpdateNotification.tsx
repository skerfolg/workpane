import { useState, useEffect, useCallback } from 'react'
import { X, Download, RefreshCw, CheckCircle } from 'lucide-react'

interface UpdateInfo {
  version: string
  releaseNotes?: string
}

interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

type UpdatePhase = 'available' | 'downloading' | 'downloaded' | 'error'

export function UpdateNotification(): JSX.Element | null {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [phase, setPhase] = useState<UpdatePhase>('available')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!window.updater) return

    window.updater.onUpdateAvailable((info) => {
      setUpdateInfo(info)
      setPhase('available')
    })

    window.updater.onDownloadProgress((prog) => {
      setProgress(prog as DownloadProgress)
    })

    window.updater.onUpdateDownloaded(() => {
      setPhase('downloaded')
    })

    window.updater.onUpdateError((err) => {
      setErrorMsg(typeof err === 'string' ? err : 'Update failed')
      setPhase('error')
    })
  }, [])

  const handleDownload = useCallback(() => {
    setPhase('downloading')
    setErrorMsg(null)
    window.updater?.download()
  }, [])

  const handleInstall = useCallback(() => {
    window.updater?.install()
  }, [])

  const handleRetry = useCallback(() => {
    setPhase('available')
    setErrorMsg(null)
    setProgress(null)
  }, [])

  if (!updateInfo) return null

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: 9999,
        backgroundColor: 'var(--color-bg-secondary, #1e1e2e)',
        border: '1px solid var(--color-border, #313244)',
        borderRadius: '8px',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        maxWidth: '360px',
        minWidth: '280px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {phase === 'downloaded' ? (
          <CheckCircle size={16} style={{ color: '#a6e3a1', flexShrink: 0 }} />
        ) : (
          <Download size={16} style={{ color: 'var(--color-accent, #cba6f7)', flexShrink: 0 }} />
        )}
        <span style={{ fontSize: '13px', color: 'var(--color-text, #cdd6f4)', flex: 1 }}>
          {phase === 'downloaded'
            ? `v${updateInfo.version} 다운로드 완료`
            : `새 버전 v${updateInfo.version} 사용 가능`}
        </span>
        <button
          onClick={() => setUpdateInfo(null)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
            color: 'var(--color-text-muted, #6c7086)',
            flexShrink: 0
          }}
        >
          <X size={14} />
        </button>
      </div>

      {phase === 'downloading' && progress && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div
            style={{
              height: '4px',
              backgroundColor: 'var(--color-border, #313244)',
              borderRadius: '2px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(progress.percent)}%`,
                backgroundColor: 'var(--color-accent, #cba6f7)',
                borderRadius: '2px',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted, #6c7086)' }}>
            {Math.round(progress.percent)}% — {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
            {progress.bytesPerSecond > 0 && ` (${formatBytes(progress.bytesPerSecond)}/s)`}
          </span>
        </div>
      )}

      {phase === 'error' && (
        <span style={{ fontSize: '11px', color: '#f38ba8' }}>
          {errorMsg}
        </span>
      )}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        {phase === 'available' && (
          <button onClick={handleDownload} style={buttonStyle}>
            <Download size={12} />
            다운로드
          </button>
        )}
        {phase === 'downloaded' && (
          <button onClick={handleInstall} style={{ ...buttonStyle, backgroundColor: '#a6e3a1', color: '#1e1e2e' }}>
            <RefreshCw size={12} />
            지금 재시작
          </button>
        )}
        {phase === 'error' && (
          <button onClick={handleRetry} style={buttonStyle}>
            <RefreshCw size={12} />
            재시도
          </button>
        )}
      </div>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 10px',
  fontSize: '12px',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  backgroundColor: 'var(--color-accent, #cba6f7)',
  color: 'var(--color-bg, #1e1e2e)',
  fontWeight: 500
}
