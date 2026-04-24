import React, { useState, useCallback, useRef, useEffect, memo } from 'react'
import { AlertTriangle, Globe, History, Clock3, TerminalSquare, Columns2, Rows2 } from 'lucide-react'
import type { L0Status, MonitoringTimelineFilter } from '../../../../shared/types'
import { useL0Status } from '../../hooks/useL0Status'
import { LeafNode } from '../../types/terminal-layout'
import {
  useTerminalMonitoring,
  useTerminalTransitionLog,
  type MonitoringTerminalState
} from '../../contexts/MonitoringContext'
import {
  formatMonitoringDisplay,
  formatMonitoringTransitionDisplay
} from '../../contexts/monitoring-state'
import { useTerminals } from '../../contexts/TerminalContext'
import { useEditor } from '../../contexts/EditorContext'
import { XTerminal } from './XTerminal'
import BrowserPanel from './BrowserPanel'
import ContextMenu, { ContextMenuItem } from '../ContextMenu/ContextMenu'

interface TerminalPanelProps {
  node: LeafNode
}

interface PanelContextMenu {
  x: number
  y: number
}

type DropZone = 'top' | 'bottom' | 'left' | 'right' | 'center' | null

function calcDropZone(e: React.DragEvent, el: HTMLElement): DropZone {
  const rect = el.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height
  if (y < 0.25) return 'top'
  if (y > 0.75) return 'bottom'
  if (x < 0.25) return 'left'
  if (x > 0.75) return 'right'
  return 'center'
}

const ZONE_STYLE: Record<NonNullable<DropZone>, React.CSSProperties> = {
  top:    { top: 0,    left: 0,   width: '100%', height: '50%' },
  bottom: { bottom: 0, left: 0,   width: '100%', height: '50%' },
  left:   { top: 0,   left: 0,   width: '50%',  height: '100%' },
  right:  { top: 0,   right: 0,  width: '50%',  height: '100%' },
  center: { top: 0,   left: 0,   width: '100%', height: '100%' }
}

const ZONE_OPACITY: Record<NonNullable<DropZone>, number> = {
  top: 0.35, bottom: 0.35, left: 0.35, right: 0.35, center: 0.15
}

function TerminalPanelInner({ node }: TerminalPanelProps): React.JSX.Element {
  const {
    terminals,
    browsers,
    createTerminal,
    splitPanel,
    closePanel,
    moveTerminalToPanel,
    splitAndMoveTerminal,
    setActiveTerminalInPanel,
    removeTerminal,
    renameTerminal,
    setFocusedPanel,
    focusedPanelId,
    isDraggingTab,
    setDragState,
    createBrowser,
    removeBrowser
  } = useTerminals()

  const { openFile } = useEditor()

  const [contextMenu, setContextMenu] = useState<PanelContextMenu | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [dropZone, setDropZone] = useState<DropZone>(null)
  const [isTransitionLogOpen, setIsTransitionLogOpen] = useState(false)
  const [isPersistedTimelineOpen, setIsPersistedTimelineOpen] = useState(false)
  const [timelineFilter, setTimelineFilter] = useState<MonitoringTimelineFilter>('all')
  const [persistedTimeline, setPersistedTimeline] = useState<ReturnType<typeof useTerminalTransitionLog>>([])
  // Track which terminals have been activated — only mount xterm when first shown
  const [mountedIds, setMountedIds] = useState<Set<string>>(() =>
    new Set(node.activeTerminalId ? [node.activeTerminalId] : [])
  )

  const overlayRef = useRef<HTMLDivElement>(null)

  const isFocused = focusedPanelId === node.panelId
  const activeMonitoringState = useTerminalMonitoring(node.activeTerminalId)
  const activeTransitionLog = useTerminalTransitionLog(node.activeTerminalId)
  const activeL0Status = useL0Status(node.activeTerminalId)
  const panelNeedsAttention = activeMonitoringState?.attentionNeeded === true
  const displayCopy = activeMonitoringState
    ? formatMonitoringDisplay({
      terminalId: activeMonitoringState.terminalId,
      workspacePath: '',
      patternName: activeMonitoringState.patternName,
      matchedText: activeMonitoringState.matchedText,
      status: 'attention-needed',
      cause: activeMonitoringState.analysisCategory,
      confidence: activeMonitoringState.confidence,
      source: activeMonitoringState.source,
      summary: activeMonitoringState.analysisSummary,
      updatedAt: activeMonitoringState.updatedAt
    })
    : null

  // Listen for MCP browser:open-requested IPC events
  useEffect(() => {
    const ipc = (window as any).electron?.ipcRenderer
    if (!ipc) return
    const handler = (_event: unknown, data: { id: string; url: string }) => {
      createBrowser(data.url)
    }
    ipc.on('browser:open-requested', handler)
    return () => {
      ipc.removeListener('browser:open-requested', handler)
    }
  }, [createBrowser])

  const loadPersistedTimeline = useCallback(async (
    terminalId: string | null,
    filter: MonitoringTimelineFilter
  ) => {
    if (!terminalId || !window.monitoringHistory) {
      setPersistedTimeline([])
      return
    }

    const events = await window.monitoringHistory.listSessionEvents(
      terminalId,
      filter,
      200
    )

    setPersistedTimeline(events.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      kind: entry.kind,
      timestamp: entry.timestamp,
      title: formatMonitoringTransitionDisplay({
        ...entry,
        cause: entry.category
      }).title,
      meta: formatMonitoringTransitionDisplay({
        ...entry,
        cause: entry.category
      }).meta,
      detail: formatMonitoringTransitionDisplay({
        ...entry,
        cause: entry.category
      }).detail
    })))
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadTimeline = async () => {
      if (!isPersistedTimelineOpen || !node.activeTerminalId || !window.monitoringHistory) {
        setPersistedTimeline([])
        return
      }
      if (cancelled) {
        return
      }
      await loadPersistedTimeline(node.activeTerminalId, timelineFilter)
    }

    void loadTimeline()

    return () => {
      cancelled = true
    }
  }, [activeTransitionLog.length, isPersistedTimelineOpen, loadPersistedTimeline, node.activeTerminalId, timelineFilter])

  // When activeTerminalId changes, mark it as mounted
  if (node.activeTerminalId && !mountedIds.has(node.activeTerminalId)) {
    setMountedIds(prev => new Set(prev).add(node.activeTerminalId!))
  }

  const handlePanelClick = useCallback(() => {
    setFocusedPanel(node.panelId)
  }, [node.panelId, setFocusedPanel])

  const handleTabClick = useCallback((terminalId: string) => {
    setFocusedPanel(node.panelId)
    setActiveTerminalInPanel(node.panelId, terminalId)
  }, [node.panelId, setFocusedPanel, setActiveTerminalInPanel])

  const handleTabBarContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    const activeTermId = node.activeTerminalId
    const activeTerm = activeTermId ? terminals.find((t) => t.id === activeTermId) : null
    return [
      {
        label: 'Split Vertical',
        shortcut: 'Ctrl+\\',
        onClick: () => splitPanel(node.panelId, 'vertical')
      },
      {
        label: 'Split Horizontal',
        shortcut: 'Ctrl+Shift+\\',
        onClick: () => splitPanel(node.panelId, 'horizontal')
      },
      { label: '', onClick: () => {}, divider: true },
      {
        label: 'Close Panel',
        onClick: () => closePanel(node.panelId),
        danger: true
      },
      { label: '', onClick: () => {}, divider: true },
      {
        label: 'New Browser Tab',
        onClick: () => createBrowser()
      },
      { label: '', onClick: () => {}, divider: true },
      {
        label: 'Rename Terminal',
        onClick: () => {
          if (!activeTermId) return
          const newName = prompt('Enter new name:', activeTerm?.name ?? '')
          if (newName && newName.trim()) {
            renameTerminal(activeTermId, newName.trim())
          }
        }
      },
      {
        label: 'Close Terminal',
        onClick: () => {
          if (activeTermId) removeTerminal(activeTermId)
        },
        danger: true
      }
    ]
  }, [node.panelId, node.activeTerminalId, terminals, splitPanel, closePanel, renameTerminal, removeTerminal, createBrowser, createTerminal])

  // Tab drag source handlers — set/clear global drag state
  // IMPORTANT: Delay setDragState so the overlay doesn't insert into the DOM during dragstart,
  // which would cause the browser to cancel the drag operation.
  const handleDragStart = useCallback((e: React.DragEvent, terminalId: string) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify({ terminalId, sourcePanelId: node.panelId }))
    requestAnimationFrame(() => {
      setDragState({ terminalId, sourcePanelId: node.panelId })
    })
  }, [node.panelId, setDragState])

  const handleDragEnd = useCallback(() => {
    setDragState(null)
    setDropZone(null)
  }, [setDragState])

  // Tab bar drop target (move into tab group — original behavior)
  const handleTabBarDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }, [])

  const handleTabBarDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleTabBarDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    setDragState(null)
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      const { terminalId, sourcePanelId } = data
      if (sourcePanelId !== node.panelId && terminalId) {
        moveTerminalToPanel(terminalId, sourcePanelId, node.panelId)
      }
    } catch {
      // ignore malformed drag data
    }
  }, [node.panelId, moveTerminalToPanel, setDragState])

  // Full-panel overlay drag handlers
  const handleOverlayDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (overlayRef.current) {
      setDropZone(calcDropZone(e, overlayRef.current))
    }
  }, [])

  const handleOverlayDragLeave = useCallback((e: React.DragEvent) => {
    if (overlayRef.current && !overlayRef.current.contains(e.relatedTarget as Node)) {
      setDropZone(null)
    }
  }, [])

  const handleOverlayDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const zone = overlayRef.current ? calcDropZone(e, overlayRef.current) : 'center'
    setDropZone(null)
    setDragState(null)

    let terminalId: string
    let sourcePanelId: string
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      terminalId = data.terminalId
      sourcePanelId = data.sourcePanelId
    } catch {
      return
    }
    if (!terminalId || !sourcePanelId) return

    if (zone === 'center') {
      // Move to this panel's tab group
      if (sourcePanelId !== node.panelId) {
        moveTerminalToPanel(terminalId, sourcePanelId, node.panelId)
      }
      return
    }

    const direction = zone === 'top' || zone === 'bottom' ? 'horizontal' : 'vertical'
    const insertBefore = zone === 'top' || zone === 'left'

    // Atomically split the target panel and move the terminal into the new panel
    splitAndMoveTerminal(terminalId, sourcePanelId, node.panelId, direction, insertBefore)
  }, [node.panelId, splitAndMoveTerminal, setDragState])

  const panelTerminals = node.terminalIds
    .map((id) => terminals.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => t != null)

  const panelBrowsers = (node.browserIds ?? [])
    .map((id) => browsers.find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof b> => b != null)

  const allTabs = [
    ...panelTerminals.map((t) => ({ id: t.id, type: 'terminal' as const, label: t.name })),
    ...panelBrowsers.map((b) => ({
      id: b.id,
      type: 'browser' as const,
      label: b.title || (() => { try { return new URL(b.url).hostname || 'New Tab' } catch { return 'New Tab' } })()
    }))
  ]

  return (
    <div
      className="terminal-panel"
      onClick={handlePanelClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        outline: panelNeedsAttention
          ? '1px solid rgba(245, 158, 11, 0.75)'
          : isFocused
            ? '1px solid var(--color-accent, #007acc)'
            : '1px solid var(--color-border)',
        outlineOffset: '-1px',
        boxSizing: 'border-box',
        backgroundColor: 'var(--color-terminal-bg)',
        position: 'relative',
        boxShadow: panelNeedsAttention ? 'inset 3px 0 0 #f59e0b' : 'none'
      }}
    >
      {/* Tab bar — drop target for tab-to-tab moves (original behavior) */}
      <div
        className="terminal-panel__tab-bar"
        role="tablist"
        aria-label="Terminal tabs"
        onContextMenu={handleTabBarContextMenu}
        onDragOver={handleTabBarDragOver}
        onDragLeave={handleTabBarDragLeave}
        onDrop={handleTabBarDrop}
        style={{
          height: '28px',
          backgroundColor: isDragOver
            ? 'var(--color-accent-muted, rgba(0,122,204,0.15))'
            : 'var(--color-tab-inactive-bg)',
          borderBottom: isDragOver
            ? '2px solid var(--color-accent, #007acc)'
            : '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 4px',
          gap: '2px',
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'background-color 0.1s, border-bottom 0.1s'
        }}
      >
        {allTabs.map((tab) => {
          const isActive = tab.id === node.activeTerminalId
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              draggable={tab.type === 'terminal'}
              onClick={() => handleTabClick(tab.id)}
              onDragStart={tab.type === 'terminal' ? (e) => handleDragStart(e, tab.id) : undefined}
              onDragEnd={tab.type === 'terminal' ? handleDragEnd : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 6px',
                fontSize: '12px',
                cursor: 'pointer',
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                borderBottom: isActive
                  ? '2px solid var(--color-accent, #007acc)'
                  : '2px solid transparent',
                height: '100%',
                flexShrink: 0,
                whiteSpace: 'nowrap',
                backgroundColor: isActive
                  ? 'var(--color-tab-active-bg, rgba(255,255,255,0.05))'
                  : 'transparent',
                userSelect: 'none'
              }}
            >
              {tab.type === 'browser' && (
                <Globe size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
              )}
              <span>{tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (tab.type === 'browser') {
                    removeBrowser(tab.id)
                  } else {
                    removeTerminal(tab.id)
                  }
                }}
                title={tab.type === 'browser' ? 'Close Browser Tab' : 'Close Terminal'}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  lineHeight: '1',
                  padding: '0 1px',
                  borderRadius: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  opacity: 0.6
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
              >
                ×
              </button>
            </div>
          )
        })}

        {allTabs.length === 0 && (
          <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', paddingLeft: '4px' }}>
            Empty
          </span>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* DP-2 L0 status badge */}
        {activeL0Status && activeL0Status.mode !== 'inactive' && (
          <L0StatusBadge status={activeL0Status} />
        )}

        {/* Panel action buttons */}
        <button
          onClick={(e) => { e.stopPropagation(); createTerminal() }}
          title="New Terminal"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', borderRadius: '3px',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            padding: '2px', flexShrink: 0, opacity: 0.7
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
        >
          <TerminalSquare size={13} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); createBrowser() }}
          title="New Browser"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', borderRadius: '3px',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            padding: '2px', flexShrink: 0, opacity: 0.7
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
        >
          <Globe size={13} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); splitPanel(node.panelId, 'vertical') }}
          title="Split Vertical"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', borderRadius: '3px',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            padding: '2px', flexShrink: 0, opacity: 0.7
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
        >
          <Columns2 size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setIsTransitionLogOpen((prev) => !prev)
          }}
          data-testid="terminal-transition-log-toggle"
          title={activeTransitionLog.length > 0 ? 'Toggle Transition Log' : 'No transition history yet'}
          disabled={!node.activeTerminalId}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isTransitionLogOpen ? 'var(--color-tab-active-bg, rgba(255,255,255,0.05))' : 'none',
            border: 'none', borderRadius: '3px',
            color: isTransitionLogOpen ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            cursor: node.activeTerminalId ? 'pointer' : 'default',
            padding: '2px', flexShrink: 0, opacity: node.activeTerminalId ? 0.8 : 0.4
          }}
          onMouseEnter={(e) => {
            if (node.activeTerminalId) e.currentTarget.style.opacity = '1'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = node.activeTerminalId ? '0.8' : '0.4'
          }}
        >
          <History size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            const nextOpen = !isPersistedTimelineOpen
            setIsPersistedTimelineOpen(nextOpen)
            if (nextOpen) {
              void loadPersistedTimeline(node.activeTerminalId, timelineFilter)
            }
          }}
          data-testid="terminal-persisted-timeline-toggle"
          title="Toggle Timeline"
          disabled={!node.activeTerminalId}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isPersistedTimelineOpen ? 'var(--color-tab-active-bg, rgba(255,255,255,0.05))' : 'none',
            border: 'none', borderRadius: '3px',
            color: isPersistedTimelineOpen ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            cursor: node.activeTerminalId ? 'pointer' : 'default',
            padding: '2px', flexShrink: 0, opacity: node.activeTerminalId ? 0.8 : 0.4
          }}
          onMouseEnter={(e) => {
            if (node.activeTerminalId) e.currentTarget.style.opacity = '1'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = node.activeTerminalId ? '0.8' : '0.4'
          }}
        >
          <Clock3 size={13} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); splitPanel(node.panelId, 'horizontal') }}
          title="Split Horizontal"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', borderRadius: '3px',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            padding: '2px', marginRight: '6px', flexShrink: 0, opacity: 0.7
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
        >
          <Rows2 size={13} />
        </button>
      </div>

      {activeMonitoringState && (
        <div
          style={{
            minHeight: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 10px',
            fontSize: '11px',
            color: 'var(--color-text-secondary)',
            backgroundColor: panelNeedsAttention
              ? 'rgba(245, 158, 11, 0.1)'
              : 'var(--color-tab-active-bg, rgba(255,255,255,0.03))',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0
          }}
        >
          <span
            style={{
              color: panelNeedsAttention ? '#f59e0b' : 'var(--color-text-secondary)',
              fontWeight: 600,
              flexShrink: 0
            }}
          >
            {displayCopy?.headline}
          </span>
          <span style={{ flexShrink: 0 }}>{displayCopy?.meta}</span>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={activeMonitoringState.analysisSummary ?? activeMonitoringState.matchedText}
          >
            {activeMonitoringState.analysisSummary ?? activeMonitoringState.matchedText}
          </span>
        </div>
      )}

      {isTransitionLogOpen && activeTransitionLog.length > 0 && (
        <div
          style={{
            maxHeight: '132px',
            overflowY: 'auto',
            backgroundColor: 'var(--color-tab-active-bg, rgba(255,255,255,0.03))',
            borderBottom: '1px solid var(--color-border)',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            flexShrink: 0
          }}
        >
          {activeTransitionLog.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                fontSize: '11px',
                color: 'var(--color-text-secondary)'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px'
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{entry.title}</span>
                <span style={{ flexShrink: 0, opacity: 0.75 }}>
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              <span>{entry.meta}</span>
              {entry.detail && (
                <span
                  style={{
                    color: 'var(--color-text-primary)',
                    opacity: 0.85,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  title={entry.detail}
                >
                  {entry.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {isPersistedTimelineOpen && (
        <div
          style={{
            maxHeight: '132px',
            overflowY: 'auto',
            backgroundColor: 'var(--color-tab-active-bg, rgba(255,255,255,0.03))',
            borderBottom: '1px solid var(--color-border)',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            flexShrink: 0
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '6px',
              marginBottom: '8px'
            }}
          >
            {(['all', 'approval-only', 'error-only'] as MonitoringTimelineFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setTimelineFilter(filter)}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: '4px',
                  background: timelineFilter === filter ? 'var(--color-tab-active-bg, rgba(255,255,255,0.08))' : 'transparent',
                  color: 'var(--color-text-secondary)',
                  fontSize: '11px',
                  padding: '4px 6px',
                  cursor: 'pointer'
                }}
              >
                {filter}
              </button>
            ))}
          </div>
          {persistedTimeline.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>No timeline history yet.</div>
          ) : (
            persistedTimeline.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  fontSize: '11px',
                  color: 'var(--color-text-secondary)'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px'
                  }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{entry.title}</span>
                  <span style={{ flexShrink: 0, opacity: 0.75 }}>
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                <span>{entry.meta}</span>
                {entry.detail && (
                  <span
                    style={{
                      color: 'var(--color-text-primary)',
                      opacity: 0.85,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                    title={entry.detail}
                  >
                    {entry.detail}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Terminal content area */}
      <div
        className="terminal-panel__content"
        role="tabpanel"
        style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
      >
        {panelTerminals.map((terminal) => {
          const isActive = terminal.id === node.activeTerminalId
          // Only mount xterm when the terminal has been activated at least once
          if (!mountedIds.has(terminal.id)) return null
          return (
            <div
              key={terminal.id}
              style={{
                position: 'absolute',
                inset: 0,
                visibility: isActive ? 'visible' : 'hidden',
                zIndex: isActive ? 1 : 0
              }}
            >
              <XTerminal id={terminal.id} isActive={isActive} onOpenFile={openFile} />
            </div>
          )
        })}

        {panelBrowsers.map((browser) => {
          const isActive = browser.id === node.activeTerminalId
          return (
            <div
              key={browser.id}
              style={{
                position: 'absolute',
                inset: 0,
                visibility: isActive ? 'visible' : 'hidden',
                zIndex: isActive ? 1 : 0,
                height: '100%'
              }}
            >
              <BrowserPanel id={browser.id} isActive={isActive} />
            </div>
          )
        })}

        {allTabs.length === 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--color-text-secondary)',
              fontSize: '13px'
            }}
          >
            No terminals.
          </div>
        )}

        {panelNeedsAttention && activeMonitoringState && (
          <div
            style={{
              position: 'absolute',
              left: '16px',
              right: '16px',
              bottom: '16px',
              zIndex: 4,
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none'
            }}
          >
            <div
              style={{
                width: 'min(420px, 100%)',
                backgroundColor: 'rgba(32, 24, 4, 0.94)',
                border: '1px solid rgba(245, 158, 11, 0.45)',
                borderRadius: '8px',
                boxShadow: '0 10px 28px rgba(0, 0, 0, 0.35)',
                padding: '10px 12px',
                color: '#fef3c7'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  marginBottom: '6px'
                }}
              >
                <AlertTriangle size={14} />
                {displayCopy?.headline}
              </div>
              <div style={{ fontSize: '12px', lineHeight: 1.5, color: '#fde68a' }}>
                {activeMonitoringState.analysisSummary ?? activeMonitoringState.patternName}
              </div>
              <div
                style={{
                  marginTop: '6px',
                  fontSize: '11px',
                  lineHeight: 1.4,
                  color: '#f8fafc',
                  opacity: 0.8
                }}
              >
                {displayCopy?.meta}
              </div>
              <div
                style={{
                  marginTop: '6px',
                  fontSize: '11px',
                  lineHeight: 1.4,
                  color: '#f8fafc',
                  opacity: 0.9
                }}
              >
                {activeMonitoringState.matchedText}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Drop zone overlay — always rendered but pointer-events toggled to avoid DOM insertion during drag */}
      <div
        ref={overlayRef}
        onDragOver={isDraggingTab ? handleOverlayDragOver : undefined}
        onDragLeave={isDraggingTab ? handleOverlayDragLeave : undefined}
        onDrop={isDraggingTab ? handleOverlayDrop : undefined}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          pointerEvents: isDraggingTab ? 'auto' : 'none'
        }}
      >
        {dropZone && (
          <div
            style={{
              position: 'absolute',
              backgroundColor: `rgba(0, 122, 204, ${ZONE_OPACITY[dropZone]})`,
              border: '2px solid var(--color-accent, #007acc)',
              borderRadius: '2px',
              transition: 'top 0.15s, left 0.15s, width 0.15s, height 0.15s, opacity 0.15s',
              pointerEvents: 'none',
              boxSizing: 'border-box',
              ...ZONE_STYLE[dropZone]
            }}
          />
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          items={getContextMenuItems()}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

export const TerminalPanel = memo(TerminalPanelInner)

interface L0StatusBadgeProps {
  status: L0Status
}

const L0_BADGE_PALETTE: Record<
  L0Status['mode'],
  { dot: string; ring: string; text: string; label: string; tooltip: string }
> = {
  inactive: {
    dot: 'transparent',
    ring: 'transparent',
    text: 'transparent',
    label: '',
    tooltip: ''
  },
  'awaiting-first-event': {
    dot: '#94a3b8',
    ring: 'rgba(148, 163, 184, 0.35)',
    text: '#cbd5f5',
    label: 'L0 ready',
    tooltip: 'Waiting for first vendor event to fingerprint the schema'
  },
  active: {
    dot: '#22c55e',
    ring: 'rgba(34, 197, 94, 0.35)',
    text: '#bbf7d0',
    label: 'L0 vendor-event',
    tooltip: 'High-precision vendor-emitted events are driving supervision'
  },
  degraded: {
    dot: '#f59e0b',
    ring: 'rgba(245, 158, 11, 0.35)',
    text: '#fde68a',
    label: 'heuristic only',
    tooltip: 'Vendor stream invariant failed — fell back to L1/L2/no-API heuristics'
  }
}

function L0StatusBadge({ status }: L0StatusBadgeProps): React.JSX.Element | null {
  const palette = L0_BADGE_PALETTE[status.mode]
  if (!palette.label) {
    return null
  }
  const tooltipParts = [palette.tooltip]
  if (status.fingerprint) {
    tooltipParts.push(`fingerprint: ${status.fingerprint}`)
  }
  if (status.lastDegradeReason) {
    tooltipParts.push(`reason: ${status.lastDegradeReason}`)
  }
  return (
    <div
      data-testid="l0-status-badge"
      data-l0-mode={status.mode}
      title={tooltipParts.join(' · ')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '0 8px',
        height: '20px',
        marginRight: '6px',
        borderRadius: '10px',
        border: `1px solid ${palette.ring}`,
        backgroundColor: 'transparent',
        color: palette.text,
        fontSize: '11px',
        lineHeight: '20px',
        userSelect: 'none',
        flexShrink: 0
      }}
    >
      <span
        aria-hidden
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: palette.dot,
          boxShadow: `0 0 0 3px ${palette.ring}`,
          animation: status.mode === 'awaiting-first-event'
            ? 'l0-status-pulse 1.6s ease-in-out infinite'
            : undefined
        }}
      />
      <span>{palette.label}</span>
      <style>{`@keyframes l0-status-pulse { 0%, 100% { opacity: 0.4 } 50% { opacity: 1 } }`}</style>
    </div>
  )
}
