import React, { useState, useMemo, useCallback } from 'react'
import { FileText, ChevronRight, ChevronDown, Search } from 'lucide-react'
import { useKanban } from '../../contexts/KanbanContext'
import { useEditor } from '../../contexts/EditorContext'
import './KanbanIssueDocTree.css'

function basename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath
}

interface KanbanIssue {
  id: string
  title: string
  status: string
  linkedDocuments: string[]
}

// Status groups in display order — resolved collapsed by default
const STATUS_GROUPS: Array<{ id: string; label: string; defaultExpanded: boolean }> = [
  { id: 'open', label: 'Open', defaultExpanded: true },
  { id: 'in-progress', label: 'In Progress', defaultExpanded: true },
  { id: 'resolved', label: 'Resolved', defaultExpanded: false }
]

function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/\s+/g, '-')
}

// ---- Issue item (single issue row with optional doc children) ----

interface IssueItemProps {
  issue: KanbanIssue
  onOpenFile: (filePath: string) => void
}

function IssueItem({ issue, onOpenFile }: IssueItemProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const shortId = issue.id.slice(0, 7)
  const hasDocs = issue.linkedDocuments.length > 0

  return (
    <>
      <div
        className={`kanban-doc-tree__node kanban-doc-tree__node--issue${hasDocs ? '' : ' kanban-doc-tree__node--no-docs'}`}
        role="treeitem"
        aria-expanded={hasDocs ? expanded : undefined}
        onClick={hasDocs ? () => setExpanded((prev) => !prev) : undefined}
      >
        {hasDocs ? (
          <span className="kanban-doc-tree__chevron">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span className="kanban-doc-tree__chevron kanban-doc-tree__chevron--empty" />
        )}
        <span className="kanban-doc-tree__hash">{shortId}</span>
        <span className="kanban-doc-tree__title">{issue.title}</span>
        {hasDocs && (
          <span className="kanban-doc-tree__doc-count">{issue.linkedDocuments.length}</span>
        )}
      </div>

      {hasDocs && expanded && (
        <div className="kanban-doc-tree__children" role="group">
          {issue.linkedDocuments.map((filePath) => (
            <div
              key={filePath}
              className="kanban-doc-tree__node kanban-doc-tree__node--sub"
              role="treeitem"
              title={filePath}
              onClick={() => onOpenFile(filePath)}
            >
              <FileText size={12} className="kanban-doc-tree__file-icon" />
              <span className="kanban-doc-tree__filename">{basename(filePath)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ---- Status group (collapsible section header) ----

interface StatusGroupProps {
  label: string
  count: number
  defaultExpanded: boolean
  issues: KanbanIssue[]
  onOpenFile: (filePath: string) => void
}

function StatusGroup({ label, count, defaultExpanded, issues, onOpenFile }: StatusGroupProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="kanban-doc-tree__status-group">
      <div
        className="kanban-doc-tree__node kanban-doc-tree__node--status-header"
        role="treeitem"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="kanban-doc-tree__chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="kanban-doc-tree__status-label">{label}</span>
        <span className="kanban-doc-tree__status-count">{count}</span>
      </div>

      {expanded && (
        <div className="kanban-doc-tree__status-children" role="group">
          {issues.map((issue) => (
            <IssueItem key={issue.id} issue={issue} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Main tree ----

export function KanbanIssueDocTree(): React.JSX.Element {
  const { issues } = useKanban()
  const { openFile } = useEditor()
  const [filter, setFilter] = useState('')

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value)
  }, [])

  const filteredIssues = useMemo(() => {
    if (!filter.trim()) return issues
    const q = filter.toLowerCase()
    return issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(q) ||
        issue.id.toLowerCase().includes(q)
    )
  }, [issues, filter])

  const groupedIssues = useMemo(() => {
    const groups = new Map<string, KanbanIssue[]>()
    for (const group of STATUS_GROUPS) {
      groups.set(group.id, [])
    }
    for (const issue of filteredIssues) {
      const key = normalizeStatus(issue.status)
      const list = groups.get(key)
      if (list) {
        list.push(issue)
      } else {
        // Unknown status — append to a catch-all
        const existing = groups.get('open') ?? []
        existing.push(issue)
      }
    }
    return groups
  }, [filteredIssues])

  if (issues.length === 0) {
    return (
      <div className="kanban-doc-tree">
        <p className="kanban-doc-tree__empty">No issues</p>
      </div>
    )
  }

  return (
    <div className="kanban-doc-tree" role="tree" aria-label="Kanban issues">
      <div className="kanban-doc-tree__filter">
        <Search size={12} className="kanban-doc-tree__filter-icon" />
        <input
          className="kanban-doc-tree__filter-input"
          type="text"
          placeholder="Filter issues..."
          value={filter}
          onChange={handleFilterChange}
        />
      </div>

      {filteredIssues.length === 0 ? (
        <p className="kanban-doc-tree__empty">No matching issues</p>
      ) : (
        STATUS_GROUPS.map((group) => {
          const groupIssues = groupedIssues.get(group.id) ?? []
          if (groupIssues.length === 0) return null
          return (
            <StatusGroup
              key={group.id}
              label={group.label}
              count={groupIssues.length}
              defaultExpanded={group.defaultExpanded}
              issues={groupIssues}
              onOpenFile={openFile}
            />
          )
        })
      )}
    </div>
  )
}
