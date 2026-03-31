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
import { useNotifications } from '../../contexts/NotificationContext'
import logoIcon from '../../assets/logo.png'
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
  const { notifications } = useNotifications()
  const notificationCount = notifications.length
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
        <img src={logoIcon} alt="WorkPane" className="titlebar-app-icon" />
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
            title="Toggle Sidebar (Ctrl+B)"
          >
            <PanelLeft size={14} />
          </button>
          <button
            className={`titlebar-toggle ${editorVisible ? 'active' : ''}`}
            onClick={onToggleEditor}
            title="Toggle Editor"
          >
            <FileText size={14} />
          </button>
          <button
            className={`titlebar-toggle ${terminalVisible ? 'active' : ''}`}
            onClick={onToggleTerminal}
            title="Toggle Terminal"
          >
            <TerminalSquare size={14} />
          </button>
          <button
            className={`titlebar-toggle ${notificationCount > 0 ? 'titlebar-toggle--has-notifications' : ''}`}
            title={notificationCount > 0 ? `${notificationCount} notification(s)` : 'No notifications'}
          >
            <Bell size={14} />
            {notificationCount > 0 && (
              <span className="titlebar-notification-badge">{notificationCount}</span>
            )}
          </button>
        </div>

        <div className="titlebar-window-controls">
          <button className="titlebar-btn titlebar-btn-minimize" onClick={handleMinimize} title="Minimize">
            <Minus size={14} />
          </button>
          <button className="titlebar-btn titlebar-btn-maximize" onClick={handleMaximize} title={isMaximized ? 'Restore' : 'Maximize'}>
            {isMaximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button className="titlebar-btn titlebar-btn-close" onClick={handleClose} title="Close">
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
