import React, { useState, useCallback } from 'react'
import { useIssues } from '../../contexts/IssueContext'
import type { DocGroup, DocEntry } from '../../contexts/IssueContext'
import { useEditor } from '../../contexts/EditorContext'
import './IssueTree.css'

const DOC_TYPE_ICONS: Record<string, string> = {
  design: '\u{1F4D0}',
  plan: '\u{1F4CB}',
  report: '\u{1F4CA}',
  result: '\u2705',
  issue: '\u{1F534}',
  sprint: '\u{1F3C3}',
  resolution: '\u2705',
  doc: '\u{1F4C4}'
}

function getDocIcon(docType: string): string {
  if (DOC_TYPE_ICONS[docType]) return DOC_TYPE_ICONS[docType]
  for (const [key, icon] of Object.entries(DOC_TYPE_ICONS)) {
    if (docType.includes(key)) return icon
  }
  return '\u{1F4C4}'
}

function DocEntryNode({
  entry,
  onOpen
}: {
  entry: DocEntry
  onOpen: (filePath: string) => void
}): React.JSX.Element {
  return (
    <div
      className="issue-tree__node issue-tree__node--sub"
      onClick={() => onOpen(entry.filePath)}
      title={entry.filePath}
    >
      <span className="issue-tree__status">{getDocIcon(entry.docType)}</span>
      <span className="issue-tree__doc-type">{entry.docType}</span>
      <span className="issue-tree__title">{entry.title}</span>
      <span className="issue-tree__date">{entry.date}</span>
    </div>
  )
}

function DocGroupNode({
  group,
  onOpen
}: {
  group: DocGroup
  onOpen: (filePath: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="issue-tree__group">
      <div
        className="issue-tree__node issue-tree__node--parent"
        onClick={() => setExpanded((prev) => !prev)}
        role="treeitem"
        aria-expanded={expanded}
      >
        <span className="issue-tree__chevron">
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className="issue-tree__hash">{group.hash}</span>
        <span className="issue-tree__title">{group.topic}</span>
        <span className="issue-tree__badge">{group.documents.length}</span>
      </div>
      {expanded && (
        <div className="issue-tree__children">
          {group.documents.map((doc) => (
            <DocEntryNode key={doc.filePath} entry={doc} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceSection({
  label,
  groups,
  onOpen
}: {
  label: string
  groups: DocGroup[]
  onOpen: (filePath: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const totalDocs = groups.reduce((sum, g) => sum + g.documents.length, 0)

  return (
    <div className="issue-tree__source-section">
      <div
        className="issue-tree__node issue-tree__node--source"
        onClick={() => setExpanded((prev) => !prev)}
        role="treeitem"
        aria-expanded={expanded}
      >
        <span className="issue-tree__chevron">
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className="issue-tree__source-label">{label}</span>
        <span className="issue-tree__badge">{totalDocs}</span>
      </div>
      {expanded && (
        <div className="issue-tree__source-children">
          {groups.map((group) => (
            <DocGroupNode key={group.hash} group={group} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

export function IssueTree(): React.JSX.Element {
  const { groups, loading, error, sourceFilter } = useIssues()
  const { openFile } = useEditor()

  const handleOpen = useCallback((filePath: string): void => {
    openFile(filePath)
  }, [openFile])

  // Split groups by source
  const standardGroups = groups.filter(g => g.source === 'standard')
  const projectGroups = groups.filter(g => g.source !== 'standard')

  // Apply source filter
  const showStandard = sourceFilter === null || sourceFilter === 'standard'
  const showProject = sourceFilter === null || sourceFilter === 'project'

  return (
    <div className="issue-tree" role="tree" aria-label="Document Groups">
      {loading && <div className="issue-tree__loading">Loading...</div>}
      {error && <div className="issue-tree__error">Error: {error}</div>}
      {!loading && !error && groups.length === 0 && (
        <div className="issue-tree__empty">No documents</div>
      )}
      {showStandard && standardGroups.length > 0 && (
        <SourceSection label="Standard Docs" groups={standardGroups} onOpen={handleOpen} />
      )}
      {showProject && projectGroups.length > 0 && (
        <SourceSection label="Project Docs" groups={projectGroups} onOpen={handleOpen} />
      )}
    </div>
  )
}
