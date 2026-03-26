import React, { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useEditor } from '../../contexts/EditorContext'
import MarkdownEditor from '../Editor/MarkdownEditor'
import EditorToolbar from '../Editor/EditorToolbar'
import Breadcrumb from '../Editor/Breadcrumb'
import FindReplaceBar from '../Editor/FindReplaceBar'
import ContextMenu, { ContextMenuItem } from '../ContextMenu/ContextMenu'
import { getLanguageFromPath } from '../Editor/EditorRouter'
import { getContent } from '../../utils/content-store'

const CodeEditor = lazy(() => import('../Editor/CodeEditor'))

function isMarkdownFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.md')
}

interface TabContextMenu {
  tabId: string
  x: number
  y: number
}

function EditorArea(): React.JSX.Element {
  const { tabs, activeTab, closeTab, setActiveTab, updateContent, saveFile, resolveConflict } = useEditor()
  const [toolbarVisible, setToolbarVisible] = useState(true)
  const [mode, setMode] = useState<'wysiwyg' | 'source'>('wysiwyg')
  const [showFindReplace, setShowFindReplace] = useState(false)
  const [findReplaceMode, setFindReplaceMode] = useState<'find' | 'replace'>('find')
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenu | null>(null)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault()
        setFindReplaceMode('find')
        setShowFindReplace(true)
      } else if (e.ctrlKey && e.key === 'h') {
        e.preventDefault()
        setFindReplaceMode('replace')
        setShowFindReplace(true)
      } else if (e.key === 'Escape' && showFindReplace) {
        setShowFindReplace(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showFindReplace])

  // Update scroll arrow visibility
  const updateArrows = (): void => {
    const el = tabBarRef.current
    if (!el) return
    setShowLeftArrow(el.scrollLeft > 0)
    setShowRightArrow(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  useEffect(() => {
    const el = tabBarRef.current
    if (!el) return
    updateArrows()
    el.addEventListener('scroll', updateArrows)
    const ro = new ResizeObserver(updateArrows)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateArrows)
      ro.disconnect()
    }
  }, [tabs])

  // Auto scroll active tab into view
  useEffect(() => {
    if (!activeTab) return
    const el = tabRefs.current.get(activeTab.id)
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [activeTab])

  // Mouse wheel → horizontal scroll on tab bar
  const handleTabBarWheel = (e: React.WheelEvent): void => {
    const el = tabBarRef.current
    if (!el) return
    e.preventDefault()
    el.scrollLeft += e.deltaY || e.deltaX
  }

  const scrollTabBar = (dir: 'left' | 'right'): void => {
    const el = tabBarRef.current
    if (!el) return
    el.scrollLeft += dir === 'left' ? -120 : 120
  }

  const handleTabMouseDown = (e: React.MouseEvent, id: string): void => {
    if (e.button === 1) {
      e.preventDefault()
      closeTab(id)
    }
  }

  const handleTabClose = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation()
    closeTab(id)
  }

  const handleTabContextMenu = (e: React.MouseEvent, tabId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setTabContextMenu({ tabId, x: e.clientX, y: e.clientY })
  }

  const getTabContextMenuItems = (tabId: string): ContextMenuItem[] => {
    const tab = tabs.find((t) => t.id === tabId)
    return [
      {
        label: 'Close',
        onClick: () => closeTab(tabId)
      },
      {
        label: 'Close Other Tabs',
        onClick: () => {
          tabs.filter((t) => t.id !== tabId).forEach((t) => closeTab(t.id))
        }
      },
      { label: '', onClick: () => {}, divider: true },
      {
        label: 'Copy Path',
        onClick: () => {
          if (tab?.filePath) {
            navigator.clipboard.writeText(tab.filePath).catch(() => {})
          }
        }
      }
    ]
  }

  return (
    <div
      className="markdown-area"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-1)' }}
    >
      {/* Tab Bar */}
      <div
        style={{
          height: '30px',
          backgroundColor: 'var(--sidebar-bg)',
          borderBottom: '1px solid var(--border-1)',
          display: 'flex',
          alignItems: 'stretch',
          flexShrink: 0,
          position: 'relative'
        }}
      >
        {/* Left scroll arrow */}
        {showLeftArrow && (
          <button
            onClick={() => scrollTabBar('left')}
            style={{
              width: '20px',
              flexShrink: 0,
              background: 'var(--sidebar-bg)',
              border: 'none',
              borderRight: '1px solid var(--border-1)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1
            }}
          >
            ‹
          </button>
        )}

        {/* Scrollable tab list */}
        <div
          ref={tabBarRef}
          role="tablist"
          aria-label="Editor tabs"
          onWheel={handleTabBarWheel}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'stretch',
            overflowX: 'hidden',
            overflowY: 'hidden'
          }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el)
                else tabRefs.current.delete(tab.id)
              }}
              role="tab"
              aria-selected={tab.isActive}
              onMouseDown={(e) => handleTabMouseDown(e, tab.id)}
              onClick={() => setActiveTab(tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
              title={tab.filePath}
              className="editor-tab"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '0 var(--sp-4)',
                minWidth: '80px',
                maxWidth: '180px',
                cursor: 'pointer',
                borderRight: '1px solid var(--border-1)',
                borderBottom: tab.isActive ? '2px solid var(--accent)' : '2px solid transparent',
                backgroundColor: tab.isActive ? 'var(--bg-1)' : 'var(--sidebar-bg)',
                color: tab.isActive ? 'var(--text-1)' : 'var(--text-2)',
                fontSize: 'var(--fs-sm)',
                fontWeight: tab.isActive ? 'var(--fw-medium)' : 'var(--fw-regular)',
                userSelect: 'none',
                flexShrink: 0,
                position: 'relative',
                boxSizing: 'border-box'
              }}
            >
              {tab.isDirty ? (
                <span style={{ color: 'var(--accent)', fontSize: '10px', flexShrink: 0 }}>●</span>
              ) : null}
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1
                }}
              >
                {tab.title}
              </span>
              <button
                onClick={(e) => handleTabClose(e, tab.id)}
                title="Close tab"
                className="editor-tab__close"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '14px',
                  height: '14px',
                  background: 'none',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  color: 'var(--text-2)',
                  fontSize: '14px',
                  flexShrink: 0,
                  padding: 0,
                  opacity: 0,
                  transition: 'opacity 0.1s'
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Right scroll arrow or toolbar restore button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            flexShrink: 0
          }}
        >
          {showRightArrow && (
            <button
              onClick={() => scrollTabBar('right')}
              style={{
                width: '20px',
                background: 'var(--sidebar-bg)',
                border: 'none',
                borderLeft: '1px solid var(--border-1)',
                color: 'var(--text-2)',
                cursor: 'pointer',
                fontSize: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ›
            </button>
          )}
          {/* Toolbar restore button: shown when toolbar hidden and active tab is .md */}
          {!toolbarVisible && activeTab && isMarkdownFile(activeTab.filePath) && (
            <button
              onClick={() => setToolbarVisible(true)}
              title="Show Toolbar"
              style={{
                width: '28px',
                background: 'var(--sidebar-bg)',
                border: 'none',
                borderLeft: '1px solid var(--border-1)',
                color: 'var(--text-2)',
                cursor: 'pointer',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ☰
            </button>
          )}
        </div>
      </div>

      {/* Tab hover CSS injection */}
      <style>{`
        .editor-tab:hover .editor-tab__close {
          opacity: 1 !important;
        }
      `}</style>

      {/* Editor Toolbar (only for .md files) */}
      {activeTab && toolbarVisible && isMarkdownFile(activeTab.filePath) && (
        <EditorToolbar
          mode={mode}
          onModeToggle={() => setMode((m) => (m === 'wysiwyg' ? 'source' : 'wysiwyg'))}
          onHideToolbar={() => setToolbarVisible(false)}
        />
      )}

      {/* Breadcrumb */}
      {activeTab && <Breadcrumb filePath={activeTab.filePath} />}

      {/* Find/Replace Bar */}
      {showFindReplace && activeTab && (
        <FindReplaceBar
          content={getContent(activeTab.filePath)}
          onReplace={(newContent) => updateContent(activeTab.id, newContent)}
          onClose={() => setShowFindReplace(false)}
          mode={findReplaceMode}
        />
      )}

      {/* Conflict Banner */}
      {activeTab?.isConflicted && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px',
            background: 'var(--color-warning)',
            color: '#000000',
            fontSize: 'var(--fs-sm)',
            flexShrink: 0
          }}
        >
          <span>File has been modified externally.</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => resolveConflict(activeTab.id, 'reload')}
              style={{
                padding: '2px 10px',
                background: '#000',
                color: '#fff',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: 'var(--fs-sm)'
              }}
            >
              Reload
            </button>
            <button
              onClick={() => resolveConflict(activeTab.id, 'ignore')}
              style={{
                padding: '2px 10px',
                background: 'transparent',
                color: '#000',
                border: '1px solid #000',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: 'var(--fs-sm)'
              }}
            >
              Ignore
            </button>
          </div>
        </div>
      )}

      {/* Editor Content */}
      <div role="tabpanel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab ? (
          isMarkdownFile(activeTab.filePath) ? (
            <MarkdownEditor
              key={activeTab.id}
              tabId={activeTab.id}
              content={getContent(activeTab.filePath)}
              filePath={activeTab.filePath}
              isDirty={activeTab.isDirty}
              onChange={updateContent}
              onSave={saveFile}
              externalMode={mode}
              onModeChange={setMode}
            />
          ) : (
            <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)' }}>Loading editor...</div>}>
              <CodeEditor
                key="code-editor"
                tabId={activeTab.id}
                content={getContent(activeTab.filePath)}
                filePath={activeTab.filePath}
                language={getLanguageFromPath(activeTab.filePath)}
                onChange={(content) => updateContent(activeTab.id, content)}
                onSave={() => saveFile(activeTab.id)}
              />
            </Suspense>
          )
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-2)',
              fontSize: 'var(--fs-md)'
            }}
          >
            Open a file
          </div>
        )}
      </div>

      {/* Tab Context Menu */}
      {tabContextMenu && (
        <ContextMenu
          items={getTabContextMenuItems(tabContextMenu.tabId)}
          position={{ x: tabContextMenu.x, y: tabContextMenu.y }}
          onClose={() => setTabContextMenu(null)}
        />
      )}
    </div>
  )
}

export default EditorArea
// Backward compat alias
export { EditorArea as MarkdownArea }
