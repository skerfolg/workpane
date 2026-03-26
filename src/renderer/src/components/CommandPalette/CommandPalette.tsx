import React, { useState, useEffect, useRef, useCallback } from 'react'
import './CommandPalette.css'

export interface Command {
  id: string
  label: string
  shortcut?: string
  action: () => void
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  commands: Command[]
}

export function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  )

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  // Keep active item scrolled into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const activeEl = list.querySelector<HTMLButtonElement>('.command-palette__item--active')
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const executeCommand = useCallback(
    (cmd: Command) => {
      cmd.action()
      onClose()
    },
    [onClose]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filtered[activeIndex]
        if (cmd) executeCommand(cmd)
        return
      }
    },
    [filtered, activeIndex, executeCommand, onClose]
  )

  // Reset active index when query changes
  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setQuery(e.target.value)
    setActiveIndex(0)
  }

  if (!isOpen) return null

  return (
    <div
      className="command-palette-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette__input-row">
          <input
            ref={inputRef}
            className="command-palette__input"
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={handleQueryChange}
            aria-label="Search commands"
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
          />
        </div>
        <div className="command-palette__list" ref={listRef} role="listbox">
          {filtered.length === 0 ? (
            <div className="command-palette__empty">No commands found</div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.id}
                className={`command-palette__item${idx === activeIndex ? ' command-palette__item--active' : ''}`}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setActiveIndex(idx)}
                role="option"
                aria-selected={idx === activeIndex}
              >
                <span className="command-palette__item-label">{cmd.label}</span>
                {cmd.shortcut && (
                  <span className="command-palette__item-shortcut">{cmd.shortcut}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
