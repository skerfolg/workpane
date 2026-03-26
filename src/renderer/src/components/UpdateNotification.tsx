import { useState, useEffect } from 'react'
import { X, Download } from 'lucide-react'

interface UpdateInfo {
  version: string
  releaseNotes?: string
}

export function UpdateNotification(): JSX.Element | null {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    if (!window.updater) return

    window.updater.onUpdateAvailable((info: UpdateInfo) => {
      setUpdateInfo(info)
    })
  }, [])

  if (!updateInfo) return null

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
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        maxWidth: '360px'
      }}
    >
      <Download size={16} style={{ color: 'var(--color-accent, #cba6f7)', flexShrink: 0 }} />
      <span style={{ fontSize: '13px', color: 'var(--color-text, #cdd6f4)', flex: 1 }}>
        Version {updateInfo.version} is available.{' '}
        <a
          href={`https://github.com/releases`}
          onClick={(e) => {
            e.preventDefault()
            window.shell?.openExternal(`https://github.com/releases`)
          }}
          style={{ color: 'var(--color-accent, #cba6f7)', textDecoration: 'underline', cursor: 'pointer' }}
        >
          Download from GitHub
        </a>
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
  )
}
