import React, { useState, useCallback, useRef, memo } from 'react'
import { LeafNode } from '../../types/terminal-layout'
import { useTerminals } from '../../contexts/TerminalContext'
import { XTerminal } from './XTerminal'
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
    setDragState
  } = useTerminals()

  const [contextMenu, setContextMenu] = useState<PanelContextMenu | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [dropZone, setDropZone] = useState<DropZone>(null)
  // Track which terminals have been activated — only mount xterm when first shown
  const [mountedIds, setMountedIds] = useState<Set<string>>(() =>
    new Set(node.activeTerminalId ? [node.activeTerminalId] : [])
  )

  const overlayRef = useRef<HTMLDivElement>(null)

  const isFocused = focusedPanelId === node.panelId

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

  const handleTabClose = useCallback((e: React.MouseEvent, terminalId: string) => {
    e.stopPropagation()
    removeTerminal(terminalId)
  }, [removeTerminal])

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
  }, [node.panelId, node.activeTerminalId, terminals, splitPanel, closePanel, renameTerminal, removeTerminal])

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

  return (
    <div
      className="terminal-panel"
      onClick={handlePanelClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        outline: isFocused ? '1px solid var(--color-accent, #007acc)' : '1px solid var(--color-border)',
        outlineOffset: '-1px',
        boxSizing: 'border-box',
        backgroundColor: 'var(--color-terminal-bg)',
        position: 'relative'
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
          paddingLeft: '4px',
          gap: '2px',
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'background-color 0.1s, border-bottom 0.1s'
        }}
      >
        {panelTerminals.map((terminal) => {
          const isActive = terminal.id === node.activeTerminalId
          return (
            <div
              key={terminal.id}
              role="tab"
              aria-selected={isActive}
              draggable
              onClick={() => handleTabClick(terminal.id)}
              onDragStart={(e) => handleDragStart(e, terminal.id)}
              onDragEnd={handleDragEnd}
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
              <span>{terminal.name}</span>
              <button
                onClick={(e) => handleTabClose(e, terminal.id)}
                title="Close Terminal"
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

        {panelTerminals.length === 0 && (
          <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', paddingLeft: '4px' }}>
            Empty
          </span>
        )}
      </div>

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
                display: isActive ? 'block' : 'none'
              }}
            >
              <XTerminal id={terminal.id} isActive={isActive} />
            </div>
          )
        })}

        {panelTerminals.length === 0 && (
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
