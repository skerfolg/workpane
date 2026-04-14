import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { UnifiedSkill, InstalledSkillRecord } from '../../../shared/types'
import { useToast } from '../components/Toast/Toast'

interface SkillsContextValue {
  skills: UnifiedSkill[]
  installedRecords: InstalledSkillRecord[]
  loading: boolean
  error: string | null
  pendingInstalls: Set<string>
  installSkill: (skillId: string, agentId: string) => Promise<void>
  uninstallSkill: (skillId: string, agentId: string) => Promise<void>
  refreshRegistry: () => Promise<void>
  isInstalled: (skillId: string, agentId: string) => boolean
  getInstalledVersion: (skillId: string, agentId: string) => string | null
  hasUpdate: (skillId: string, agentId: string) => boolean
}

const SkillsContext = createContext<SkillsContextValue | null>(null)

export function useSkills(): SkillsContextValue {
  const ctx = useContext(SkillsContext)
  if (!ctx) throw new Error('useSkills must be used within SkillsProvider')
  return ctx
}

function pendingKey(skillId: string, agentId: string): string {
  return `${skillId}:${agentId}`
}

interface SkillsProviderProps {
  workspacePath: string | null
  children: React.ReactNode
}

export function SkillsProvider({ workspacePath, children }: SkillsProviderProps): React.JSX.Element {
  const [skills, setSkills] = useState<UnifiedSkill[]>([])
  const [installedRecords, setInstalledRecords] = useState<InstalledSkillRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingInstalls, setPendingInstalls] = useState<Set<string>>(new Set())

  const { showToast } = useToast()

  const loadInstalledRecords = useCallback(async (path: string): Promise<void> => {
    try {
      const records = await window.skills.getInstalledRecords(path)
      setInstalledRecords(records)
    } catch {
      // Non-fatal: installed records will be empty
    }
  }, [])

  const loadUnified = useCallback(async (path: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const unified = await window.skills.getUnified()
      setSkills(unified)
      await loadInstalledRecords(path)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load skills'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [loadInstalledRecords])

  useEffect(() => {
    if (workspacePath) {
      loadUnified(workspacePath)
    } else {
      setSkills([])
      setInstalledRecords([])
      setError(null)
    }
  }, [workspacePath, loadUnified])

  const installSkill = useCallback(
    async (skillId: string, agentId: string): Promise<void> => {
      if (!workspacePath) return
      const key = pendingKey(skillId, agentId)
      setPendingInstalls((prev) => new Set(prev).add(key))
      try {
        await window.skills.installRegistry(skillId, agentId, workspacePath)
        await loadInstalledRecords(workspacePath)
        showToast('Skill installed successfully', 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to install skill'
        showToast(message, 'error')
      } finally {
        setPendingInstalls((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    },
    [workspacePath, loadInstalledRecords, showToast]
  )

  const uninstallSkill = useCallback(
    async (skillId: string, agentId: string): Promise<void> => {
      if (!workspacePath) return
      const key = pendingKey(skillId, agentId)
      setPendingInstalls((prev) => new Set(prev).add(key))
      try {
        await window.skills.uninstallRegistry(skillId, agentId, workspacePath)
        await loadInstalledRecords(workspacePath)
        showToast('Skill uninstalled', 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to uninstall skill'
        showToast(message, 'error')
      } finally {
        setPendingInstalls((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    },
    [workspacePath, loadInstalledRecords, showToast]
  )

  const refreshRegistry = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await window.skills.refreshRegistry()
      const unified = await window.skills.getUnified()
      setSkills(unified)
      if (workspacePath) {
        await loadInstalledRecords(workspacePath)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh registry'
      setError(message)
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [workspacePath, loadInstalledRecords, showToast])

  const isInstalled = useCallback(
    (skillId: string, agentId: string): boolean => {
      return installedRecords.some((r) => r.skillId === skillId && r.agentId === agentId)
    },
    [installedRecords]
  )

  const getInstalledVersion = useCallback(
    (skillId: string, agentId: string): string | null => {
      const record = installedRecords.find((r) => r.skillId === skillId && r.agentId === agentId)
      return record?.version ?? null
    },
    [installedRecords]
  )

  const hasUpdate = useCallback(
    (skillId: string, agentId: string): boolean => {
      const installedVersion = getInstalledVersion(skillId, agentId)
      if (!installedVersion) return false
      const skill = skills.find((s) => s.id === skillId)
      if (!skill) return false
      return skill.version !== installedVersion
    },
    [skills, getInstalledVersion]
  )

  return (
    <SkillsContext.Provider
      value={{
        skills,
        installedRecords,
        loading,
        error,
        pendingInstalls,
        installSkill,
        uninstallSkill,
        refreshRegistry,
        isInstalled,
        getInstalledVersion,
        hasUpdate
      }}
    >
      {children}
    </SkillsContext.Provider>
  )
}
