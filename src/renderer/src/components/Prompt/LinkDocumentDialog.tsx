import React, { useState, useMemo } from 'react'
import { useKanban } from '../../contexts/KanbanContext'
import type { DocEntry } from '../../contexts/IssueContext'
import './LinkDocumentDialog.css'

interface LinkDocumentDialogProps {
  docEntry: DocEntry
  onConfirm: (issueId: string) => void
  onCancel: () => void
}

export function LinkDocumentDialog({
  docEntry,
  onConfirm,
  onCancel
}: LinkDocumentDialogProps): React.JSX.Element {
  const { issues } = useKanban()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string>('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return issues
    return issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(q) ||
        issue.id.toLowerCase().includes(q)
    )
  }, [issues, search])

  return (
    <div className="link-doc-dialog__overlay" onClick={onCancel}>
      <div
        className="link-doc-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="이슈에 문서 링크"
      >
        <div className="link-doc-dialog__header">
          <span className="link-doc-dialog__title">이슈에 링크</span>
          <button className="link-doc-dialog__close" onClick={onCancel} aria-label="닫기">
            &times;
          </button>
        </div>
        <div className="link-doc-dialog__doc-info">
          <span className="link-doc-dialog__doc-label">문서:</span>
          <span className="link-doc-dialog__doc-title" title={docEntry.filePath}>
            {docEntry.title}
          </span>
        </div>
        <div className="link-doc-dialog__search-row">
          <input
            className="link-doc-dialog__search"
            type="text"
            placeholder="이슈 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="link-doc-dialog__list">
          {filtered.length === 0 ? (
            <div className="link-doc-dialog__empty">이슈가 없습니다</div>
          ) : (
            filtered.map((issue) => (
              <div
                key={issue.id}
                className={`link-doc-dialog__item${selectedId === issue.id ? ' link-doc-dialog__item--selected' : ''}`}
                onClick={() => setSelectedId(issue.id)}
              >
                <span className="link-doc-dialog__item-status">{issue.status}</span>
                <span className="link-doc-dialog__item-title">{issue.title}</span>
              </div>
            ))
          )}
        </div>
        <div className="link-doc-dialog__footer">
          <button className="link-doc-dialog__btn link-doc-dialog__btn--cancel" onClick={onCancel}>
            취소
          </button>
          <button
            className="link-doc-dialog__btn link-doc-dialog__btn--confirm"
            onClick={() => selectedId && onConfirm(selectedId)}
            disabled={!selectedId}
          >
            링크
          </button>
        </div>
      </div>
    </div>
  )
}
