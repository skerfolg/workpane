import React, { useState, useCallback, useRef } from 'react'
import { Columns2, Rows2, Grid2x2 } from 'lucide-react'
import { useTerminals } from '../../contexts/TerminalContext'
import { useMonitoring, type MonitoringAggregate } from '../../contexts/MonitoringContext'
import SplitLayoutRenderer from '../Terminal/SplitLayoutRenderer'
import type { SplitDirection } from '../../types/terminal-layout'

type EdgeZone = 'top' | 'bottom' | 'left' | 'right' | null

/** Thickness of the outer edge drop zones in pixels */
const EDGE_ZONE_SIZE = 24

function formatAggregateSummary(aggregate: MonitoringAggregate): string | null {
  if (aggregate.attentionNeededCount === 0) return null

  const details: string[] = []
  if (aggregate.causeCounts.approval > 0) details.push(`${aggregate.causeCounts.approval} approval`)
  if (aggregate.causeCounts['input-needed'] > 0) {
    details.push(`${aggregate.causeCounts['input-needed']} input`)
  }
  if (aggregate.causeCounts.error > 0) details.push(`${aggregate.causeCounts.error} error`)
  if (aggregate.causeCounts.unknown > 0) details.push(`${aggregate.causeCounts.unknown} unknown`)

  return `${aggregate.attentionNeededCount} need attention${details.length > 0 ? ` · ${details.join(' · ')}` : ''}`
}

function TerminalArea(): React.JSX.Element {
  const { layoutTree, applyPresetLayout, isDraggingTab, setDragState, splitRootAndMoveTerminal, groups, activeGroupId } = useTerminals()
  const { activeGroupAggregate } = useMonitoring()
  const activeGroupName = groups.find(g => g.id === activeGroupId)?.name ?? ''
  const aggregateSummary = formatAggregateSummary(activeGroupAggregate)
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
          padding: '0 8px',
          gap: '4px',
          flexShrink: 0,
          overflow: 'hidden'
        }}
      >
        {/* Active group name */}
        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)', flexShrink: 0 }}>
          {activeGroupName}
        </span>
        {aggregateSummary && (
          <span
            style={{
              fontSize: '11px',
              color: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.28)',
              borderRadius: '999px',
              padding: '2px 8px',
              flexShrink: 0
            }}
            title="Active group monitoring summary"
          >
            {aggregateSummary}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Preset layout buttons */}
        <button
          onClick={() => applyPresetLayout('2col')}
          title="2 Columns"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', borderRadius: '3px',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            padding: '4px', flexShrink: 0
          }}
        >
          <Columns2 size={14} />
        </button>
        <button
          onClick={() => applyPresetLayout('2row')}
          title="2 Rows"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', borderRadius: '3px',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            padding: '4px', flexShrink: 0
          }}
        >
          <Rows2 size={14} />
        </button>
        <button
          onClick={() => applyPresetLayout('2x2')}
          title="2x2 Grid"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', borderRadius: '3px',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            padding: '4px 8px 4px 4px', flexShrink: 0
          }}
        >
          <Grid2x2 size={14} />
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
