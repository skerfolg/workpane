import React, { useState } from 'react'
import './Sidebar.css'
import MonitoringQueue from './MonitoringQueue'
import { TerminalTree } from './TerminalTree'
import { FileExplorer } from './FileExplorer'
import { KanbanIssueDocTree } from './KanbanIssueDocTree'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import SearchView from '../Search/SearchView'
import SettingsView from '../Settings/SettingsView'
import SkillsView from '../Skills/SkillsView'
import { useMonitoring } from '../../contexts/MonitoringContext'

interface WorkspaceInfo {
  path: string
  name: string
}

interface SidebarProps {
  activeView: 'explorer' | 'search' | 'settings' | 'skills'
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
  const [kanbanDocsSectionOpen, setKanbanDocsSectionOpen] = useState(true)
  const [terminalSectionOpen, setTerminalSectionOpen] = useState(true)
  const [queueSectionOpen, setQueueSectionOpen] = useState(true)
  const [fileExplorerSectionOpen, setFileExplorerSectionOpen] = useState(true)
  const { attentionQueue, sidebarSectionCue } = useMonitoring()

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
            {/* Section 1: Kanban Issue Docs */}
            <div className="sidebar__section">
              <div
                className="sidebar__section-header"
                onClick={() => setKanbanDocsSectionOpen((o) => !o)}
              >
                <span className="sidebar__section-chevron">{kanbanDocsSectionOpen ? '▾' : '▶'}</span>
                <span>Kanban Issue Docs</span>
              </div>
              {kanbanDocsSectionOpen && <KanbanIssueDocTree />}
            </div>
            {/* Section 2: Terminal */}
            <div className="sidebar__section">
              <div
                className="sidebar__section-header"
                onClick={() => setTerminalSectionOpen((o) => !o)}
              >
                <span className="sidebar__section-chevron">{terminalSectionOpen ? '▾' : '▶'}</span>
                <span>Terminal</span>
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
                  {attentionQueue.length > 0 && (
                    <div className="sidebar__subsection" data-testid="monitoring-queue-subsection">
                      <div
                        className="sidebar__subsection-header"
                        onClick={() => setQueueSectionOpen((open) => !open)}
                      >
                        <span className="sidebar__section-chevron">{queueSectionOpen ? '▾' : '▶'}</span>
                        <span>Queue</span>
                        <span className="sidebar__subsection-count">{attentionQueue.length}</span>
                      </div>
                      {queueSectionOpen && <MonitoringQueue />}
                    </div>
                  )}
                  <TerminalTree />
                </>
              )}
            </div>
            {/* Section 3: File Explorer */}
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
        ) : activeView === 'skills' ? (
          <SkillsView />
        ) : null}
      </div>
    </div>
  )
}

export default Sidebar
