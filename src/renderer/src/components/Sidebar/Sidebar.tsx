import React, { useState } from 'react'
import './Sidebar.css'
import { TerminalTree } from './TerminalTree'
import { FileExplorer } from './FileExplorer'
import { KanbanIssueDocTree } from './KanbanIssueDocTree'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import SearchView from '../Search/SearchView'
import SettingsView from '../Settings/SettingsView'

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
  const [fileExplorerSectionOpen, setFileExplorerSectionOpen] = useState(true)

  if (!isVisible) return null

  const clampedWidth = Math.min(500, Math.max(150, width))

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
                <span>칸반 이슈 문서</span>
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
                <span>터미널</span>
              </div>
              {terminalSectionOpen && <TerminalTree />}
            </div>
            {/* Section 3: File Explorer */}
            <div className="sidebar__section">
              <div
                className="sidebar__section-header"
                onClick={() => setFileExplorerSectionOpen((o) => !o)}
              >
                <span className="sidebar__section-chevron">{fileExplorerSectionOpen ? '▾' : '▶'}</span>
                <span>파일 탐색기</span>
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
