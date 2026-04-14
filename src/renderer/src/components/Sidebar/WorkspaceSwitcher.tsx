import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import './WorkspaceSwitcher.css'

interface WorkspaceInfo {
  path: string
  name: string
}

interface WorkspaceSwitcherProps {
  currentWorkspace: WorkspaceInfo | null
  recentWorkspaces: string[]
  onOpen: () => void
  onOpenPath: (path: string) => void
}

function getNameFromPath(folderPath: string): string {
  return folderPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? folderPath
}

function WorkspaceSwitcher({
  currentWorkspace,
  recentWorkspaces,
  onOpen,
  onOpenPath
}: WorkspaceSwitcherProps): React.JSX.Element {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev)
    setSearch('')
  }, [])

  const handleOpenPath = useCallback(
    (path: string) => {
      onOpenPath(path)
      setIsOpen(false)
    },
    [onOpenPath]
  )

  const handleOpen = useCallback(() => {
    onOpen()
    setIsOpen(false)
  }, [onOpen])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus()
    }
  }, [isOpen])

  const filtered = recentWorkspaces.filter((p) =>
    getNameFromPath(p).toLowerCase().includes(search.toLowerCase()) ||
    p.toLowerCase().includes(search.toLowerCase())
  )

  const displayName = currentWorkspace?.name ?? t('workspace.switch')

  return (
    <div className="ws-switcher" ref={dropdownRef}>
      <button className="ws-switcher__trigger" onClick={handleToggle} title={currentWorkspace?.path}>
        <span className="ws-switcher__name">{displayName}</span>
        <span className={`ws-switcher__chevron${isOpen ? ' ws-switcher__chevron--open' : ''}`}>
          ▾
        </span>
      </button>

      {isOpen && (
        <div className="ws-switcher__dropdown">
          <div className="ws-switcher__search">
            <input
              ref={searchRef}
              className="ws-switcher__search-input"
              type="text"
              placeholder="Search workspaces..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="ws-switcher__list">
            {filtered.length === 0 ? (
              <div className="ws-switcher__empty">No results found</div>
            ) : (
              filtered.map((wsPath) => {
                const isActive = currentWorkspace?.path === wsPath
                return (
                  <button
                    key={wsPath}
                    className={`ws-switcher__item${isActive ? ' ws-switcher__item--active' : ''}`}
                    onClick={() => handleOpenPath(wsPath)}
                    title={wsPath}
                  >
                    <span className="ws-switcher__item-indicator">{isActive ? '●' : ' '}</span>
                    <span className="ws-switcher__item-name">{getNameFromPath(wsPath)}</span>
                    <span className="ws-switcher__item-path">{wsPath}</span>
                  </button>
                )
              })
            )}
          </div>

          <div className="ws-switcher__footer">
            <button className="ws-switcher__open-btn" onClick={handleOpen}>
              <span>+</span>
              <span>{t('workspace.open')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default WorkspaceSwitcher
