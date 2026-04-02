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
  // Write coalescing: merge rapid save calls into a single disk write
  private pendingSave: WorkspaceState | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saveInFlight: Promise<void> | null = null

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
    if (!this.currentWorkspace) return

    // Coalesce: merge incoming state into pending batch
    this.pendingSave = { ...(this.pendingSave ?? {}), ...state }

    // Debounce: only write after 300ms of quiet
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this._flushSave()
    }, 300)
  }

  private async _flushSave(): Promise<void> {
    if (!this.currentWorkspace || !this.pendingSave) return

    // Wait for any in-flight write to finish first
    if (this.saveInFlight) await this.saveInFlight

    const _t = performance.now()
    const stateToWrite = this.pendingSave
    this.pendingSave = null

    const workspaceDir = join(this.currentWorkspace.path, '.workspace')
    if (!existsSync(workspaceDir)) {
      await mkdir(workspaceDir, { recursive: true })
    }

    const statePath = join(workspaceDir, 'state.json')
    let merged: WorkspaceState = { ...stateToWrite }
    try {
      const raw = await readFile(statePath, 'utf-8')
      const existing = JSON.parse(raw) as WorkspaceState
      merged = { ...existing, ...stateToWrite }
    } catch {
      // file doesn't exist yet or is corrupt — use state as-is
    }

    this.saveInFlight = writeFile(statePath, JSON.stringify(merged, null, 2), 'utf-8')
    await this.saveInFlight
    this.saveInFlight = null
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
