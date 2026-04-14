import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { KanbanIssue, ColumnDef, KanbanStore, PromptTemplate, Prompt } from '../../../shared/types'

export type { KanbanIssue, ColumnDef, KanbanStore, PromptTemplate, Prompt }

interface KanbanContextValue {
  issues: KanbanIssue[]
  columns: ColumnDef[]
  promptTemplates: PromptTemplate[]
  loading: boolean
  error: string | null
  workspacePath: string | null
  loadStore: (workspacePath: string) => Promise<void>
  createIssue: (data: { title: string; description?: string; status?: string }) => Promise<KanbanIssue | null>
  updateIssue: (issueId: string, updates: { title?: string; description?: string; status?: string; linkedDocuments?: string[]; promptId?: string }) => Promise<KanbanIssue | null>
  deleteIssue: (issueId: string) => Promise<boolean>
  updateIssueStatus: (issueId: string, status: string) => Promise<void>
  generatePrompt: (issueId: string, templateId?: string) => Promise<Prompt | null>
  linkDocument: (issueId: string, docPath: string) => Promise<void>
  unlinkDocument: (issueId: string, docPath: string) => Promise<void>
  setColumns: (columns: ColumnDef[]) => Promise<void>
  saveTemplate: (template: PromptTemplate) => Promise<void>
}

export const KanbanContext = createContext<KanbanContextValue | null>(null)

export function useKanban(): KanbanContextValue {
  const ctx = useContext(KanbanContext)
  if (!ctx) throw new Error('useKanban must be used within KanbanProvider')
  return ctx
}

export function KanbanProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [issues, setIssues] = useState<KanbanIssue[]>([])
  const [columns, setColumnsState] = useState<ColumnDef[]>([])
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentWorkspacePath = useRef<string | null>(null)
  const loadInFlightRef = useRef(false)

  const getApi = (): typeof window.kanban | null => {
    return (window as any).kanban ?? null
  }

  const loadStore = useCallback(async (workspacePath: string): Promise<void> => {
    if (loadInFlightRef.current) return
    currentWorkspacePath.current = workspacePath
    loadInFlightRef.current = true
    setLoading(true)
    setError(null)
    try {
      const api = getApi()
      if (!api) throw new Error('kanban API not available')
      const ipcStart = performance.now()
      const store = await api.load(workspacePath) as KanbanStore
      console.log(`[PERF][Renderer] IPC loadKanban RTT: ${(performance.now() - ipcStart).toFixed(1)}ms`)
      setIssues(store.issues ?? [])
      setColumnsState(store.columns ?? [])
      setPromptTemplates(store.promptTemplates ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      loadInFlightRef.current = false
    }
  }, [])

  const createIssue = useCallback(async (
    data: { title: string; description?: string; status?: string }
  ): Promise<KanbanIssue | null> => {
    const api = getApi()
    const wp = currentWorkspacePath.current
    if (!api || !wp) return null
    const issue = await api.createIssue(wp, data) as KanbanIssue
    setIssues((prev) => [...prev, issue])
    return issue
  }, [])

  const updateIssue = useCallback(async (
    issueId: string,
    updates: { title?: string; description?: string; status?: string; linkedDocuments?: string[]; promptId?: string }
  ): Promise<KanbanIssue | null> => {
    const api = getApi()
    const wp = currentWorkspacePath.current
    if (!api || !wp) return null
    const updated = await api.updateIssue(wp, issueId, updates) as KanbanIssue | null
    if (updated) {
      setIssues((prev) => prev.map((i) => i.id === issueId ? updated : i))
    }
    return updated
  }, [])

  const deleteIssue = useCallback(async (issueId: string): Promise<boolean> => {
    const api = getApi()
    const wp = currentWorkspacePath.current
    if (!api || !wp) return false
    const result = await api.deleteIssue(wp, issueId) as boolean
    if (result) {
      setIssues((prev) => prev.filter((i) => i.id !== issueId))
    }
    return result
  }, [])

  const updateIssueStatus = useCallback(async (issueId: string, status: string): Promise<void> => {
    const api = getApi()
    const wp = currentWorkspacePath.current
    if (!api || !wp) return
    const updated = await api.updateStatus(wp, issueId, status) as KanbanIssue | null
    if (updated) {
      setIssues((prev) => prev.map((i) => i.id === issueId ? updated : i))
    }
  }, [])

  const generatePrompt = useCallback(async (issueId: string, templateId?: string): Promise<Prompt | null> => {
    const api = getApi()
    const wp = currentWorkspacePath.current
    if (!api || !wp) return null
    return await api.generatePrompt(wp, issueId, templateId) as Prompt
  }, [])

  const linkDocument = useCallback(async (issueId: string, docPath: string): Promise<void> => {
    const api = getApi()
    const wp = currentWorkspacePath.current
    if (!api || !wp) return
    const updated = await api.linkDoc(wp, issueId, docPath) as KanbanIssue | null
    if (updated) {
      setIssues((prev) => prev.map((i) => i.id === issueId ? updated : i))
    }
  }, [])

  const unlinkDocument = useCallback(async (issueId: string, docPath: string): Promise<void> => {
    const api = getApi()
    const wp = currentWorkspacePath.current
    if (!api || !wp) return
    const updated = await api.unlinkDoc(wp, issueId, docPath) as KanbanIssue | null
    if (updated) {
      setIssues((prev) => prev.map((i) => i.id === issueId ? updated : i))
    }
  }, [])

  const setColumns = useCallback(async (cols: ColumnDef[]): Promise<void> => {
    const api = getApi()
    const wp = currentWorkspacePath.current
    setColumnsState(cols)
    if (!api || !wp) return
    await api.setColumns(wp, cols)
  }, [])

  const saveTemplate = useCallback(async (template: PromptTemplate): Promise<void> => {
    const api = getApi()
    const wp = currentWorkspacePath.current
    if (!api || !wp) return
    const saved = await api.saveTemplate(wp, template) as PromptTemplate
    setPromptTemplates((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id)
      if (idx === -1) return [...prev, saved]
      return prev.map((t) => t.id === saved.id ? saved : t)
    })
  }, [])

  // Listen for workspace changes and load kanban store
  useEffect(() => {
    const workspaceApi = (window as any).workspace
    if (!workspaceApi) return

    const cleanup = workspaceApi.onChanged(
      async (info: { path: string; name: string } | null) => {
        if (info) {
          await loadStore(info.path)
        } else {
          setIssues([])
          setColumnsState([])
          setPromptTemplates([])
          currentWorkspacePath.current = null
        }
      }
    )

    // Load from current workspace on mount (non-blocking — does not delay terminal init)
    const initFromCurrentWorkspace = async (): Promise<void> => {
      try {
        const _t = performance.now()
        const current = await workspaceApi.getCurrent().catch(() => null)
        if (current) {
          console.log(`[PERF][Renderer] KanbanContext init: getCurrent ${(performance.now() - _t).toFixed(1)}ms`)
          await loadStore(current.path)
        }
      } catch {
        // ignore
      }
    }
    initFromCurrentWorkspace()

    return cleanup
  }, [loadStore])

  // Listen for file changes and reload kanban store (debounced to prevent IPC flooding)
  useEffect(() => {
    const watcherApi = (window as any).watcher
    if (!watcherApi) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = watcherApi.onChanged((_data: { type: string; path: string }) => {
      if (!currentWorkspacePath.current) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        if (currentWorkspacePath.current) {
          loadStore(currentWorkspacePath.current)
        }
      }, 500)
    })

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      cleanup()
    }
  }, [loadStore])

  return (
    <KanbanContext.Provider value={{
      issues,
      columns,
      promptTemplates,
      loading,
      error,
      workspacePath: currentWorkspacePath.current,
      loadStore,
      createIssue,
      updateIssue,
      deleteIssue,
      updateIssueStatus,
      generatePrompt,
      linkDocument,
      unlinkDocument,
      setColumns,
      saveTemplate
    }}>
      {children}
    </KanbanContext.Provider>
  )
}
