import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { DocEntry, DocGroup, Issue, IssueStatus } from '../../../shared/types'

// Re-export for consumers
export type { DocEntry, DocGroup, Issue, IssueStatus }

interface IssueContextValue {
  groups: DocGroup[]
  loading: boolean
  error: string | null
  projectRoot: string | null
  sourceFilter: 'standard' | 'project' | null
  setSourceFilter: (filter: 'standard' | 'project' | null) => void
  loadDocs: (projectRoot: string) => Promise<void>
  // Legacy compat
  issues: Issue[]
}

export const IssueContext = createContext<IssueContextValue | null>(null)

export function useIssues(): IssueContextValue {
  const ctx = useContext(IssueContext)
  if (!ctx) throw new Error('useIssues must be used within IssueProvider')
  return ctx
}

export function IssueProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [groups, setGroups] = useState<DocGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<'standard' | 'project' | null>(null)
  const currentProjectRoot = useRef<string | null>(null)
  const watcherDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadInFlightRef = useRef(false)

  const loadDocs = useCallback(async (projectRoot: string, force = false): Promise<void> => {
    if (!force && loadInFlightRef.current) return
    currentProjectRoot.current = projectRoot
    loadInFlightRef.current = true
    setLoading(true)
    setError(null)
    try {
      const issuesApi = (window as any).issues
      if (!issuesApi) throw new Error('issues API not available')
      // Use scanAll for project-wide scanning
      const ipcStart = performance.now()
      const result = issuesApi.scanAll
        ? await issuesApi.scanAll(projectRoot)
        : await issuesApi.scan(projectRoot + '/docs')
      console.log(`[PERF][Renderer] IPC loadDocs RTT: ${(performance.now() - ipcStart).toFixed(1)}ms`)
      if (Array.isArray(result)) {
        setGroups(result)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      loadInFlightRef.current = false
    }
  }, [])

  // Phase 2: Listen for background title enrichment updates
  useEffect(() => {
    const issuesApi = (window as any).issues
    if (!issuesApi?.onTitlesUpdated) return

    const cleanup = issuesApi.onTitlesUpdated((updates: Array<{ filePath: string; title: string }>) => {
      setGroups((prev) => {
        // Build a lookup map for fast title resolution
        const titleMap = new Map<string, string>()
        for (const u of updates) {
          titleMap.set(u.filePath.replace(/\\/g, '/'), u.title)
        }

        // Update titles in-place (shallow copy only affected groups)
        let changed = false
        const next = prev.map((group) => {
          let groupChanged = false
          const docs = group.documents.map((doc) => {
            const normalized = doc.filePath.replace(/\\/g, '/')
            const newTitle = titleMap.get(normalized)
            if (newTitle && newTitle !== doc.title) {
              groupChanged = true
              return { ...doc, title: newTitle, topic: newTitle }
            }
            return doc
          })
          if (groupChanged) {
            changed = true
            return { ...group, documents: docs }
          }
          return group
        })

        return changed ? next : prev
      })
    })

    return cleanup
  }, [])

  // Phase 3: Listen for incremental updates (replaces full rescan on file changes)
  useEffect(() => {
    const issuesApi = (window as any).issues
    if (!issuesApi?.onIncrementalUpdate) return

    const cleanup = issuesApi.onIncrementalUpdate((updates: Array<{ type: string; filePath: string; entry?: DocEntry }>) => {
      setGroups((prev) => {
        let next = [...prev]
        let changed = false

        for (const update of updates) {
          const normalized = update.filePath.replace(/\\/g, '/')

          if (update.type === 'unlink') {
            // Remove entry from its group
            next = next.map((group) => {
              const filtered = group.documents.filter(d => d.filePath.replace(/\\/g, '/') !== normalized)
              if (filtered.length !== group.documents.length) {
                changed = true
                return { ...group, documents: filtered }
              }
              return group
            }).filter(g => g.documents.length > 0) // Remove empty groups
          } else if (update.entry && (update.type === 'add' || update.type === 'change')) {
            const entry = update.entry

            if (update.type === 'change') {
              // Update existing entry in its group
              next = next.map((group) => {
                const idx = group.documents.findIndex(d => d.filePath.replace(/\\/g, '/') === normalized)
                if (idx !== -1) {
                  changed = true
                  const docs = [...group.documents]
                  docs[idx] = entry
                  return { ...group, documents: docs }
                }
                return group
              })
            } else {
              // add: find or create group and add entry
              changed = true
              const folder = entry.folder
              const existingGroup = next.find(g => g.source === entry.source && (
                entry.source === 'standard' ? g.hash === entry.hash : g.topic === folder
              ))
              if (existingGroup) {
                next = next.map(g => g === existingGroup
                  ? { ...g, documents: [...g.documents, entry] }
                  : g
                )
              } else {
                // Create new group
                next = [...next, {
                  hash: entry.hash,
                  topic: entry.source === 'standard' ? entry.topic : folder,
                  date: entry.date,
                  documents: [entry],
                  docTypes: [entry.docType],
                  source: entry.source
                }]
              }
            }
          }
        }

        return changed ? next : prev
      })
    })

    return cleanup
  }, [])

  // Listen for workspace changes
  useEffect(() => {
    const workspaceApi = (window as any).workspace
    const watcherApi = (window as any).watcher
    const settingsApi = (window as any).settings
    if (!workspaceApi) return

    const cleanup = workspaceApi.onChanged(
      async (info: { path: string; name: string } | null) => {
        if (info) {
          const _t = performance.now()
          // Fetch settings in parallel with stopping the watcher
          const [scanningSettings] = await Promise.all([
            settingsApi ? settingsApi.get('scanning').catch(() => null) : Promise.resolve(null),
            watcherApi ? watcherApi.stop() : Promise.resolve()
          ])
          const excludePaths = (scanningSettings as { excludePaths?: string[] } | null)?.excludePaths
          console.log(`[PERF][Renderer] IssueContext workspace changed: settings+watcherStop parallel ${(performance.now() - _t).toFixed(1)}ms`)
          if (watcherApi) {
            await watcherApi.start(info.path, excludePaths)
          }
          await loadDocs(info.path)
        } else {
          setGroups([])
          currentProjectRoot.current = null
          if (watcherApi) watcherApi.stop()
        }
      }
    )

    // Load from current workspace on mount — fetch workspace + settings in parallel
    const initFromCurrentWorkspace = async (): Promise<void> => {
      try {
        const _t = performance.now()
        const [current, scanningSettings] = await Promise.all([
          workspaceApi.getCurrent().catch(() => null),
          settingsApi ? settingsApi.get('scanning').catch(() => null) : Promise.resolve(null)
        ])
        if (current) {
          const excludePaths = (scanningSettings as { excludePaths?: string[] } | null)?.excludePaths
          console.log(`[PERF][Renderer] IssueContext init: workspace+settings parallel ${(performance.now() - _t).toFixed(1)}ms`)
          if (watcherApi) {
            await watcherApi.start(current.path, excludePaths)
          }
          await loadDocs(current.path)
        }
      } catch {
        // ignore
      }
    }
    initFromCurrentWorkspace()

    return cleanup
  }, [loadDocs])

  // Legacy compat: derive flat issues array with source filtering applied
  const filteredGroups = sourceFilter
    ? groups.filter((g) => g.source === sourceFilter)
    : groups

  const issues: Issue[] = filteredGroups.flatMap((g) =>
    g.documents.map((doc) => ({
      hash: doc.hash,
      title: doc.title,
      status: 'open',
      priority: 'medium',
      category: doc.docType || 'doc',
      type: doc.docType || 'doc',
      filePath: doc.filePath,
      date: doc.date,
      source: g.source
    }))
  )

  return (
    <IssueContext.Provider value={{
      groups,
      loading,
      error,
      projectRoot: currentProjectRoot.current,
      sourceFilter,
      setSourceFilter,
      loadDocs,
      issues
    }}>
      {children}
    </IssueContext.Provider>
  )
}
