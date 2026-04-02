import React, { useState, useCallback, useEffect, Suspense, lazy } from 'react'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { TerminalProvider, useTerminals } from './contexts/TerminalContext'
import { EditorProvider, useEditor } from './contexts/EditorContext'
import { IssueProvider, useIssues } from './contexts/IssueContext'
import { KanbanProvider } from './contexts/KanbanContext'
import { NotificationProvider, useNotifications } from './contexts/NotificationContext'
import { SkillsProvider } from './contexts/SkillsContext'
import { ToastProvider } from './components/Toast/Toast'
import ActivityBar, { ViewType } from './components/ActivityBar/ActivityBar'
import Sidebar from './components/Sidebar/Sidebar'
import Splitter from './components/Splitter/Splitter'
import Welcome from './components/Welcome/Welcome'
import TitleBar from './components/TitleBar/TitleBar'
import LoadingBar from './components/LoadingBar/LoadingBar'
import StatusBar from './components/StatusBar/StatusBar'
import NotificationBanner from './components/NotificationBanner/NotificationBanner'
import { CommandPalette, Command } from './components/CommandPalette/CommandPalette'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useWorkspace } from './hooks/useWorkspace'
import i18n from './i18n'

// Lazy-load heavy components to defer their JS parsing/evaluation
const MainArea = lazy(() => import('./components/MainArea/MainArea'))

const SIDEBAR_DEFAULT_WIDTH = 250
const SIDEBAR_MIN_WIDTH = 150
const SIDEBAR_MAX_WIDTH = 500

// Inner app that has access to all contexts
function AppInner(): React.JSX.Element {
  const _s = (window as any).__rendererStart ?? performance.now()
  useEffect(() => {
    console.log(`[TIMELINE] ${(performance.now() - _s).toFixed(0)}ms — AppInner mounted (UI tree ready)`)
  }, [])
  const [activeView, setActiveView] = useState<ViewType>('explorer')
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [wsSwitcherOpen, setWsSwitcherOpen] = useState(false)
  const [wsSwitcherSearch, setWsSwitcherSearch] = useState('')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [editorVisible, setEditorVisible] = useState(true)
  const [terminalVisible, setTerminalVisible] = useState(true)

  const { currentWorkspace, recentWorkspaces, openWorkspace, openWorkspacePath } = useWorkspace()

  // Apply saved language on startup
  useEffect(() => {
    window.settings.get().then((raw) => {
      const s = raw as Record<string, unknown> | null
      const general = s?.general as Record<string, unknown> | undefined
      if (general?.language && typeof general.language === 'string') {
        i18n.changeLanguage(general.language)
      }
    })
  }, [])
  const { toggleTheme } = useTheme()
  const { createTerminal, splitPanel, focusedPanelId } = useTerminals()
  const { activeTab, closeTab, tabs, setActiveTab, saveFile } = useEditor()
  const { loading: issuesLoading } = useIssues()
  const { notifications, dismissNotification, handleNotificationClick } = useNotifications()

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((prev) =>
      Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, prev + delta))
    )
  }, [])

  // Build command list for CommandPalette
  const commands: Command[] = [
    {
      id: 'toggle-theme',
      label: 'Toggle Theme',
      shortcut: '',
      action: toggleTheme
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle Sidebar',
      shortcut: 'Ctrl+B',
      action: () => setSidebarVisible((prev) => !prev)
    },
    {
      id: 'new-terminal',
      label: 'New Terminal',
      shortcut: 'Ctrl+Shift+T',
      action: createTerminal
    },
    {
      id: 'toggle-kanban',
      label: 'Toggle Kanban',
      shortcut: 'Ctrl+Shift+K',
      action: () => setActiveView((prev) => (prev === 'kanban' ? 'explorer' : 'kanban'))
    },
    {
      id: 'open-search',
      label: 'Open Search',
      shortcut: 'Ctrl+Shift+F',
      action: () => setActiveView('search')
    },
    {
      id: 'split-vertical',
      label: 'Split Terminal Vertical',
      shortcut: 'Ctrl+\\',
      action: () => { if (focusedPanelId) splitPanel(focusedPanelId, 'vertical') }
    },
    {
      id: 'split-horizontal',
      label: 'Split Terminal Horizontal',
      shortcut: 'Ctrl+Shift+\\',
      action: () => { if (focusedPanelId) splitPanel(focusedPanelId, 'horizontal') }
    },
    {
      id: 'save-file',
      label: 'Save File',
      shortcut: 'Ctrl+S',
      action: () => {
        if (activeTab) saveFile(activeTab.id)
      }
    },
    {
      id: 'close-tab',
      label: 'Close Tab',
      shortcut: 'Ctrl+W',
      action: () => {
        if (activeTab) closeTab(activeTab.id)
      }
    },
    {
      id: 'switch-workspace',
      label: 'Switch Workspace',
      shortcut: 'Ctrl+Shift+W',
      action: () => {
        setWsSwitcherOpen((prev) => !prev)
        setWsSwitcherSearch('')
      }
    },
    {
      id: 'open-folder',
      label: 'Open Folder',
      shortcut: '',
      action: openWorkspace
    },
    {
      id: 'open-explorer',
      label: 'Open Explorer',
      shortcut: 'Ctrl+E',
      action: () => setActiveView('explorer')
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      shortcut: '',
      action: () => setActiveView('settings')
    }
  ]

  useKeyboardShortcuts({
    onToggleCommandPalette: () => setCommandPaletteOpen((prev) => !prev),
    onSwitchWorkspace: () => {
      setWsSwitcherOpen((prev) => !prev)
      setWsSwitcherSearch('')
    },
    onToggleSidebar: () => setSidebarVisible((prev) => !prev),
    onToggleTerminal: () => {
      // Toggle terminal by switching to explorer or staying; handled by MainArea
    },
    onNewTerminal: createTerminal,
    onSplitVertical: () => { if (focusedPanelId) splitPanel(focusedPanelId, 'vertical') },
    onSplitHorizontal: () => { if (focusedPanelId) splitPanel(focusedPanelId, 'horizontal') },
    onNextTab: () => {
      if (tabs.length < 2) return
      const idx = tabs.findIndex((t) => t.isActive)
      const nextIdx = (idx + 1) % tabs.length
      setActiveTab(tabs[nextIdx].id)
    },
    onCloseTab: () => {
      if (activeTab) closeTab(activeTab.id)
    },
    onOpenSearch: () => setActiveView('search'),
    onToggleKanban: () => setActiveView((prev) => (prev === 'kanban' ? 'explorer' : 'kanban')),
    onOpenExplorer: () => setActiveView('explorer'),
    onSaveFile: () => {
      if (activeTab) saveFile(activeTab.id)
    }
  })

  // Escape for workspace switcher (kept separate from useKeyboardShortcuts to avoid conflicts)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && wsSwitcherOpen) {
        setWsSwitcherOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [wsSwitcherOpen])

  const showSidebar = sidebarVisible

  const filteredRecent = recentWorkspaces.filter((p) => {
    const name = p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
    return (
      name.toLowerCase().includes(wsSwitcherSearch.toLowerCase()) ||
      p.toLowerCase().includes(wsSwitcherSearch.toLowerCase())
    )
  })

  // No workspace open → show Welcome screen
  if (!currentWorkspace) {
    return (
      <div
        className="app-container"
        style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}
      >
        <TitleBar
          workspaceName={null}
          sidebarVisible={false}
          editorVisible={false}
          terminalVisible={false}
          onToggleSidebar={() => {}}
          onToggleEditor={() => {}}
          onToggleTerminal={() => {}}
        />
        <Welcome
          recentWorkspaces={recentWorkspaces}
          onOpen={openWorkspace}
          onOpenPath={openWorkspacePath}
        />
      </div>
    )
  }

  return (
    <div
      className="app-container"
      style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}
    >
      <TitleBar
        workspaceName={currentWorkspace?.name ?? null}
        sidebarVisible={sidebarVisible}
        editorVisible={editorVisible}
        terminalVisible={terminalVisible}
        onToggleSidebar={() => setSidebarVisible((prev) => !prev)}
        onToggleEditor={() => setEditorVisible((prev) => !prev)}
        onToggleTerminal={() => setTerminalVisible((prev) => !prev)}
      />
      <LoadingBar active={issuesLoading} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ActivityBar activeView={activeView} onViewChange={setActiveView} />
        {showSidebar && (
          <>
            <Sidebar
              activeView={activeView as 'explorer' | 'search' | 'settings' | 'skills'}
              width={sidebarWidth}
              isVisible={true}
              currentWorkspace={currentWorkspace}
              recentWorkspaces={recentWorkspaces}
              onOpenWorkspace={openWorkspace}
              onOpenWorkspacePath={openWorkspacePath}
            />
            <Splitter onResize={handleSidebarResize} direction="vertical" />
          </>
        )}
        <Suspense fallback={<div style={{ flex: 1 }} />}>
          <MainArea
            activeView={activeView}
            editorVisible={editorVisible}
            terminalVisible={terminalVisible}
            onToggleEditor={() => setEditorVisible((prev) => !prev)}
            onToggleTerminal={() => setTerminalVisible((prev) => !prev)}
          />
        </Suspense>
      </div>

      <StatusBar workspaceName={currentWorkspace?.name ?? null} />

      <NotificationBanner
        notifications={notifications}
        onClickNotification={handleNotificationClick}
        onDismiss={dismissNotification}
      />

      {/* Ctrl+Shift+P Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={commands}
      />

      {/* Ctrl+Shift+W workspace switcher modal */}
      {wsSwitcherOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '80px',
            zIndex: 1000
          }}
          onClick={() => setWsSwitcherOpen(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--color-bg-tertiary)',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              width: '480px',
              maxHeight: '400px',
              overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              type="text"
              placeholder="Search workspaces..."
              value={wsSwitcherSearch}
              onChange={(e) => setWsSwitcherSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                flexShrink: 0
              }}
            />
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {filteredRecent.length === 0 ? (
                <div
                  style={{
                    padding: '16px',
                    color: 'var(--color-text-secondary)',
                    fontSize: '13px'
                  }}
                >
                  No recent workspaces.
                </div>
              ) : (
                filteredRecent.map((wsPath) => {
                  const name =
                    wsPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? wsPath
                  const isActive = currentWorkspace?.path === wsPath
                  return (
                    <button
                      key={wsPath}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        width: '100%',
                        padding: '10px 16px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: isActive ? 'var(--color-accent)' : 'var(--color-text-primary)',
                        fontSize: '13px'
                      }}
                      onClick={() => {
                        openWorkspacePath(wsPath)
                        setWsSwitcherOpen(false)
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>
                        {isActive ? '● ' : ''}
                        {name}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                        {wsPath}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
            <div
              style={{
                borderTop: '1px solid var(--color-border)',
                padding: '8px',
                flexShrink: 0
              }}
            >
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-secondary)',
                  fontSize: '13px',
                  borderRadius: '3px'
                }}
                onClick={() => {
                  openWorkspace()
                  setWsSwitcherOpen(false)
                }}
              >
                + Open Folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AppProviderMount(): React.JSX.Element {
  useEffect(() => {
    const start = performance.now()
    console.log(`[PERF][Renderer] App providers mount: ${(performance.now() - start).toFixed(1)}ms`)
  }, [])
  return <AppInner />
}

function AppWithSkills(): React.JSX.Element {
  const { currentWorkspace } = useWorkspace()
  return (
    <SkillsProvider workspacePath={currentWorkspace?.path ?? null}>
      <AppProviderMount />
    </SkillsProvider>
  )
}

function App(): React.JSX.Element {
  const _s = (window as any).__rendererStart ?? performance.now()
  useEffect(() => {
    console.log(`[TIMELINE] ${(performance.now() - _s).toFixed(0)}ms — App mounted (all providers ready)`)
    requestAnimationFrame(() => {
      console.log(`[TIMELINE] ${(performance.now() - _s).toFixed(0)}ms — App first paint after mount`)
      requestIdleCallback(() => {
        console.log(`[TIMELINE] ${(performance.now() - _s).toFixed(0)}ms — App idle (fully interactive)`)
      })
    })
  }, [])
  return (
    <ThemeProvider>
      <ToastProvider>
        <TerminalProvider>
          <NotificationProvider>
            <EditorProvider>
              <IssueProvider>
                <KanbanProvider>
                  <AppWithSkills />
                </KanbanProvider>
              </IssueProvider>
            </EditorProvider>
          </NotificationProvider>
        </TerminalProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
