import React, { useRef, useCallback } from 'react'
import type { LayoutNode, SplitNode } from '../../types/terminal-layout'
import { pixelDeltaToRatio } from '../../utils/layout-tree'
import { useSplitRatio } from '../../contexts/TerminalContext'
import { TerminalPanel } from './TerminalPanel'
import Splitter from '../Splitter/Splitter'

const MIN_PANEL_SIZE = 200

interface SplitLayoutRendererProps {
  node: LayoutNode
  depth: number
}

// Custom memo comparator — only re-render if the node reference changed
function arePropsEqual(
  prev: SplitLayoutRendererProps,
  next: SplitLayoutRendererProps
): boolean {
  return prev.node === next.node && prev.depth === next.depth
}

const SplitLayoutRenderer = React.memo(function SplitLayoutRenderer({
  node,
  depth
}: SplitLayoutRendererProps): React.JSX.Element {
  if (node.type === 'leaf') {
    return <TerminalPanel node={node} />
  }

  return <SplitNodeRenderer node={node} depth={depth} />
}, arePropsEqual)

// Separate component for split nodes to isolate rAF/ref logic
const SplitNodeRenderer = React.memo(function SplitNodeRenderer({
  node,
  depth
}: {
  node: SplitNode
  depth: number
}): React.JSX.Element {
  const { updateSplitRatio } = useSplitRatio()
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep a stable ref to the latest ratio so the rAF callback never reads stale closure values
  const ratioRef = useRef(node.ratio)
  ratioRef.current = node.ratio

  // Stable ref to splitId — node.splitId is stable across ratio updates
  const splitIdRef = useRef(node.splitId)
  splitIdRef.current = node.splitId

  // rAF throttling: store the latest delta and process at most once per frame
  const pendingDeltaRef = useRef<number | null>(null)
  const rafIdRef = useRef<number | null>(null)

  const handleResize = useCallback(
    (delta: number) => {
      pendingDeltaRef.current = (pendingDeltaRef.current ?? 0) + delta

      if (rafIdRef.current !== null) return // already scheduled

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        const accumulated = pendingDeltaRef.current
        pendingDeltaRef.current = null

        if (accumulated === null || !containerRef.current) return

        const isVertical = node.direction === 'vertical'
        const containerSize = isVertical
          ? containerRef.current.clientWidth
          : containerRef.current.clientHeight

        const newRatio = pixelDeltaToRatio(accumulated, containerSize, ratioRef.current, MIN_PANEL_SIZE)
        updateSplitRatio(splitIdRef.current, newRatio)
      })
    },
    [node.direction, updateSplitRatio]
  )

  const isVertical = node.direction === 'vertical'
  const firstBasis = `${node.ratio * 100}%`
  const secondBasis = `${(1 - node.ratio) * 100}%`

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isVertical ? 'row' : 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      <div style={{ flexBasis: firstBasis, flexShrink: 0, flexGrow: 0, overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
        <SplitLayoutRenderer node={node.children[0]} depth={depth + 1} />
      </div>

      <Splitter direction={isVertical ? 'vertical' : 'horizontal'} onResize={handleResize} />

      <div style={{ flexBasis: secondBasis, flexShrink: 0, flexGrow: 0, overflow: 'hidden', minWidth: 0, minHeight: 0, flex: 1 }}>
        <SplitLayoutRenderer node={node.children[1]} depth={depth + 1} />
      </div>
    </div>
  )
})

export default SplitLayoutRenderer
