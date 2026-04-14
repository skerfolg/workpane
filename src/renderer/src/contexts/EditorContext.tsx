import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import { disposeModel, updateModelContent } from '../utils/monaco-model-cache'
import { getContent, setContent, removeContent } from '../utils/content-store'

export interface EditorTab {
  id: string
  filePath: string
  title: string
  isActive: boolean
  isDirty: boolean
  mtime?: number
  isConflicted?: boolean
}

interface SavedEditorState {
  editorTabs: Array<{ filePath: string; title: string }>
  activeEditorFilePath: string | null
}

interface EditorContextValue {
  tabs: EditorTab[]
  activeTab: EditorTab | null
  openFile: (filePath: string) => Promise<void>
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  reorderTabs: (from: number, to: number) => void
  updateContent: (id: string, newContent: string) => void
  saveFile: (id: string) => Promise<void>
  resolveConflict: (id: string, action: 'reload' | 'ignore') => Promise<void>
}

export const EditorContext = createContext<EditorContextValue | null>(null)

let tabIdCounter = 0

export function EditorProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const tabsRef = useRef<EditorTab[]>(tabs)
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Workspace-scoped editor state cache: maps workspace path → saved tab list
  const workspaceStatesRef = useRef<Map<string, SavedEditorState>>(new Map())
  const currentWorkspaceRef = useRef<string | null>(null)

  // Keep ref in sync with state so interval callbacks see current tabs
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  const activeTab = tabs.find((t) => t.isActive) ?? null

  // Auto-save setup: read interval from settings
  useEffect(() => {
    const setupStart = performance.now()
    let interval = 30000

    const startAutoSave = (ms: number): void => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current)
      console.log(`[PERF][Renderer] EditorContext auto-save setup: ${(performance.now() - setupStart).toFixed(1)}ms, interval: ${ms}ms`)
      autoSaveTimerRef.current = setInterval(async () => {
        const settings = await window.settings.get('general') as { autoSave?: boolean; autoSaveInterval?: number } | null
        if (!settings?.autoSave) return
        const dirtyTabs = tabsRef.current.filter((t) => t.isDirty && !t.isConflicted)
        for (const tab of dirtyTabs) {
          try {
            const content = getContent(tab.filePath)
            await window.fs.writeFile(tab.filePath, content)
            setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, isDirty: false } : t)))
          } catch (err) {
            console.error('Auto-save failed for', tab.filePath, err)
          }
        }
      }, ms)
    }

    window.settings.get('general').then((s) => {
      const gen = s as { autoSave?: boolean; autoSaveInterval?: number } | null
      if (gen?.autoSaveInterval) interval = gen.autoSaveInterval
      startAutoSave(interval)
    }).catch(() => startAutoSave(interval))

    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current)
    }
  }, [])

  // File watcher conflict detection
  useEffect(() => {
    const unsubscribe = window.watcher.onChanged(async (data) => {
      if (data.type !== 'change') return
      const changedPath = data.path.replace(/\\/g, '/')
      const matchingTab = tabsRef.current.find(
        (t) => t.filePath.replace(/\\/g, '/') === changedPath && t.isDirty
      )
      if (!matchingTab) return

      try {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === matchingTab.id ? { ...t, isConflicted: true } : t
          )
        )
      } catch (err) {
        console.error('Conflict check failed:', err)
      }
    })
    return () => unsubscribe()
  }, [])

  const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
  const STREAM_THRESHOLD = 1024 * 1024 // 1MB

  // Serialize current tabs for persistence
  const serializeEditorState = useCallback((): SavedEditorState => {
    const currentTabs = tabsRef.current
    const active = currentTabs.find((t) => t.isActive)
    return {
      editorTabs: currentTabs.map((t) => ({ filePath: t.filePath, title: t.title })),
      activeEditorFilePath: active?.filePath ?? null
    }
  }, [])

  // Restore editor tabs from saved state
  const restoreEditorState = useCallback(async (saved: SavedEditorState): Promise<void> => {
    // Close all current tabs (dispose models and content)
    for (const tab of tabsRef.current) {
      disposeModel(tab.filePath)
      removeContent(tab.filePath)
    }

    if (!saved.editorTabs || saved.editorTabs.length === 0) {
      setTabs([])
      return
    }

    const restoredTabs: EditorTab[] = []
    for (const savedTab of saved.editorTabs) {
      try {
        const stat = await window.fs.stat(savedTab.filePath)
        if (stat.size > MAX_FILE_SIZE) continue

        let fileContent: string
        if (stat.size > STREAM_THRESHOLD) {
          fileContent = await window.fs.readFileStream(savedTab.filePath)
        } else {
          fileContent = await window.fs.readFile(savedTab.filePath)
        }

        const id = `tab-${++tabIdCounter}`
        setContent(savedTab.filePath, fileContent)
        restoredTabs.push({
          id,
          filePath: savedTab.filePath,
          title: savedTab.title,
          isActive: savedTab.filePath === saved.activeEditorFilePath,
          isDirty: false,
          isConflicted: false
        })
      } catch {
        // File no longer exists or is unreadable — skip
      }
    }

    // Ensure exactly one tab is active
    if (restoredTabs.length > 0 && !restoredTabs.some((t) => t.isActive)) {
      restoredTabs[0].isActive = true
    }

    setTabs(restoredTabs)
  }, [])

  // Initialize editor tabs when workspace changes
  const initEditorTabs = useCallback(
    async (workspaceCwd: string): Promise<void> => {
      // Same workspace — no-op
      if (currentWorkspaceRef.current === workspaceCwd) return

      // Save current workspace state before switching (if not first load)
      if (currentWorkspaceRef.current !== null) {
        workspaceStatesRef.current.set(currentWorkspaceRef.current, serializeEditorState())
      }

      currentWorkspaceRef.current = workspaceCwd

      // Fast path: restore from in-memory cache (no IPC)
      if (workspaceStatesRef.current.has(workspaceCwd)) {
        const cached = workspaceStatesRef.current.get(workspaceCwd)!
        await restoreEditorState(cached)
        return
      }

      // Slow path: load from disk via IPC
      const wsApi = (window as any).workspace
      if (wsApi) {
        try {
          const savedState = await wsApi.getState()
          if (savedState?.editorTabs && Array.isArray(savedState.editorTabs)) {
            await restoreEditorState(savedState as SavedEditorState)
            return
          }
        } catch {
          // ignore
        }
      }

      // No saved state — start with empty editor
      for (const tab of tabsRef.current) {
        disposeModel(tab.filePath)
        removeContent(tab.filePath)
      }
      setTabs([])
    },
    [serializeEditorState, restoreEditorState]
  )

  // Listen for workspace changes
  useEffect(() => {
    const wsApi = (window as any).workspace
    if (!wsApi) return

    wsApi
      .getCurrent()
      .then((current: { path: string; name: string } | null) => {
        if (current?.path) initEditorTabs(current.path)
      })
      .catch(() => { /* ignore */ })

    const unsub = wsApi.onChanged((info: { path: string; name: string } | null) => {
      if (info?.path) initEditorTabs(info.path)
    })

    return () => {
      if (unsub) unsub()
    }
  }, [initEditorTabs])

  // Suppress saves during startup — restored state shouldn't trigger immediate re-save
  const editorInitDoneRef = useRef(false)
  useEffect(() => {
    const timer = setTimeout(() => { editorInitDoneRef.current = true }, 2000)
    return () => clearTimeout(timer)
  }, [])

  // Save editor state on tab changes (debounced)
  const editorSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const api = (window as any).workspace
    if (!api || !currentWorkspaceRef.current) return
    if (!editorInitDoneRef.current) return  // Skip saves during startup
    if (editorSaveTimeoutRef.current) clearTimeout(editorSaveTimeoutRef.current)
    editorSaveTimeoutRef.current = setTimeout(() => {
      try {
        api.saveState(serializeEditorState())
      } catch {
        // ignore save errors
      }
    }, 500)
    return () => {
      if (editorSaveTimeoutRef.current) clearTimeout(editorSaveTimeoutRef.current)
    }
  }, [tabs, serializeEditorState])

  // Save editor state on beforeunload
  useEffect(() => {
    const handleUnload = (): void => {
      const api = (window as any).workspace
      if (api && currentWorkspaceRef.current) {
        try {
          api.saveState(serializeEditorState())
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [tabs, serializeEditorState])

  const openFile = useCallback(async (filePath: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.filePath === filePath)
      if (existing) {
        return prev.map((t) => ({ ...t, isActive: t.id === existing.id }))
      }
      return prev
    })

    const alreadyOpen = tabsRef.current.find((t) => t.filePath === filePath)
    if (alreadyOpen) return

    try {
      const perfStart = performance.now()
      const stat = await window.fs.stat(filePath)

      if (stat.size > MAX_FILE_SIZE) {
        console.warn(`[PERF][Renderer] openFile: file too large (${stat.size} bytes), skipping`)
        return
      }

      let fileContent: string
      if (stat.size > STREAM_THRESHOLD) {
        console.log(`[PERF][Renderer] openFile: large file (${stat.size} bytes), using stream`)
        fileContent = await window.fs.readFileStream(filePath)
      } else {
        fileContent = await window.fs.readFile(filePath)
      }
      console.log(`[PERF][Renderer] openFile: loaded ${filePath} (${stat.size} bytes) in ${(performance.now() - perfStart).toFixed(1)}ms`)

      const title = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath
      const id = `tab-${++tabIdCounter}`

      setContent(filePath, fileContent)

      setTabs((prev) => [
        ...prev.map((t) => ({ ...t, isActive: false })),
        { id, filePath, title, isActive: true, isDirty: false, isConflicted: false }
      ])
    } catch (err) {
      console.error('Failed to open file:', err)
    }
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return prev
      // Dispose the cached Monaco model and content store entry for this tab
      disposeModel(prev[idx].filePath)
      removeContent(prev[idx].filePath)
      const next = prev.filter((t) => t.id !== id)
      if (next.length === 0) return next
      const wasActive = prev[idx].isActive
      if (wasActive) {
        const newActiveIdx = Math.min(idx, next.length - 1)
        return next.map((t, i) => ({ ...t, isActive: i === newActiveIdx }))
      }
      return next
    })
  }, [])

  const setActiveTab = useCallback((id: string) => {
    setTabs((prev) => prev.map((t) => ({ ...t, isActive: t.id === id })))
  }, [])

  const reorderTabs = useCallback((from: number, to: number) => {
    setTabs((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  const updateContent = useCallback((id: string, newContent: string) => {
    const tab = tabsRef.current.find((t) => t.id === id)
    if (tab) {
      setContent(tab.filePath, newContent)
    }
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isDirty: true } : t))
    )
  }, [])

  const saveFile = useCallback(async (id: string) => {
    const tab = tabsRef.current.find((t) => t.id === id)
    if (!tab) return
    try {
      const content = getContent(tab.filePath)
      await window.fs.writeFile(tab.filePath, content)
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, isDirty: false, isConflicted: false } : t))
      )
    } catch (err) {
      console.error('Failed to save file:', err)
    }
  }, [])

  const resolveConflict = useCallback(async (id: string, action: 'reload' | 'ignore') => {
    const tab = tabsRef.current.find((t) => t.id === id)
    if (!tab) return
    if (action === 'reload') {
      try {
        const content = await window.fs.readFile(tab.filePath)
        setContent(tab.filePath, content)
        updateModelContent(tab.filePath, content)
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, isDirty: false, isConflicted: false } : t
          )
        )
      } catch (err) {
        console.error('Failed to reload file:', err)
      }
    } else {
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, isConflicted: false } : t))
      )
    }
  }, [])

  return (
    <EditorContext.Provider
      value={{ tabs, activeTab, openFile, closeTab, setActiveTab, reorderTabs, updateContent, saveFile, resolveConflict }}
    >
      {children}
    </EditorContext.Provider>
  )
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor must be used within EditorProvider')
  return ctx
}
