import React, { useState, useCallback, useRef } from 'react'
import type { KanbanIssue } from '../../contexts/KanbanContext'
import { useKanban } from '../../contexts/KanbanContext'
import { PromptGenerator } from '../Prompt/PromptGenerator'
import './IssueModal.css'

interface KanbanIssueModalProps {
  issue?: KanbanIssue | null
  initialStatus?: string
  onClose: () => void
}

export function KanbanIssueModal({ issue, initialStatus, onClose }: KanbanIssueModalProps): React.JSX.Element {
  const { createIssue, updateIssue, deleteIssue, columns } = useKanban()

  const isCreateMode = !issue

  const [title, setTitle] = useState(issue?.title ?? '')
  const [description, setDescription] = useState(issue?.description ?? '')
  const [status, setStatus] = useState<string>(issue?.status ?? initialStatus ?? 'todo')
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const overlayRef = useRef<HTMLDivElement>(null)

  const statusOptions = columns.length > 0
    ? columns.map((c) => c.id)
    : ['todo', 'in-progress', 'in-review', 'done']

  const handleOverlayClick = useCallback((e: React.MouseEvent): void => {
    if (e.target === overlayRef.current) onClose()
  }, [onClose])

  const handleSave = useCallback(async (): Promise<void> => {
    if (!title.trim()) return
    setSaving(true)
    try {
      if (isCreateMode) {
        await createIssue({ title: title.trim(), description: description.trim(), status })
      } else if (issue) {
        await updateIssue(issue.id, { title: title.trim(), description: description.trim(), status })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }, [isCreateMode, issue, title, description, status, createIssue, updateIssue, onClose])

  const handleDeleteConfirm = useCallback(async (): Promise<void> => {
    if (!issue) return
    await deleteIssue(issue.id)
    onClose()
  }, [issue, deleteIssue, onClose])

  return (
    <div className="issue-modal__overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div
        className="issue-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-modal-title"
      >
        <div className="issue-modal__header">
          <div className="issue-modal__header-left">
            {issue && <span className="issue-modal__hash">#{issue.id.slice(0, 6)}</span>}
            <span id="issue-modal-title" className="issue-modal__mode-label">
              {isCreateMode ? 'New Issue' : 'Edit Issue'}
            </span>
          </div>
          <div className="issue-modal__header-controls">
            <select
              className="issue-modal__select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button className="issue-modal__close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="issue-modal__title-row">
          <input
            className="issue-modal__title-input"
            placeholder="Issue title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="issue-modal__body">
          <textarea
            className="issue-modal__content"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter issue description..."
          />
        </div>

        {!isCreateMode && issue && (
          <PromptGenerator issueId={issue.id} />
        )}

        {!isCreateMode && issue && issue.linkedDocuments.length > 0 && (
          <div className="issue-modal__sub-issues">
            <div className="issue-modal__sub-title">Linked Documents ({issue.linkedDocuments.length})</div>
            {issue.linkedDocuments.map((docPath) => (
              <div key={docPath} className="issue-modal__sub-item">
                <span>{docPath.split('/').pop() ?? docPath}</span>
              </div>
            ))}
          </div>
        )}

        <div className="issue-modal__footer">
          <div className="issue-modal__footer-left">
            {!isCreateMode && (
              <button
                className="issue-modal__btn issue-modal__btn--danger"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete
              </button>
            )}
          </div>
          <div className="issue-modal__footer-right">
            <button className="issue-modal__btn issue-modal__btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="issue-modal__btn issue-modal__btn--primary"
              onClick={handleSave}
              disabled={saving || !title.trim()}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Delete confirmation overlay */}
        {showDeleteConfirm && issue && (
          <div className="issue-modal__delete-overlay">
            <div className="issue-modal__delete-dialog">
              <div className="issue-modal__delete-title">Delete this issue?</div>
              <div className="issue-modal__delete-issue-name">{issue.title}</div>
              <div className="issue-modal__delete-actions">
                <button
                  className="issue-modal__btn issue-modal__btn--secondary"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  className="issue-modal__btn issue-modal__btn--delete-confirm"
                  onClick={handleDeleteConfirm}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
