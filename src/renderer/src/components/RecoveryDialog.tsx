import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface AutoSaveEntry {
  originalPath: string
  content: string
  savedAt: string
}

interface RecoveryDialogProps {
  workspacePath: string
  entries: AutoSaveEntry[]
  onRecover: (selectedPaths: string[]) => void
  onDiscard: () => void
}

export function RecoveryDialog({
  workspacePath,
  entries,
  onRecover,
  onDiscard
}: RecoveryDialogProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(entries.map((e) => e.originalPath))
  )
  const [processing, setProcessing] = useState(false)

  function toggleEntry(path: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  function shortPath(fullPath: string): string {
    return fullPath.split(/[/\\]/).slice(-2).join('/')
  }

  async function handleRecover(): Promise<void> {
    setProcessing(true)
    try {
      await (window as any).recovery.recover(workspacePath)
      await (window as any).recovery.clear(workspacePath)
      onRecover(Array.from(selected))
    } finally {
      setProcessing(false)
    }
  }

  async function handleDiscard(): Promise<void> {
    setProcessing(true)
    try {
      await (window as any).recovery.clear(workspacePath)
      onDiscard()
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary, #1e1e2e)',
          border: '1px solid var(--border-color, #333)',
          borderRadius: 8,
          padding: 24,
          width: 480,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <AlertTriangle size={20} style={{ color: 'var(--color-warning, #ff9800)' }} />
          <h3 style={{ margin: 0 }}>Recover Unsaved Files</h3>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
          {entries.length} unsaved file(s) found from previous session. Recover?
        </p>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginBottom: 20
          }}
        >
          {entries.map((entry) => (
            <label
              key={entry.originalPath}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                cursor: 'pointer',
                padding: '8px 12px',
                border: '1px solid var(--border-color, #333)',
                borderRadius: 6,
                background: selected.has(entry.originalPath)
                  ? 'var(--bg-selected, rgba(99,102,241,0.1))'
                  : 'transparent'
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(entry.originalPath)}
                onChange={() => toggleEntry(entry.originalPath)}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontFamily: 'monospace',
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={entry.originalPath}
                >
                  {shortPath(entry.originalPath)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Last saved: {formatTime(entry.savedAt)}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn--danger" onClick={handleDiscard} disabled={processing}>
            Delete
          </button>
          <button
            className="btn btn--primary"
            onClick={handleRecover}
            disabled={processing || selected.size === 0}
          >
            {processing ? 'Recovering...' : `Recover (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
