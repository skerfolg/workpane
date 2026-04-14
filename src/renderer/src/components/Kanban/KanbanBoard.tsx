import React, { useState, useMemo, useCallback } from 'react'
import { useKanban } from '../../contexts/KanbanContext'
import type { KanbanIssue, ColumnDef } from '../../contexts/KanbanContext'
import { KanbanColumn } from './KanbanColumn'
import { KanbanIssueModal } from './KanbanIssueModal'
import './KanbanBoard.css'

type SortKey = 'date' | 'title'

function sortIssues(issues: KanbanIssue[], sortKey: SortKey): KanbanIssue[] {
  return [...issues].sort((a, b) => {
    if (sortKey === 'date') {
      return b.createdAt.localeCompare(a.createdAt)
    }
    return a.title.localeCompare(b.title)
  })
}

interface ModalState {
  issue: KanbanIssue | null
  initialStatus?: string
}

export function KanbanBoard(): React.JSX.Element {
  const { issues, columns, loading, error } = useKanban()
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [modalState, setModalState] = useState<ModalState | null>(null)

  const issuesByStatus = useMemo(() => {
    const map: Record<string, KanbanIssue[]> = {}
    for (const col of columns) {
      map[col.id] = []
    }
    for (const issue of issues) {
      if (map[issue.status] !== undefined) {
        map[issue.status].push(issue)
      } else {
        const firstCol = columns[0]?.id
        if (firstCol && map[firstCol] !== undefined) map[firstCol].push(issue)
      }
    }
    for (const status of Object.keys(map)) {
      map[status] = sortIssues(map[status], sortKey)
    }
    return map
  }, [issues, columns, sortKey])

  const handleOpenModal = useCallback((issue: KanbanIssue | null, status?: string): void => {
    setModalState({ issue, initialStatus: status })
  }, [])

  const handleCloseModal = useCallback((): void => {
    setModalState(null)
  }, [])

  if (loading) {
    return (
      <div className="kanban-board">
        <div className="kanban-board__loading">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="kanban-board">
        <div className="kanban-board__error">{error}</div>
      </div>
    )
  }

  return (
    <div className="kanban-board">
      {/* Toolbar */}
      <div className="kanban-board__toolbar">
        <div className="kanban-board__sort">
          <label className="kanban-board__sort-label">Sort:</label>
          <select
            className="kanban-board__sort-select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="date">Date</option>
            <option value="title">Title</option>
          </select>
        </div>
      </div>

      {/* Columns */}
      <div className="kanban-board__columns">
        {columns.map(({ id, label }: ColumnDef) => (
          <KanbanColumn
            key={id}
            status={id}
            label={label}
            issues={issuesByStatus[id] || []}
            onOpenModal={handleOpenModal}
          />
        ))}
      </div>

      {/* Modal */}
      {modalState !== null && (
        <KanbanIssueModal
          issue={modalState.issue}
          initialStatus={modalState.initialStatus}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}
