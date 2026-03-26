import React, { useState, useCallback } from 'react'
import type { KanbanIssue } from '../../contexts/KanbanContext'
import { useKanban } from '../../contexts/KanbanContext'
import { KanbanCard } from './KanbanCard'
import './KanbanColumn.css'

interface KanbanColumnProps {
  status: string
  label: string
  issues: KanbanIssue[]
  onOpenModal: (issue: KanbanIssue | null, status?: string) => void
}

export function KanbanColumn({ status, label, issues, onOpenModal }: KanbanColumnProps): React.JSX.Element {
  const { updateIssueStatus } = useKanban()
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((): void => {
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const issueId = e.dataTransfer.getData('text/plain')
    if (!issueId) return
    await updateIssueStatus(issueId, status)
  }, [status, updateIssueStatus])

  return (
    <div
      className={`kanban-column kanban-column--${status}${dragOver ? ' kanban-column--drag-over' : ''}`}
      aria-label={`${label} column`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="kanban-column__header">
        <span className="kanban-column__label">{label}</span>
        <span className="kanban-column__count">{issues.length}</span>
      </div>
      <div className="kanban-column__cards">
        {issues.map((issue) => (
          <KanbanCard key={issue.id} issue={issue} onOpenModal={onOpenModal} />
        ))}
      </div>
      <button
        className="kanban-column__add-btn"
        onClick={() => onOpenModal(null, status)}
      >
        + 새 이슈
      </button>
    </div>
  )
}
