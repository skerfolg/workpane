import React, { useContext } from 'react'
import { EditorContext } from '../../contexts/EditorContext'
import { IssueContext } from '../../contexts/IssueContext'
import { TerminalContext } from '../../contexts/TerminalContext'
import './StatusBar.css'

interface StatusBarProps {
  workspaceName?: string | null
}

export function StatusBar({ workspaceName }: StatusBarProps): React.JSX.Element {
  const editorCtx = useContext(EditorContext)
  const issueCtx = useContext(IssueContext)
  const terminalCtx = useContext(TerminalContext)

  const openCount = issueCtx?.issues.filter((i) => i.status === 'open').length ?? 0
  const inProgCount = issueCtx?.issues.filter((i) => i.status === 'in-progress').length ?? 0
  const terminalCount = terminalCtx?.terminals.length ?? 0
  const activeFile = editorCtx?.activeTab?.title ?? null

  return (
    <div className="status-bar" role="status" aria-label="Status bar">
      <div className="status-bar__left">
        <span className="status-bar__item status-bar__workspace" title="Current workspace">
          {workspaceName ?? 'No Workspace'}
        </span>
      </div>

      <div className="status-bar__center">
        {issueCtx && (
          <span className="status-bar__item" title="Issue stats">
            {openCount} open
            <span className="status-bar__sep">│</span>
            {inProgCount} in-prog
          </span>
        )}
      </div>

      <div className="status-bar__right">
        {terminalCount > 0 && (
          <>
            <span className="status-bar__item" title="Terminal count">
              {terminalCount} terminal{terminalCount !== 1 ? 's' : ''}
            </span>
            <span className="status-bar__sep">│</span>
          </>
        )}
        {activeFile && (
          <>
            <span className="status-bar__item status-bar__filename" title={activeFile}>
              {activeFile}
            </span>
            <span className="status-bar__sep">│</span>
          </>
        )}
        <span className="status-bar__item">Ln 1</span>
      </div>
    </div>
  )
}

export default StatusBar
