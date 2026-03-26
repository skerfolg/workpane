import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Issue, useIssues } from '../../contexts/IssueContext'
import type { CreateIssueData } from '../../contexts/IssueContext'
import './IssueModal.css'

interface IssueModalProps {
  issue?: Issue | null
  initialStatus?: string
  onClose: () => void
}

const STATUS_OPTIONS: string[] = ['open', 'in-progress', 'resolved']
const PRIORITY_OPTIONS = ['high', 'medium', 'low']
const CATEGORY_OPTIONS = ['bug', 'feature', 'improvement', 'tech-debt', 'question']
const TYPE_OPTIONS = ['feat', 'bug', 'task', 'doc', 'chore']

export function IssueModal({ issue, initialStatus, onClose }: IssueModalProps): React.JSX.Element {
  const { createIssue, updateIssue, deleteIssue } = useIssues()

  const isCreateMode = !issue

  const [title, setTitle] = useState(issue?.title ?? '')
  const [status, setStatus] = useState<string>(issue?.status ?? initialStatus ?? 'open')
  const [priority, setPriority] = useState(issue?.priority ?? 'medium')
  const [category, setCategory] = useState(issue?.category ?? 'feature')
  const [type, setType] = useState(issue?.type ?? 'feat')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const overlayRef = useRef<HTMLDivElement>(null)

  // Load file content for edit mode
  useEffect(() => {
    if (!issue) return
    const fsApi = (window as any).fs
    if (!fsApi) return
    fsApi.readFile(issue.filePath).then((raw: string) => {
      if (raw.startsWith('---')) {
        const end = raw.indexOf('\n---', 3)
        if (end !== -1) {
          setContent(raw.slice(end + 4).trimStart())
          return
        }
      }
      setContent(raw)
    }).catch(() => {})
  }, [issue])

  const handleOverlayClick = useCallback((e: React.MouseEvent): void => {
    if (e.target === overlayRef.current) onClose()
  }, [onClose])

  const handleSave = useCallback(async (): Promise<void> => {
    if (!title.trim()) return
    setSaving(true)
    try {
      if (isCreateMode) {
        const data: CreateIssueData = { title: title.trim(), status, priority, category, type }
        await createIssue(data)
      } else if (issue) {
        await updateIssue(issue.filePath, { title: title.trim(), status, priority, category, content: `\n# ${title.trim()}\n\n${content}` })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }, [isCreateMode, issue, title, status, priority, category, type, content, createIssue, updateIssue, onClose])

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!issue) return
    if (!confirm(`Delete this issue?\n${issue.title}`)) return
    await deleteIssue(issue.filePath)
    onClose()
  }, [issue, deleteIssue, onClose])

  const handleOpenInEditor = useCallback((): void => {
    if (!issue) return
    const editorCtx = (window as any).__editorContext
    if (editorCtx?.openFile) {
      editorCtx.openFile(issue.filePath)
    }
    onClose()
  }, [issue, onClose])

  const subIssues = issue?.children ?? []

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
            {issue && <span className="issue-modal__hash">#{issue.hash}</span>}
            <span id="issue-modal-title" className="issue-modal__mode-label">{isCreateMode ? 'New Issue' : 'Edit Issue'}</span>
          </div>
          <div className="issue-modal__header-controls">
            <select
              className="issue-modal__select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              className="issue-modal__select"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              className="issue-modal__select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {isCreateMode && (
              <select
                className="issue-modal__select"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
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

        {!isCreateMode && (
          <div className="issue-modal__body">
            <textarea
              className="issue-modal__content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter markdown content..."
            />
          </div>
        )}

        {!isCreateMode && (
          <div className="issue-modal__sub-issues">
            <div className="issue-modal__sub-title">Sub Issues ({subIssues.length})</div>
            {subIssues.map((sub) => (
              <label key={sub.filePath} className="issue-modal__sub-item">
                <input
                  type="checkbox"
                  checked={sub.status === 'resolved'}
                  onChange={async (e) => {
                    const newStatus = e.target.checked ? 'resolved' : 'open'
                    const issuesApi = (window as any).issues
                    if (issuesApi) await issuesApi.updateStatus(sub.filePath, newStatus)
                  }}
                />
                <span>{sub.title}</span>
              </label>
            ))}
          </div>
        )}

        <div className="issue-modal__footer">
          <div className="issue-modal__footer-left">
            {!isCreateMode && (
              <>
                <button className="issue-modal__btn issue-modal__btn--secondary" onClick={handleOpenInEditor}>
                  Open as Markdown
                </button>
                <button className="issue-modal__btn issue-modal__btn--danger" onClick={handleDelete}>
                  Delete
                </button>
              </>
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
      </div>
    </div>
  )
}
