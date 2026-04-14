import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useIssues } from '../../contexts/IssueContext'
import type { DocGroup, DocEntry } from '../../contexts/IssueContext'
import { useEditor } from '../../contexts/EditorContext'
import { useKanban } from '../../contexts/KanbanContext'
import { LinkDocumentDialog } from '../Prompt/LinkDocumentDialog'
import './DocumentTree.css'

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

interface ContextMenuState {
  x: number
  y: number
  entry: DocEntry
  isLinked: boolean
  linkedIssueId: string | null
}

function ContextMenu({
  state,
  onOpen,
  onLinkToIssue,
  onUnlink,
  onClose
}: {
  state: ContextMenuState
  onOpen: (filePath: string) => void
  onLinkToIssue: (entry: DocEntry) => void
  onUnlink: (filePath: string, issueId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="doc-tree__context-menu"
      style={{ top: state.y, left: state.x }}
    >
      <div
        className="doc-tree__context-menu-item"
        onClick={() => {
          onOpen(state.entry.filePath)
          onClose()
        }}
      >
        Open File
      </div>
      {state.isLinked && state.linkedIssueId ? (
        <div
          className="doc-tree__context-menu-item doc-tree__context-menu-item--danger"
          onClick={() => {
            onUnlink(state.entry.filePath, state.linkedIssueId!)
            onClose()
          }}
        >
          Unlink
        </div>
      ) : (
        <div
          className="doc-tree__context-menu-item"
          onClick={() => {
            onLinkToIssue(state.entry)
            onClose()
          }}
        >
          Link to Issue
        </div>
      )}
    </div>
  )
}

function DocEntryNode({
  entry,
  isLinked,
  onOpen,
  onContextMenu
}: {
  entry: DocEntry
  isLinked: boolean
  onOpen: (filePath: string) => void
  onContextMenu: (e: React.MouseEvent, entry: DocEntry) => void
}): React.JSX.Element {
  return (
    <div
      className="doc-tree__node doc-tree__node--sub"
      onClick={() => onOpen(entry.filePath)}
      onContextMenu={(e) => onContextMenu(e, entry)}
      title={entry.filePath}
    >
      <span className="doc-tree__status">{getDocIcon(entry.docType)}</span>
      {isLinked && <span className="doc-tree__link-badge" title="Linked to issue">{'\uD83D\uDD17'}</span>}
      <span className="doc-tree__doc-type">{entry.docType}</span>
      <span className="doc-tree__title">{entry.title}</span>
      <span className="doc-tree__date">{entry.date}</span>
    </div>
  )
}

function DocGroupNode({
  group,
  linkedDocPaths,
  onOpen,
  onContextMenu
}: {
  group: DocGroup
  linkedDocPaths: Set<string>
  onOpen: (filePath: string) => void
  onContextMenu: (e: React.MouseEvent, entry: DocEntry) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="doc-tree__group">
      <div
        className="doc-tree__node doc-tree__node--parent"
        onClick={() => setExpanded((prev) => !prev)}
        role="treeitem"
        aria-expanded={expanded}
      >
        <span className="doc-tree__chevron">
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className="doc-tree__hash">{group.hash}</span>
        <span className="doc-tree__title">{group.topic}</span>
        <span className="doc-tree__badge">{group.documents.length}</span>
      </div>
      {expanded && (
        <div className="doc-tree__children">
          {group.documents.map((doc) => (
            <DocEntryNode
              key={doc.filePath}
              entry={doc}
              isLinked={linkedDocPaths.has(doc.filePath)}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceSection({
  label,
  groups,
  linkedDocPaths,
  onOpen,
  onContextMenu
}: {
  label: string
  groups: DocGroup[]
  linkedDocPaths: Set<string>
  onOpen: (filePath: string) => void
  onContextMenu: (e: React.MouseEvent, entry: DocEntry) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const totalDocs = groups.reduce((sum, g) => sum + g.documents.length, 0)

  return (
    <div className="doc-tree__source-section">
      <div
        className="doc-tree__node doc-tree__node--source"
        onClick={() => setExpanded((prev) => !prev)}
        role="treeitem"
        aria-expanded={expanded}
      >
        <span className="doc-tree__chevron">
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className="doc-tree__source-label">{label}</span>
        <span className="doc-tree__badge">{totalDocs}</span>
      </div>
      {expanded && (
        <div className="doc-tree__source-children">
          {groups.map((group) => (
            <DocGroupNode
              key={group.hash}
              group={group}
              linkedDocPaths={linkedDocPaths}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function DocumentTree(): React.JSX.Element {
  const { groups, loading, error, sourceFilter } = useIssues()
  const { openFile } = useEditor()
  const { issues: kanbanIssues, linkDocument, unlinkDocument } = useKanban()

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [linkDialogEntry, setLinkDialogEntry] = useState<DocEntry | null>(null)

  // Build set of linked document paths for quick lookup
  const linkedDocPaths = new Set(
    kanbanIssues.flatMap((issue) => issue.linkedDocuments)
  )

  // Map filePath -> issueId for unlink
  const docPathToIssueId = new Map<string, string>()
  for (const issue of kanbanIssues) {
    for (const docPath of issue.linkedDocuments) {
      docPathToIssueId.set(docPath, issue.id)
    }
  }

  const handleOpen = useCallback((filePath: string): void => {
    openFile(filePath)
  }, [openFile])

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: DocEntry): void => {
    e.preventDefault()
    e.stopPropagation()
    const isLinked = linkedDocPaths.has(entry.filePath)
    const linkedIssueId = docPathToIssueId.get(entry.filePath) ?? null
    setContextMenu({ x: e.clientX, y: e.clientY, entry, isLinked, linkedIssueId })
  }, [linkedDocPaths, docPathToIssueId])

  const handleLinkToIssue = useCallback((entry: DocEntry): void => {
    setLinkDialogEntry(entry)
  }, [])

  const handleUnlink = useCallback(async (filePath: string, issueId: string): Promise<void> => {
    await unlinkDocument(issueId, filePath)
  }, [unlinkDocument])

  const handleLinkDialogConfirm = useCallback(async (issueId: string): Promise<void> => {
    if (linkDialogEntry) {
      await linkDocument(issueId, linkDialogEntry.filePath)
    }
    setLinkDialogEntry(null)
  }, [linkDialogEntry, linkDocument])

  // Split groups by source
  const standardGroups = groups.filter(g => g.source === 'standard')
  const projectGroups = groups.filter(g => g.source !== 'standard')

  // Apply source filter
  const showStandard = sourceFilter === null || sourceFilter === 'standard'
  const showProject = sourceFilter === null || sourceFilter === 'project'

  return (
    <div className="doc-tree" role="tree" aria-label="Document Explorer">
      {loading && <div className="doc-tree__loading">Loading...</div>}
      {error && <div className="doc-tree__error">Error: {error}</div>}
      {!loading && !error && groups.length === 0 && (
        <div className="doc-tree__empty">No documents</div>
      )}
      {showStandard && standardGroups.length > 0 && (
        <SourceSection
          label="Standard Docs"
          groups={standardGroups}
          linkedDocPaths={linkedDocPaths}
          onOpen={handleOpen}
          onContextMenu={handleContextMenu}
        />
      )}
      {showProject && projectGroups.length > 0 && (
        <SourceSection
          label="Project Docs"
          groups={projectGroups}
          linkedDocPaths={linkedDocPaths}
          onOpen={handleOpen}
          onContextMenu={handleContextMenu}
        />
      )}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onOpen={handleOpen}
          onLinkToIssue={handleLinkToIssue}
          onUnlink={handleUnlink}
          onClose={() => setContextMenu(null)}
        />
      )}
      {linkDialogEntry && (
        <LinkDocumentDialog
          docEntry={linkDialogEntry}
          onConfirm={handleLinkDialogConfirm}
          onCancel={() => setLinkDialogEntry(null)}
        />
      )}
    </div>
  )
}
