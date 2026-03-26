import React, { useState, useRef } from 'react'
import { useTerminals } from '../../contexts/TerminalContext'
import type { TerminalGroup } from '../../types/terminal-layout'
import './TerminalTree.css'

interface ContextMenu {
  type: 'group' | 'terminal'
  id: string
  groupId: string
  x: number
  y: number
}

interface RenameState {
  type: 'group' | 'terminal'
  id: string
  value: string
}

export function TerminalTree(): React.JSX.Element {
  const {
    terminals,
    activeTerminalId,
    groups,
    activeGroupId,
    createTerminal,
    removeTerminal,
    renameTerminal,
    setActiveTerminal,
    reorderTerminals,
    createGroup,
    deleteGroup,
    renameGroup,
    switchGroup,
    toggleGroupCollapse,
    moveTerminalToGroup
  } = useTerminals()

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [renameState, setRenameState] = useState<RenameState | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const dragTerminalRef = useRef<{ terminalId: string; fromGroupId: string } | null>(null)
  const dragFromIdx = useRef<number | null>(null)

  const closeContextMenu = (): void => setContextMenu(null)

  const handleGroupContextMenu = (e: React.MouseEvent, group: TerminalGroup): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ type: 'group', id: group.id, groupId: group.id, x: e.clientX, y: e.clientY })
  }

  const handleTerminalContextMenu = (e: React.MouseEvent, terminalId: string, groupId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ type: 'terminal', id: terminalId, groupId, x: e.clientX, y: e.clientY })
  }

  const startRename = (type: 'group' | 'terminal', id: string, currentName: string): void => {
    setRenameState({ type, id, value: currentName })
    closeContextMenu()
  }

  const commitRename = (): void => {
    if (!renameState || !renameState.value.trim()) {
      setRenameState(null)
      return
    }
    if (renameState.type === 'group') {
      renameGroup(renameState.id, renameState.value.trim())
    } else {
      renameTerminal(renameState.id, renameState.value.trim())
    }
    setRenameState(null)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setRenameState(null)
  }

  const handleTerminalDragStart = (e: React.DragEvent, terminalId: string, groupId: string, idx: number): void => {
    dragTerminalRef.current = { terminalId, fromGroupId: groupId }
    dragFromIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify({ terminalId, fromGroupId: groupId }))
  }

  const handleGroupDragOver = (e: React.DragEvent, groupId: string): void => {
    if (!dragTerminalRef.current) return
    if (dragTerminalRef.current.fromGroupId === groupId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverGroupId(groupId)
  }

  const handleGroupDragLeave = (): void => setDragOverGroupId(null)

  const handleGroupDrop = (e: React.DragEvent, toGroupId: string): void => {
    e.preventDefault()
    setDragOverGroupId(null)
    if (!dragTerminalRef.current) return
    const { terminalId, fromGroupId } = dragTerminalRef.current
    if (fromGroupId !== toGroupId) {
      moveTerminalToGroup(terminalId, fromGroupId, toGroupId)
    }
    dragTerminalRef.current = null
    dragFromIdx.current = null
  }

  const handleTerminalDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleTerminalDrop = (e: React.DragEvent, toIdx: number, groupId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!dragTerminalRef.current) return
    if (dragTerminalRef.current.fromGroupId === groupId && dragFromIdx.current !== null && dragFromIdx.current !== toIdx) {
      reorderTerminals(dragFromIdx.current, toIdx)
    }
    dragTerminalRef.current = null
    dragFromIdx.current = null
  }

  const handleTerminalDragEnd = (): void => {
    dragTerminalRef.current = null
    dragFromIdx.current = null
    setDragOverGroupId(null)
  }

  const getGroupTerminals = (group: TerminalGroup) =>
    group.terminalIds.map(id => terminals.find(t => t.id === id)).filter(Boolean) as Array<{ id: string; name: string }>

  return (
    <div className="terminal-tree" onClick={closeContextMenu}>
      <div className="terminal-tree__actions">
        <button
          className="terminal-tree__add-btn"
          onClick={(e) => { e.stopPropagation(); createGroup() }}
          title="New Group"
        >
          + New Group
        </button>
      </div>

      <ul className="terminal-tree__list" role="tree" aria-label="Terminal group list">
        {groups.map((group) => {
          const isActive = group.id === activeGroupId
          const groupTerminals = getGroupTerminals(group)

          return (
            <li key={group.id} role="treeitem" aria-expanded={!group.collapsed} aria-level={1}>
              <div
                className={`terminal-tree__group${isActive ? ' terminal-tree__group--active' : ''}${dragOverGroupId === group.id ? ' terminal-tree__group--dragover' : ''}`}
                onClick={(e) => { e.stopPropagation(); closeContextMenu(); switchGroup(group.id) }}
                onContextMenu={(e) => handleGroupContextMenu(e, group)}
                onDragOver={(e) => handleGroupDragOver(e, group.id)}
                onDragLeave={handleGroupDragLeave}
                onDrop={(e) => handleGroupDrop(e, group.id)}
              >
                <span
                  className={`terminal-tree__chevron${group.collapsed ? '' : ' terminal-tree__chevron--open'}`}
                  onClick={(e) => { e.stopPropagation(); toggleGroupCollapse(group.id) }}
                >
                  &#9654;
                </span>
                {renameState?.type === 'group' && renameState.id === group.id ? (
                  <input
                    className="terminal-tree__rename-input"
                    value={renameState.value}
                    autoFocus
                    onChange={(e) => setRenameState({ ...renameState, value: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={handleRenameKeyDown}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="terminal-tree__group-name">{group.name}</span>
                )}
                <span className="terminal-tree__group-count">{groupTerminals.length}</span>
              </div>

              {!group.collapsed && (
                <ul className="terminal-tree__terminals" role="group">
                  {groupTerminals.map((terminal, idx) => (
                    <li
                      key={terminal.id}
                      role="treeitem"
                      aria-level={2}
                      aria-selected={activeTerminalId === terminal.id && isActive}
                      className={`terminal-tree__item${activeTerminalId === terminal.id && isActive ? ' terminal-tree__item--active' : ''}`}
                      draggable
                      onDragStart={(e) => handleTerminalDragStart(e, terminal.id, group.id, idx)}
                      onDragOver={handleTerminalDragOver}
                      onDrop={(e) => handleTerminalDrop(e, idx, group.id)}
                      onDragEnd={handleTerminalDragEnd}
                      onClick={(e) => { e.stopPropagation(); closeContextMenu(); switchGroup(group.id); setActiveTerminal(terminal.id) }}
                      onContextMenu={(e) => handleTerminalContextMenu(e, terminal.id, group.id)}
                    >
                      <span className="terminal-tree__icon">$</span>
                      {renameState?.type === 'terminal' && renameState.id === terminal.id ? (
                        <input
                          className="terminal-tree__rename-input"
                          value={renameState.value}
                          autoFocus
                          onChange={(e) => setRenameState({ ...renameState, value: e.target.value })}
                          onBlur={commitRename}
                          onKeyDown={handleRenameKeyDown}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="terminal-tree__name">{terminal.name}</span>
                      )}
                    </li>
                  ))}
                  {isActive && (
                    <li className="terminal-tree__add-terminal">
                      <button
                        className="terminal-tree__add-btn terminal-tree__add-btn--small"
                        onClick={(e) => { e.stopPropagation(); createTerminal() }}
                      >
                        + New Terminal
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      {contextMenu && (
        <div
          className="terminal-tree__context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'group' ? (
            <>
              <button
                className="terminal-tree__context-item"
                onClick={() => {
                  const g = groups.find(g => g.id === contextMenu.id)
                  if (g) startRename('group', g.id, g.name)
                }}
              >
                Rename
              </button>
              <button
                className="terminal-tree__context-item terminal-tree__context-item--danger"
                onClick={() => { deleteGroup(contextMenu.id); closeContextMenu() }}
              >
                Delete Group
              </button>
            </>
          ) : (
            <>
              <button
                className="terminal-tree__context-item"
                onClick={() => { createTerminal(); closeContextMenu() }}
              >
                New Terminal
              </button>
              <button
                className="terminal-tree__context-item"
                onClick={() => {
                  const t = terminals.find(t => t.id === contextMenu.id)
                  if (t) startRename('terminal', t.id, t.name)
                }}
              >
                Rename
              </button>
              <button
                className="terminal-tree__context-item terminal-tree__context-item--danger"
                onClick={() => { removeTerminal(contextMenu.id); closeContextMenu() }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
