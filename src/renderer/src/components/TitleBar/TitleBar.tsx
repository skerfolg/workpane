import React, { useState, useEffect, useCallback } from 'react'
import {
  Minus,
  Square,
  Copy,
  X,
  PanelLeft,
  FileText,
  TerminalSquare,
  Bell
} from 'lucide-react'
import './TitleBar.css'

interface TitleBarProps {
  workspaceName: string | null
  sidebarVisible: boolean
  editorVisible: boolean
  terminalVisible: boolean
  onToggleSidebar: () => void
  onToggleEditor: () => void
  onToggleTerminal: () => void
}

export default function TitleBar({
  workspaceName,
  sidebarVisible,
  editorVisible,
  terminalVisible,
  onToggleSidebar,
  onToggleEditor,
  onToggleTerminal
}: TitleBarProps): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const win = (window as any).appWindow
    if (!win) return

    win.isMaximized().then((v: boolean) => setIsMaximized(v))
    const cleanup = win.onMaximizedChanged((v: boolean) => setIsMaximized(v))
    return cleanup
  }, [])

  const handleMinimize = useCallback(() => {
    ;(window as any).appWindow?.minimize()
  }, [])

  const handleMaximize = useCallback(() => {
    ;(window as any).appWindow?.maximize()
  }, [])

  const handleClose = useCallback(() => {
    ;(window as any).appWindow?.close()
  }, [])

  return (
    <div className="titlebar">
      {/* Left: App name */}
      <div className="titlebar-left">
        <span className="titlebar-app-icon">◆</span>
        <span className="titlebar-app-name">WorkPane</span>
      </div>

      {/* Center: Workspace name */}
      <div className="titlebar-center">
        {workspaceName && (
          <span className="titlebar-workspace">{workspaceName}</span>
        )}
      </div>

      {/* Right: Toggle icons + Window controls */}
      <div className="titlebar-right">
        <div className="titlebar-toggles">
          <button
            className={`titlebar-toggle ${sidebarVisible ? 'active' : ''}`}
            onClick={onToggleSidebar}
            title="사이드바 토글 (Ctrl+B)"
          >
            <PanelLeft size={14} />
          </button>
          <button
            className={`titlebar-toggle ${editorVisible ? 'active' : ''}`}
            onClick={onToggleEditor}
            title="에디터 토글"
          >
            <FileText size={14} />
          </button>
          <button
            className={`titlebar-toggle ${terminalVisible ? 'active' : ''}`}
            onClick={onToggleTerminal}
            title="터미널 토글"
          >
            <TerminalSquare size={14} />
          </button>
          <button
            className="titlebar-toggle"
            title="알림"
            disabled
          >
            <Bell size={14} />
          </button>
        </div>

        <div className="titlebar-window-controls">
          <button className="titlebar-btn titlebar-btn-minimize" onClick={handleMinimize} title="최소화">
            <Minus size={14} />
          </button>
          <button className="titlebar-btn titlebar-btn-maximize" onClick={handleMaximize} title={isMaximized ? '이전 크기로 복원' : '최대화'}>
            {isMaximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button className="titlebar-btn titlebar-btn-close" onClick={handleClose} title="닫기">
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
