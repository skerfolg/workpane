import React, { useState } from 'react'
import './Sidebar.css'
import MonitoringQueue from './MonitoringQueue'
import { TerminalTree } from './TerminalTree'
import { FileExplorer } from './FileExplorer'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import SearchView from '../Search/SearchView'
import SettingsView from '../Settings/SettingsView'
import { useMonitoring } from '../../contexts/MonitoringContext'

interface WorkspaceInfo {
  path: string
  name: string
}

interface SidebarProps {
  activeView: 'explorer' | 'search' | 'settings'
  width: number
  isVisible: boolean
  currentWorkspace: WorkspaceInfo | null
  recentWorkspaces: string[]
  onOpenWorkspace: () => void
  onOpenWorkspacePath: (path: string) => void
}

const TERMINAL_SECTION_CUE_STYLE: React.CSSProperties = {
  marginLeft: 'auto',
  minWidth: '18px',
  height: '18px',
  padding: '0 6px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '999px',
  backgroundColor: 'rgba(245, 158, 11, 0.16)',
  border: '1px solid rgba(245, 158, 11, 0.32)',
  color: '#f59e0b',
  fontSize: '11px',
  fontWeight: 700,
  lineHeight: 1
}

function Sidebar({
  activeView,
  width,
  isVisible,
  currentWorkspace,
  recentWorkspaces,
  onOpenWorkspace,
  onOpenWorkspacePath
}: SidebarProps): React.JSX.Element | null {
  const [terminalSectionOpen, setTerminalSectionOpen] = useState(true)
  const [queueSectionOpen, setQueueSectionOpen] = useState(true)
  const [fileExplorerSectionOpen, setFileExplorerSectionOpen] = useState(true)
  const { queueItems, sidebarSectionCue, createManualTask } = useMonitoring()
  const recentCompletedItems = queueItems.filter((entry) => entry.kind === 'completed')
  const activeQueueItems = queueItems.filter((entry) => entry.kind !== 'completed')

  if (!isVisible) return null

  const clampedWidth = Math.min(500, Math.max(150, width))
  const affectedGroupCount = sidebarSectionCue.affectedGroupCount

  return (
    <div className="sidebar" role="complementary" aria-label="Sidebar" style={{ width: clampedWidth }}>
      <div className="sidebar__header">
        <WorkspaceSwitcher
          currentWorkspace={currentWorkspace}
          recentWorkspaces={recentWorkspaces}
          onOpen={onOpenWorkspace}
          onOpenPath={onOpenWorkspacePath}
        />
      </div>
      <div className="sidebar__content">
        {activeView === 'explorer' ? (
          <div className="sidebar__explorer">
            {/* Section 1: Terminal */}
            <div className="sidebar__section">
              <div
                className="sidebar__section-header"
                onClick={() => setTerminalSectionOpen((o) => !o)}
              >
                <span className="sidebar__section-chevron">{terminalSectionOpen ? '▾' : '▶'}</span>
                <span>Terminal</span>
                <button
                  type="button"
                  data-testid="sidebar-add-task"
                  className="sidebar__section-action"
                  onClick={(event) => {
                    event.stopPropagation()
                    const title = prompt('Task title')
                    if (!title?.trim()) {
                      return
                    }
                    const note = prompt('Optional note') ?? ''
                    void createManualTask(title.trim(), note.trim() || null)
                  }}
                >
                  Add task
                </button>
                {affectedGroupCount > 0 && (
                  <span
                    aria-label={`${affectedGroupCount} groups need attention`}
                    title={`${affectedGroupCount} groups need attention`}
                    style={TERMINAL_SECTION_CUE_STYLE}
                  >
                    {affectedGroupCount}
                  </span>
                )}
              </div>
              {terminalSectionOpen && (
                <>
                  {(activeQueueItems.length > 0 || recentCompletedItems.length > 0) && (
                    <div className="sidebar__subsection" data-testid="monitoring-queue-subsection">
                      <div
                        className="sidebar__subsection-header"
                        onClick={() => setQueueSectionOpen((open) => !open)}
                      >
                        <span className="sidebar__section-chevron">{queueSectionOpen ? '▾' : '▶'}</span>
                        <span>Queue</span>
                        <span className="sidebar__subsection-count">{activeQueueItems.length}</span>
                      </div>
                      {queueSectionOpen && <MonitoringQueue />}
                    </div>
                  )}
                  <TerminalTree />
                </>
              )}
            </div>
            {/* Section 2: File Explorer */}
            <div className="sidebar__section">
              <div
                className="sidebar__section-header"
                onClick={() => setFileExplorerSectionOpen((o) => !o)}
              >
                <span className="sidebar__section-chevron">{fileExplorerSectionOpen ? '▾' : '▶'}</span>
                <span>File Explorer</span>
              </div>
              {fileExplorerSectionOpen && currentWorkspace && (
                <FileExplorer workspacePath={currentWorkspace.path} />
              )}
            </div>
          </div>
        ) : activeView === 'search' ? (
          <SearchView />
        ) : activeView === 'settings' ? (
          <SettingsView />
        ) : null}
      </div>
    </div>
  )
}

export default Sidebar
