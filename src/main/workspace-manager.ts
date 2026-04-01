import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { SettingsManager } from './settings-manager'

export interface WorkspaceInfo {
  path: string
  name: string
}

export interface WorkspaceState {
  [key: string]: unknown
}

export class WorkspaceManager {
  private currentWorkspace: WorkspaceInfo | null = null
  private settingsManager: SettingsManager

  constructor(settingsManager: SettingsManager) {
    this.settingsManager = settingsManager
  }

  openWorkspace(dirPath: string): WorkspaceInfo {
    const _t = performance.now()
    console.log(`[PERF][Main] openWorkspace start path=${dirPath}`)
    if (!existsSync(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`)
    }

    const workspaceDir = join(dirPath, '.workspace')
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true })
    }
    console.log(`[PERF][Main] openWorkspace: workspace dir ready ${(performance.now() - _t).toFixed(1)}ms`)

    const name = dirPath.split(/[\\/]/).pop() || dirPath
    this.currentWorkspace = { path: dirPath, name }

    this.settingsManager.addRecentWorkspace(dirPath)
    console.log(`[PERF][Main] openWorkspace done ${(performance.now() - _t).toFixed(1)}ms`)

    return this.currentWorkspace
  }

  closeWorkspace(): void {
    this.currentWorkspace = null
  }

  async getWorkspaceState(): Promise<WorkspaceState | null> {
    const _t = performance.now()
    if (!this.currentWorkspace) return null

    const statePath = join(this.currentWorkspace.path, '.workspace', 'state.json')
    if (!existsSync(statePath)) return {}

    try {
      const raw = await readFile(statePath, 'utf-8')
      const result = JSON.parse(raw) as WorkspaceState
      console.log(`[PERF][Main] getWorkspaceState done ${(performance.now() - _t).toFixed(1)}ms`)
      return result
    } catch {
      return {}
    }
  }

  async saveWorkspaceState(state: WorkspaceState): Promise<void> {
    const _t = performance.now()
    if (!this.currentWorkspace) return

    const workspaceDir = join(this.currentWorkspace.path, '.workspace')
    if (!existsSync(workspaceDir)) {
      await mkdir(workspaceDir, { recursive: true })
    }

    const statePath = join(workspaceDir, 'state.json')
    // Shallow-merge incoming keys into existing state so that different
    // contexts (terminal, editor, etc.) can save independently without
    // overwriting each other's data.
    let merged: WorkspaceState = { ...state }
    try {
      const raw = await readFile(statePath, 'utf-8')
      const existing = JSON.parse(raw) as WorkspaceState
      merged = { ...existing, ...state }
    } catch {
      // file doesn't exist yet or is corrupt — use state as-is
    }
    await writeFile(statePath, JSON.stringify(merged, null, 2), 'utf-8')
    console.log(`[PERF][Main] saveWorkspaceState done ${(performance.now() - _t).toFixed(1)}ms`)
  }

  // Synchronous save for beforeunload — async not possible in unload handlers
  saveWorkspaceStateSync(state: WorkspaceState): void {
    if (!this.currentWorkspace) return

    const workspaceDir = join(this.currentWorkspace.path, '.workspace')
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true })
    }

    const statePath = join(workspaceDir, 'state.json')
    let merged: WorkspaceState = { ...state }
    try {
      const raw = readFileSync(statePath, 'utf-8')
      const existing = JSON.parse(raw) as WorkspaceState
      merged = { ...existing, ...state }
    } catch {
      // file doesn't exist yet or is corrupt — use state as-is
    }
    writeFileSync(statePath, JSON.stringify(merged, null, 2), 'utf-8')
  }

  listWorkspaces(): string[] {
    return this.settingsManager.getRecentWorkspaces()
  }

  getCurrentWorkspace(): WorkspaceInfo | null {
    return this.currentWorkspace
  }
}
