import React, { useContext, useEffect, useRef, useState } from 'react'
import { EditorContext } from '../../contexts/EditorContext'
import { IssueContext } from '../../contexts/IssueContext'
import { useMonitoring } from '../../contexts/MonitoringContext'
import { TerminalContext } from '../../contexts/TerminalContext'
import './StatusBar.css'

interface StatusBarProps {
  workspaceName?: string | null
}

export function StatusBar({ workspaceName }: StatusBarProps): React.JSX.Element {
  const editorCtx = useContext(EditorContext)
  const issueCtx = useContext(IssueContext)
  const terminalCtx = useContext(TerminalContext)
  const { globalAggregate, globalTransitionFeed } = useMonitoring()
  const [isFeedOpen, setIsFeedOpen] = useState(false)
  const feedRef = useRef<HTMLDivElement | null>(null)

  const openCount = issueCtx?.issues.filter((i) => i.status === 'open').length ?? 0
  const inProgCount = issueCtx?.issues.filter((i) => i.status === 'in-progress').length ?? 0
  const terminalCount = terminalCtx?.terminals.length ?? 0
  const activeFile = editorCtx?.activeTab?.title ?? null
  const attentionCount = globalAggregate.attentionNeededCount
  const hasFeedEntries = globalTransitionFeed.length > 0

  useEffect(() => {
    if (!isFeedOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!feedRef.current?.contains(event.target as Node)) {
        setIsFeedOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFeedOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFeedOpen])

  const handleFeedItemClick = (terminalId: string) => {
    if (!terminalCtx) {
      return
    }

    const group = terminalCtx.groups.find((item) => item.terminalIds.includes(terminalId))
    if (!group) {
      return
    }

    terminalCtx.switchGroup(group.id)
    terminalCtx.setActiveTerminal(terminalId)
    setIsFeedOpen(false)
  }

  return (
    <div className="status-bar" role="status" aria-label="Status bar">
      <div className="status-bar__left">
        <span className="status-bar__item status-bar__workspace" title="Current workspace">
          {workspaceName ?? 'No Workspace'}
        </span>
      </div>

      <div className="status-bar__center">
        {issueCtx && (
          <span className="status-bar__item" title="Issue stats">
            {openCount} open
            <span className="status-bar__sep">│</span>
            {inProgCount} in-prog
          </span>
        )}
        {attentionCount > 0 && (
          <>
            {issueCtx && <span className="status-bar__sep">│</span>}
            <span
              className="status-bar__item"
              title="App-wide attention-needed sessions"
              style={{ color: '#f59e0b' }}
            >
              <span style={{ fontWeight: 600 }}>{attentionCount}</span> need attention
            </span>
          </>
        )}
        {hasFeedEntries && (
          <>
            {(issueCtx || attentionCount > 0) && <span className="status-bar__sep">│</span>}
            <div className="status-bar__feed" ref={feedRef}>
              <button
                type="button"
                className={`status-bar__feed-trigger${isFeedOpen ? ' status-bar__feed-trigger--open' : ''}`}
                data-testid="monitoring-global-feed-trigger"
                aria-haspopup="dialog"
                aria-expanded={isFeedOpen}
                aria-label="Recent attention activity"
                title="Recent attention activity"
                onClick={() => setIsFeedOpen((prev) => !prev)}
              >
                <span>Recent</span>
                <span className="status-bar__feed-count">{globalTransitionFeed.length}</span>
              </button>
              {isFeedOpen && (
                <div
                  className="status-bar__feed-popover status-bar__monitoring-feed"
                  data-testid="monitoring-global-feed"
                  role="dialog"
                  aria-label="Monitoring workspace feed"
                >
                  {globalTransitionFeed.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={`status-bar__feed-entry status-bar__monitoring-feed-row${entry.currentAttention ? ' status-bar__feed-entry--active' : ''}`}
                      data-testid="monitoring-global-feed-row"
                      disabled={!entry.isAvailable}
                      onClick={() => handleFeedItemClick(entry.terminalId)}
                    >
                      <div className="status-bar__feed-entry-top">
                        <span className="status-bar__feed-entry-title">{entry.title}</span>
                        <span className="status-bar__feed-entry-time">
                          {new Date(entry.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </span>
                      </div>
                      <span className="status-bar__feed-entry-location">
                        {entry.groupLabel} · {entry.terminalLabel}
                      </span>
                      <span className="status-bar__feed-entry-meta">{entry.meta}</span>
                      {entry.detail && (
                        <span className="status-bar__feed-entry-detail" title={entry.detail}>
                          {entry.detail}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="status-bar__right">
        {terminalCount > 0 && (
          <>
            <span className="status-bar__item" title="Terminal count">
              {terminalCount} terminal{terminalCount !== 1 ? 's' : ''}
            </span>
            <span className="status-bar__sep">│</span>
          </>
        )}
        {activeFile && (
          <>
            <span className="status-bar__item status-bar__filename" title={activeFile}>
              {activeFile}
            </span>
            <span className="status-bar__sep">│</span>
          </>
        )}
        <span className="status-bar__item">Ln 1</span>
      </div>
    </div>
  )
}

export default StatusBar
