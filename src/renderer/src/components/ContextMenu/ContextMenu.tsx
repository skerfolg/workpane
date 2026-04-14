import React, { useEffect, useRef, useState } from 'react'
import './ContextMenu.css'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  shortcut?: string
  divider?: boolean
  danger?: boolean
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  position: { x: number; y: number }
  onClose: () => void
}

const MENU_MIN_WIDTH = 180
const MENU_EDGE_GAP = 4

function ContextMenu({ items, position, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState({ x: position.x, y: position.y })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const handleOutsideInteraction = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Close on any click, mousedown, or right-click outside the menu
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleOutsideInteraction)
    document.addEventListener('click', handleOutsideInteraction)
    document.addEventListener('contextmenu', handleOutsideInteraction)
    // Also close on scroll and window blur
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleOutsideInteraction)
      document.removeEventListener('click', handleOutsideInteraction)
      document.removeEventListener('contextmenu', handleOutsideInteraction)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // Compute viewport-constrained position after mount
  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = position.x
    let y = position.y

    // Flip horizontally if would overflow right edge
    if (x + rect.width > vw - MENU_EDGE_GAP) {
      x = Math.max(MENU_EDGE_GAP, vw - rect.width - MENU_EDGE_GAP)
    }
    if (x < MENU_EDGE_GAP) x = MENU_EDGE_GAP

    // Flip vertically if would overflow bottom edge
    if (y + rect.height > vh - MENU_EDGE_GAP) {
      y = Math.max(MENU_EDGE_GAP, vh - rect.height - MENU_EDGE_GAP)
    }
    if (y < MENU_EDGE_GAP) y = MENU_EDGE_GAP

    setAdjustedPos({ x, y })
  }, [position.x, position.y])

  const style: React.CSSProperties = {
    position: 'fixed',
    top: adjustedPos.y,
    left: adjustedPos.x,
    zIndex: 9999,
    minWidth: MENU_MIN_WIDTH
  }

  return (
    <div ref={menuRef} className="context-menu" style={style} role="menu">
      {items.map((item, idx) =>
        item.divider ? (
          <div key={idx} className="context-menu__divider" role="separator" />
        ) : (
          <button
            key={idx}
            className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
            role="menuitem"
            onClick={() => {
              item.onClick()
              onClose()
            }}
          >
            <span className="context-menu__label">{item.label}</span>
            {item.shortcut && (
              <span className="context-menu__shortcut">{item.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  )
}

export default ContextMenu
