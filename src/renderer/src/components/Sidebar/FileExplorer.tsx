import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Folder, FolderOpen, File, ChevronRight, ChevronDown } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import ignore from 'ignore'
import { useEditor } from '../../contexts/EditorContext'
import './FileExplorer.css'

interface DirEntry {
  name: string
  isDirectory: boolean
  size: number
  path: string
}

interface TreeNode {
  entry: DirEntry
  children: TreeNode[] | null
  loading: boolean
}

interface ContextMenuState {
  x: number
  y: number
  node: TreeNode
}

interface RenameState {
  path: string
  value: string
}

interface FileExplorerProps {
  workspacePath: string
}

interface FlatNode {
  node: TreeNode
  depth: number
  path: string
}

const EXT_ICONS: Record<string, React.ReactNode> = {
  '.ts': <File size={14} className="file-explorer__icon--ts" />,
  '.tsx': <File size={14} className="file-explorer__icon--ts" />,
  '.js': <File size={14} className="file-explorer__icon--js" />,
  '.jsx': <File size={14} className="file-explorer__icon--js" />,
  '.json': <File size={14} className="file-explorer__icon--json" />,
  '.md': <File size={14} className="file-explorer__icon--md" />,
  '.css': <File size={14} className="file-explorer__icon--css" />,
  '.html': <File size={14} className="file-explorer__icon--html" />
}

function getFileIcon(name: string): React.ReactNode {
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx !== -1) {
    const ext = name.slice(dotIdx).toLowerCase()
    if (EXT_ICONS[ext]) return EXT_ICONS[ext]
  }
  return <File size={14} className="file-explorer__icon--default" />
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  const dirs = entries.filter((e) => e.isDirectory).sort((a, b) => a.name.localeCompare(b.name))
  const files = entries.filter((e) => !e.isDirectory).sort((a, b) => a.name.localeCompare(b.name))
  return [...dirs, ...files]
}

function flattenTree(nodes: TreeNode[], depth = 0): FlatNode[] {
  const result: FlatNode[] = []
  for (const node of nodes) {
    result.push({ node, depth, path: node.entry.path })
    if (node.children) {
      // Include loading placeholder as part of the parent node's expanded state
      // Children are rendered as subsequent flat nodes
      result.push(...flattenTree(node.children, depth + 1))
    }
  }
  return result
}

const ROW_HEIGHT = 24

export function FileExplorer({ workspacePath }: FileExplorerProps): React.JSX.Element {
  const { openFile, activeTab } = useEditor()

  const [rootNodes, setRootNodes] = useState<TreeNode[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameState, setRenameState] = useState<RenameState | null>(null)

  const igRef = useRef(ignore())
  const recentRefreshRef = useRef<Set<string>>(new Set())
  const igPatternsRef = useRef<string[]>([])
  const scrollParentRef = useRef<HTMLDivElement>(null)

  const [igPatterns, setIgPatterns] = useState<string[]>([])

  // Hardcoded dotfile names to always hide regardless of gitignore state
  const ALWAYS_HIDDEN = new Set(['.git', '.env', '.workspace', '.omc', '.claude', '.vs', '.vscode', '.idea'])

  const activeFilePath = activeTab?.filePath ?? null

  // Flatten tree for virtual rendering
  const flatNodes = useMemo(() => flattenTree(rootNodes), [rootNodes])

  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })

  // Scroll to active file when it changes
  useEffect(() => {
    if (!activeFilePath) return
    const normalizedActive = activeFilePath.replace(/\\/g, '/')
    const idx = flatNodes.findIndex((fn) => fn.path.replace(/\\/g, '/') === normalizedActive)
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'auto' })
    }
  }, [activeFilePath, flatNodes, virtualizer])

  const basicFilter = useCallback((entries: DirEntry[]): DirEntry[] => {
    return entries.filter((e) => {
      if (e.name.startsWith('.')) return false
      if (ALWAYS_HIDDEN.has(e.name)) return false
      return true
    })
  }, [])

  const filterEntries = useCallback((entries: DirEntry[]): DirEntry[] => {
    const basic = basicFilter(entries)
    if (igPatternsRef.current.length === 0) return basic
    return basic.filter((e) => {
      try {
        const relativePath = e.path.replace(/\\/g, '/').replace(
          workspacePath.replace(/\\/g, '/') + '/', ''
        )
        return !igRef.current.ignores(relativePath)
      } catch {
        return true
      }
    })
  }, [workspacePath, basicFilter])

  const loadDir = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const entries = await window.fs.readDir(dirPath)
    const filtered = filterEntries(entries)
    const sorted = sortEntries(filtered)
    return sorted.map((entry) => ({
      entry,
      children: null,
      loading: false
    }))
  }, [filterEntries])

  // Load root immediately on workspace change (basic dotfile filter only)
  useEffect(() => {
    if (!workspacePath) return
    // Reset gitignore state for new workspace
    igRef.current = ignore()
    igPatternsRef.current = []
    setIgPatterns([])
    setRootNodes([])

    window.fs.readDir(workspacePath).then((entries) => {
      const filtered = basicFilter(entries)
      const sorted = sortEntries(filtered)
      setRootNodes(sorted.map((entry) => ({ entry, children: null, loading: false })))
    }).catch(() => setRootNodes([]))
  }, [workspacePath, basicFilter])

  // Load gitignore patterns async — then re-filter root
  useEffect(() => {
    if (!workspacePath) return
    window.fs.getGitignorePatterns(workspacePath).then((patterns) => {
      igRef.current = ignore().add(patterns)
      igPatternsRef.current = patterns
      setIgPatterns(patterns)
    }).catch(() => {
      igRef.current = ignore()
      igPatternsRef.current = []
      setIgPatterns([])
    })
  }, [workspacePath])

  // Re-filter root nodes when gitignore patterns resolve
  useEffect(() => {
    if (!workspacePath || igPatternsRef.current.length === 0) return
    window.fs.readDir(workspacePath).then((entries) => {
      const filtered = filterEntries(entries)
      const sorted = sortEntries(filtered)
      setRootNodes(sorted.map((entry) => ({ entry, children: null, loading: false })))
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [igPatterns, workspacePath])

  // Refresh a specific directory in the tree
  const refreshDir = useCallback(async (dirPath: string): Promise<void> => {
    const newChildren = await loadDir(dirPath)

    // Mark as recently refreshed for dedup
    recentRefreshRef.current.add(dirPath)
    setTimeout(() => {
      recentRefreshRef.current.delete(dirPath)
    }, 500)

    const normalizedDir = dirPath.replace(/\\/g, '/')
    const normalizedRoot = workspacePath.replace(/\\/g, '/')

    // Merge new nodes with existing ones, preserving expanded children
    const mergeChildren = (incoming: TreeNode[], existing: TreeNode[]): TreeNode[] => {
      return incoming.map((newNode) => {
        const existingNode = existing.find(
          (e) => e.entry.path.replace(/\\/g, '/') === newNode.entry.path.replace(/\\/g, '/')
        )
        if (existingNode?.children !== null) {
          return { ...newNode, children: existingNode!.children }
        }
        return newNode
      })
    }

    if (normalizedDir === normalizedRoot) {
      setRootNodes((prev) => mergeChildren(newChildren, prev))
      return
    }

    // Deep update in tree
    const updateNodes = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map((node) => {
        if (node.entry.path.replace(/\\/g, '/') === normalizedDir) {
          return { ...node, children: mergeChildren(newChildren, node.children ?? []), loading: false }
        }
        if (node.children) {
          return { ...node, children: updateNodes(node.children) }
        }
        return node
      })
    }

    setRootNodes((prev) => updateNodes(prev))
  }, [loadDir, workspacePath])

  // Watcher integration (secondary refresh)
  useEffect(() => {
    const unsubscribe = window.watcher.onChanged((data) => {
      // 'change' means file content changed — directory listing is unaffected, skip refresh
      if (data.type === 'change') return

      const changedPath = data.path.replace(/\\/g, '/')
      // Find parent directory
      const lastSlash = changedPath.lastIndexOf('/')
      const parentDir = lastSlash > 0 ? changedPath.slice(0, lastSlash) : changedPath

      // Skip if recently manually refreshed (500ms dedup)
      if (recentRefreshRef.current.has(parentDir)) return

      // Also check with backslashes for Windows paths
      const parentDirWin = parentDir.replace(/\//g, '\\')
      if (recentRefreshRef.current.has(parentDirWin)) return

      refreshDir(parentDir).catch(() => {})
    })
    return () => unsubscribe()
  }, [refreshDir])

  const handleToggle = useCallback(async (node: TreeNode): Promise<void> => {
    if (!node.entry.isDirectory) return

    if (node.children !== null) {
      // Collapse
      const collapseNode = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map((n) => {
          if (n.entry.path === node.entry.path) {
            return { ...n, children: null, loading: false }
          }
          if (n.children) {
            return { ...n, children: collapseNode(n.children) }
          }
          return n
        })
      }
      setRootNodes((prev) => collapseNode(prev))
      return
    }

    // Expand: set loading, then load children
    const setLoading = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map((n) => {
        if (n.entry.path === node.entry.path) {
          return { ...n, children: [], loading: true }
        }
        if (n.children) {
          return { ...n, children: setLoading(n.children) }
        }
        return n
      })
    }
    setRootNodes((prev) => setLoading(prev))

    try {
      const children = await loadDir(node.entry.path)
      const setChildren = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map((n) => {
          if (n.entry.path === node.entry.path) {
            return { ...n, children, loading: false }
          }
          if (n.children) {
            return { ...n, children: setChildren(n.children) }
          }
          return n
        })
      }
      setRootNodes((prev) => setChildren(prev))
    } catch {
      const clearLoading = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map((n) => {
          if (n.entry.path === node.entry.path) {
            return { ...n, children: null, loading: false }
          }
          if (n.children) {
            return { ...n, children: clearLoading(n.children) }
          }
          return n
        })
      }
      setRootNodes((prev) => clearLoading(prev))
    }
  }, [loadDir])

  const handleFileClick = useCallback((filePath: string): void => {
    openFile(filePath)
  }, [openFile])

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const closeContextMenu = useCallback((): void => {
    setContextMenu(null)
  }, [])

  // CRUD operations
  const handleNewFile = useCallback(async (): Promise<void> => {
    if (!contextMenu) return
    const parentDir = contextMenu.node.entry.isDirectory
      ? contextMenu.node.entry.path
      : contextMenu.node.entry.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    const name = window.prompt('New file name:')
    if (!name?.trim()) { closeContextMenu(); return }
    try {
      await window.fs.writeFile(parentDir.replace(/\\/g, '/') + '/' + name.trim(), '')
      await refreshDir(parentDir)
    } catch (err) {
      console.error('Failed to create file:', err)
    }
    closeContextMenu()
  }, [contextMenu, closeContextMenu, refreshDir])

  const handleNewFolder = useCallback(async (): Promise<void> => {
    if (!contextMenu) return
    const parentDir = contextMenu.node.entry.isDirectory
      ? contextMenu.node.entry.path
      : contextMenu.node.entry.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    const name = window.prompt('New folder name:')
    if (!name?.trim()) { closeContextMenu(); return }
    try {
      await window.fs.mkdir(parentDir.replace(/\\/g, '/') + '/' + name.trim())
      await refreshDir(parentDir)
    } catch (err) {
      console.error('Failed to create folder:', err)
    }
    closeContextMenu()
  }, [contextMenu, closeContextMenu, refreshDir])

  const handleRenameStart = useCallback((): void => {
    if (!contextMenu) return
    setRenameState({ path: contextMenu.node.entry.path, value: contextMenu.node.entry.name })
    closeContextMenu()
  }, [contextMenu, closeContextMenu])

  const handleRenameCommit = useCallback(async (): Promise<void> => {
    if (!renameState || !renameState.value.trim()) {
      setRenameState(null)
      return
    }
    const oldPath = renameState.path
    const parentDir = oldPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    const newPath = parentDir + '/' + renameState.value.trim()
    try {
      await window.fs.rename(oldPath, newPath)
      await refreshDir(parentDir)
    } catch (err) {
      console.error('Failed to rename:', err)
    }
    setRenameState(null)
  }, [renameState, refreshDir])

  const handleRenameCancel = useCallback((): void => {
    setRenameState(null)
  }, [])

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!contextMenu) return
    const targetPath = contextMenu.node.entry.path
    const confirmed = window.confirm(`Delete "${contextMenu.node.entry.name}"?`)
    if (!confirmed) { closeContextMenu(); return }
    const parentDir = targetPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    try {
      await window.fs.delete(targetPath)
      await refreshDir(parentDir)
    } catch (err) {
      console.error('Failed to delete:', err)
    }
    closeContextMenu()
  }, [contextMenu, closeContextMenu, refreshDir])

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      className="file-explorer"
      role="tree"
      aria-label="File Explorer"
      onClick={closeContextMenu}
      ref={scrollParentRef}
    >
      {rootNodes.length === 0 && (
        <div className="file-explorer__empty">No files</div>
      )}
      {rootNodes.length > 0 && (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {virtualItems.map((virtualRow) => {
            const { node, depth } = flatNodes[virtualRow.index]
            const isExpanded = node.children !== null
            const isRenaming = renameState?.path === node.entry.path
            const isActive = activeFilePath
              ? node.entry.path.replace(/\\/g, '/') === activeFilePath.replace(/\\/g, '/')
              : false

            const handleClick = (): void => {
              if (node.entry.isDirectory) {
                handleToggle(node)
              } else {
                handleFileClick(node.entry.path)
              }
            }

            const handleRenameKeyDown = (e: React.KeyboardEvent): void => {
              if (e.key === 'Enter') handleRenameCommit()
              if (e.key === 'Escape') handleRenameCancel()
            }

            // Show loading indicator for expanded directories that are loading
            if (node.loading && node.children?.length === 0) {
              return (
                <div
                  key={`loading-${node.entry.path}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <div
                    className="file-explorer__node"
                    style={{ paddingLeft: `${depth * 16 + 4}px` }}
                    onClick={handleClick}
                    onContextMenu={(e) => handleContextMenu(e, node)}
                    role="treeitem"
                    aria-expanded={isExpanded}
                  >
                    <span className="file-explorer__chevron">
                      <ChevronDown size={14} />
                    </span>
                    <span className="file-explorer__icon">
                      <FolderOpen size={14} />
                    </span>
                    <span className="file-explorer__name">{node.entry.name}</span>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={node.entry.path}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                <div
                  className={`file-explorer__node${isActive ? ' file-explorer__node--active' : ''}`}
                  style={{ paddingLeft: `${depth * 16 + 4}px` }}
                  onClick={handleClick}
                  onContextMenu={(e) => handleContextMenu(e, node)}
                  role="treeitem"
                  aria-expanded={node.entry.isDirectory ? isExpanded : undefined}
                >
                  {node.entry.isDirectory ? (
                    <>
                      <span className="file-explorer__chevron">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <span className="file-explorer__icon">
                        {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="file-explorer__chevron file-explorer__chevron--spacer" />
                      <span className="file-explorer__icon">
                        {getFileIcon(node.entry.name)}
                      </span>
                    </>
                  )}
                  {isRenaming ? (
                    <input
                      className="file-explorer__rename-input"
                      value={renameState!.value}
                      autoFocus
                      onChange={(e) => setRenameState((prev) => prev ? { ...prev, value: e.target.value } : null)}
                      onBlur={handleRenameCommit}
                      onKeyDown={handleRenameKeyDown}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="file-explorer__name">{node.entry.name}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {contextMenu && (
        <div
          className="file-explorer__context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="file-explorer__context-item" onClick={handleNewFile}>
            New File
          </button>
          <button className="file-explorer__context-item" onClick={handleNewFolder}>
            New Folder
          </button>
          <button className="file-explorer__context-item" onClick={handleRenameStart}>
            Rename
          </button>
          <button
            className="file-explorer__context-item file-explorer__context-item--danger"
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
