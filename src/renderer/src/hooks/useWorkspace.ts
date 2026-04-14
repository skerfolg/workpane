import { useState, useEffect, useCallback } from 'react'

export interface WorkspaceInfo {
  path: string
  name: string
}

interface UseWorkspaceReturn {
  currentWorkspace: WorkspaceInfo | null
  recentWorkspaces: string[]
  openWorkspace: () => Promise<void>
  openWorkspacePath: (path: string) => Promise<void>
}

export function useWorkspace(): UseWorkspaceReturn {
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceInfo | null>(null)
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([])

  useEffect(() => {
    // Load initial state
    const init = async (): Promise<void> => {
      if (window.workspace) {
        const current = await window.workspace.getCurrent()
        setCurrentWorkspace(current)
        const recent = await window.workspace.getRecent()
        setRecentWorkspaces(recent)
      }
    }
    init()

    // Listen for workspace changes
    if (window.workspace?.onChanged) {
      const cleanup = window.workspace.onChanged(async (info) => {
        setCurrentWorkspace(info)
        const recent = await window.workspace.getRecent()
        setRecentWorkspaces(recent)
      })
      return cleanup
    }
    return undefined
  }, [])

  const openWorkspace = useCallback(async (): Promise<void> => {
    if (window.workspace) {
      await window.workspace.open()
    }
  }, [])

  const openWorkspacePath = useCallback(async (path: string): Promise<void> => {
    if (window.workspace) {
      await window.workspace.openPath(path)
    }
  }, [])

  return { currentWorkspace, recentWorkspaces, openWorkspace, openWorkspacePath }
}
