import React, { useState, useCallback, useRef, Suspense, lazy } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import TerminalArea from './TerminalArea'
import Splitter from '../Splitter/Splitter'
import './MainArea.css'

// Lazy-load heavy editor and kanban components
const MarkdownArea = lazy(() => import('./MarkdownArea'))
const KanbanBoard = lazy(() => import('../Kanban/KanbanBoard').then(m => ({ default: m.KanbanBoard })))

interface MainAreaProps {
  activeView?: string
  editorVisible?: boolean
  terminalVisible?: boolean
  onToggleEditor?: () => void
  onToggleTerminal?: () => void
}

function MainArea({ activeView, editorVisible: editorVisibleProp, terminalVisible: terminalVisibleProp, onToggleEditor, onToggleTerminal }: MainAreaProps): React.JSX.Element {
  const [markdownWidth, setMarkdownWidth] = useState<number>(50) // percent
  const markdownVisible = editorVisibleProp ?? true
  const terminalVisible = terminalVisibleProp ?? true
  const setMarkdownVisible = (v: boolean | ((prev: boolean) => boolean)) => {
    if (onToggleEditor && (typeof v === 'boolean' ? v !== markdownVisible : true)) onToggleEditor()
  }
  const setTerminalVisible = (v: boolean | ((prev: boolean) => boolean)) => {
    if (onToggleTerminal && (typeof v === 'boolean' ? v !== terminalVisible : true)) onToggleTerminal()
  }
  const containerRef = useRef<HTMLDivElement>(null)

  const handleResize = useCallback((delta: number) => {
    setMarkdownWidth((prev) => {
      const containerWidth = containerRef.current?.offsetWidth || window.innerWidth
      const deltaPct = (delta / containerWidth) * 100
      return Math.min(85, Math.max(15, prev + deltaPct))
    })
  }, [])

  const bothVisible = markdownVisible && terminalVisible
  const isKanban = activeView === 'kanban'

  const leftPaneContent = (
    <Suspense fallback={<div style={{ flex: 1, background: 'var(--color-bg-primary)' }} />}>
      {isKanban ? <KanbanBoard /> : <MarkdownArea />}
    </Suspense>
  )

  return (
    <div className="main-area" ref={containerRef}>
      {markdownVisible && (
        <div
          className="main-area__pane"
          style={{
            width: bothVisible ? `${markdownWidth}%` : undefined,
            flex: bothVisible ? `0 0 ${markdownWidth}%` : 1
          }}
        >
          {leftPaneContent}
        </div>
      )}

      {bothVisible ? (
        <div className="main-area__splitter-wrap">
          <Splitter onResize={handleResize} direction="vertical" />
          <div className="main-area__splitter-toggles">
            <button
              className="main-area__pane-toggle"
              onClick={() => setMarkdownVisible(false)}
              title="Hide Editor"
            >
              <ChevronLeft size={10} />
            </button>
            <button
              className="main-area__pane-toggle"
              onClick={() => setTerminalVisible(false)}
              title="Hide Terminal"
            >
              <ChevronRight size={10} />
            </button>
          </div>
        </div>
      ) : !markdownVisible && terminalVisible ? (
        <div className="main-area__edge-toggle main-area__edge-toggle--left">
          <button
            className="main-area__pane-toggle"
            onClick={() => setMarkdownVisible(true)}
            title="Show Editor"
          >
            <ChevronRight size={10} />
          </button>
        </div>
      ) : markdownVisible && !terminalVisible ? (
        <div className="main-area__edge-toggle main-area__edge-toggle--right">
          <button
            className="main-area__pane-toggle"
            onClick={() => setTerminalVisible(true)}
            title="Show Terminal"
          >
            <ChevronLeft size={10} />
          </button>
        </div>
      ) : null}

      {terminalVisible && (
        <div
          className="main-area__pane"
          style={{
            flex: bothVisible ? `0 0 ${100 - markdownWidth}%` : 1
          }}
        >
          <TerminalArea />
        </div>
      )}
    </div>
  )
}

export default MainArea
