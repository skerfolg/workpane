import React, { useCallback } from 'react'
import type { KanbanIssue } from '../../contexts/KanbanContext'
import './KanbanCard.css'

interface KanbanCardProps {
  issue: KanbanIssue
  onOpenModal: (issue: KanbanIssue) => void
}

export function KanbanCard({ issue, onOpenModal }: KanbanCardProps): React.JSX.Element {
  const handleDragStart = useCallback((e: React.DragEvent): void => {
    e.dataTransfer.setData('text/plain', issue.id)
    e.dataTransfer.effectAllowed = 'move'
  }, [issue.id])

  const handleClick = useCallback((): void => {
    onOpenModal(issue)
  }, [issue, onOpenModal])

  const linkedCount = issue.linkedDocuments?.length ?? 0

  return (
    <div
      className="kanban-card"
      draggable
      aria-roledescription="kanban card"
      aria-label={issue.title}
      onDragStart={handleDragStart}
      onClick={handleClick}
    >
      <div className="kanban-card__title">{issue.title}</div>
      {issue.description && (
        <div className="kanban-card__description">{issue.description}</div>
      )}
      <div className="kanban-card__meta">
        <span className="kanban-card__hash">#{issue.id.slice(0, 6)}</span>
        {linkedCount > 0 && (
          <span className="kanban-card__linked">{linkedCount} 문서</span>
        )}
      </div>
    </div>
  )
}
