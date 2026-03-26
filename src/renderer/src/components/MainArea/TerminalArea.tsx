import React, { useState, useCallback, useRef } from 'react'
import { useTerminals } from '../../contexts/TerminalContext'
import SplitLayoutRenderer from '../Terminal/SplitLayoutRenderer'
import type { SplitDirection } from '../../types/terminal-layout'

type EdgeZone = 'top' | 'bottom' | 'left' | 'right' | null

/** Thickness of the outer edge drop zones in pixels */
const EDGE_ZONE_SIZE = 24

function TerminalArea(): React.JSX.Element {
  const { layoutTree, createTerminal, applyPresetLayout, isDraggingTab, setDragState, splitRootAndMoveTerminal, groups, activeGroupId } = useTerminals()
  const activeGroupName = groups.find(g => g.id === activeGroupId)?.name ?? ''
  const [edgeZone, setEdgeZone] = useState<EdgeZone>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const calcEdgeZone = useCallback((e: React.DragEvent): EdgeZone => {
    if (!contentRef.current) return null
    const rect = contentRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const w = rect.width
    const h = rect.height
    // Only activate when the cursor is within the thin edge strip
    if (y < EDGE_ZONE_SIZE) return 'top'
    if (y > h - EDGE_ZONE_SIZE) return 'bottom'
    if (x < EDGE_ZONE_SIZE) return 'left'
    if (x > w - EDGE_ZONE_SIZE) return 'right'
    return null
  }, [])

  const handleEdgeDragOver = useCallback((e: React.DragEvent) => {
    const zone = calcEdgeZone(e)
    if (zone) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
    }
    setEdgeZone(zone)
  }, [calcEdgeZone])

  const handleEdgeDragLeave = useCallback((e: React.DragEvent) => {
    if (contentRef.current && !contentRef.current.contains(e.relatedTarget as Node)) {
      setEdgeZone(null)
    }
  }, [])

  const handleEdgeDrop = useCallback((e: React.DragEvent) => {
    const zone = calcEdgeZone(e)
    setEdgeZone(null)
    setDragState(null)
    if (!zone) return

    e.preventDefault()
    e.stopPropagation()

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

    const direction: SplitDirection = zone === 'top' || zone === 'bottom' ? 'horizontal' : 'vertical'
    const insertBefore = zone === 'top' || zone === 'left'

    splitRootAndMoveTerminal(terminalId, sourcePanelId, direction, insertBefore)
  }, [calcEdgeZone, splitRootAndMoveTerminal, setDragState])

  const edgeIndicatorStyle = (zone: NonNullable<EdgeZone>): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      backgroundColor: 'var(--color-accent, #007acc)',
      opacity: 0.35,
      pointerEvents: 'none',
      zIndex: 1000,
      transition: 'opacity 0.1s ease'
    }
    switch (zone) {
      case 'top':    return { ...base, top: 0, left: 0, right: 0, height: '50%' }
      case 'bottom': return { ...base, bottom: 0, left: 0, right: 0, height: '50%' }
      case 'left':   return { ...base, top: 0, left: 0, bottom: 0, width: '50%' }
      case 'right':  return { ...base, top: 0, right: 0, bottom: 0, width: '50%' }
    }
  }

  return (
    <div
      className="terminal-area"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-terminal-bg)' }}
    >
      {/* Top toolbar */}
      <div
        className="terminal-area__toolbar"
        style={{
          height: '35px',
          backgroundColor: 'var(--color-tab-inactive-bg)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '8px',
          gap: '4px',
          flexShrink: 0,
          overflow: 'hidden'
        }}
      >
        {/* Active group name */}
        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)', marginRight: '8px' }}>
          {activeGroupName}
        </span>

        {/* Preset layout buttons */}
        {(['2col', '2row', '2x2'] as const).map((preset) => (
          <button
            key={preset}
            onClick={() => applyPresetLayout(preset)}
            title={`Apply ${preset} layout`}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: '3px',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: '11px',
              padding: '2px 6px',
              flexShrink: 0
            }}
          >
            {preset}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {/* Add terminal button — adds to the currently focused panel */}
        <button
          onClick={createTerminal}
          title="New Terminal"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: '1',
            padding: '0 6px',
            flexShrink: 0
          }}
        >
          +
        </button>
      </div>

      {/* Terminal content — recursive split layout with outer edge drop zones */}
      <div
        ref={contentRef}
        className="terminal-content"
        style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
        onDragOver={isDraggingTab ? handleEdgeDragOver : undefined}
        onDragLeave={isDraggingTab ? handleEdgeDragLeave : undefined}
        onDrop={isDraggingTab ? handleEdgeDrop : undefined}
      >
        <SplitLayoutRenderer node={layoutTree} depth={0} />

        {/* Outer edge drop zone visual indicator */}
        {isDraggingTab && edgeZone && (
          <div style={edgeIndicatorStyle(edgeZone)} />
        )}
      </div>
    </div>
  )
}

export default TerminalArea
