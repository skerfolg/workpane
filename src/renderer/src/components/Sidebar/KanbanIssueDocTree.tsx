import React, { useState } from 'react'
import { FileText, ChevronRight, ChevronDown } from 'lucide-react'
import { useKanban } from '../../contexts/KanbanContext'
import { useEditor } from '../../contexts/EditorContext'
import './KanbanIssueDocTree.css'

function basename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const normalized = status.toLowerCase().replace(/\s+/g, '-')
  return (
    <span className={`kanban-doc-tree__status-badge kanban-doc-tree__status-badge--${normalized}`}>
      {status}
    </span>
  )
}

interface IssueGroupProps {
  id: string
  title: string
  status: string
  linkedDocuments: string[]
  onOpenFile: (filePath: string) => void
}

function IssueGroup({ id, title, status, linkedDocuments, onOpenFile }: IssueGroupProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const shortId = id.slice(0, 7)

  return (
    <div className="kanban-doc-tree__group">
      <div
        className="kanban-doc-tree__node kanban-doc-tree__node--parent"
        role="treeitem"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="kanban-doc-tree__chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="kanban-doc-tree__hash">{shortId}</span>
        <span className="kanban-doc-tree__title">{title}</span>
        <StatusBadge status={status} />
      </div>

      {expanded && (
        <div className="kanban-doc-tree__children" role="group">
          {linkedDocuments.map((filePath) => (
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
    </div>
  )
}

export function KanbanIssueDocTree(): React.JSX.Element {
  const { issues } = useKanban()
  const { openFile } = useEditor()

  const issuesWithDocs = issues.filter((issue) => issue.linkedDocuments.length > 0)

  if (issuesWithDocs.length === 0) {
    return (
      <div className="kanban-doc-tree">
        <p className="kanban-doc-tree__empty">No issues with linked documents</p>
      </div>
    )
  }

  return (
    <div className="kanban-doc-tree" role="tree" aria-label="Documents linked by issue">
      {issuesWithDocs.map((issue) => (
        <IssueGroup
          key={issue.id}
          id={issue.id}
          title={issue.title}
          status={issue.status}
          linkedDocuments={issue.linkedDocuments}
          onOpenFile={openFile}
        />
      ))}
    </div>
  )
}
