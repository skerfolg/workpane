import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { Worker } from 'worker_threads'
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
  // In-memory cache of the full merged state — avoids disk reads on every save
  private stateCache: WorkspaceState | null = null
  private stateCacheLoaded = false
  // Write coalescing: merge rapid save calls into a single disk write
  private pendingSave: WorkspaceState | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private flushLock: Promise<void> | null = null

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

    // Reset state cache for new workspace
    this.stateCache = null
    this.stateCacheLoaded = false

    this.settingsManager.addRecentWorkspace(dirPath)
    console.log(`[PERF][Main] openWorkspace done ${(performance.now() - _t).toFixed(1)}ms`)

    return this.currentWorkspace
  }

  closeWorkspace(): void {
    this.currentWorkspace = null
    this.stateCache = null
    this.stateCacheLoaded = false
  }

  async getWorkspaceState(): Promise<WorkspaceState | null> {
    const _t = performance.now()
    if (!this.currentWorkspace) return null

    // Return cached state if available
    if (this.stateCacheLoaded && this.stateCache) {
      console.log(`[PERF][Main] getWorkspaceState done (cache) ${(performance.now() - _t).toFixed(1)}ms`)
      return this.stateCache
    }

    const statePath = join(this.currentWorkspace.path, '.workspace', 'state.json')
    if (!existsSync(statePath)) {
      this.stateCache = {}
      this.stateCacheLoaded = true
      return {}
    }

    try {
      const raw = await readFile(statePath, 'utf-8')
      this.stateCache = JSON.parse(raw) as WorkspaceState
      this.stateCacheLoaded = true
      console.log(`[PERF][Main] getWorkspaceState done ${(performance.now() - _t).toFixed(1)}ms`)
      return this.stateCache
    } catch {
      this.stateCache = {}
      this.stateCacheLoaded = true
      return {}
    }
  }

  async saveWorkspaceState(state: WorkspaceState): Promise<void> {
    if (!this.currentWorkspace) return

    // Update in-memory cache immediately — no disk read needed later
    this.stateCache = { ...(this.stateCache ?? {}), ...state }
    this.stateCacheLoaded = true

    // Coalesce: merge incoming state into pending batch
    this.pendingSave = { ...this.stateCache }

    // Debounce: only write after 500ms of quiet
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this._flushSave()
    }, 500)
  }

  private async _flushSave(): Promise<void> {
    if (!this.currentWorkspace || !this.pendingSave) return

    // Mutex: serialize concurrent flush calls
    if (this.flushLock) {
      await this.flushLock
      // After waiting, pendingSave may have been consumed — recheck
      if (!this.pendingSave) return
    }

    let resolve: () => void
    this.flushLock = new Promise<void>(r => { resolve = r })

    const _t = performance.now()
    const dataToWrite = this.pendingSave
    this.pendingSave = null

    const workspaceDir = join(this.currentWorkspace.path, '.workspace')
    const statePath = join(workspaceDir, 'state.json')

    try {
      // Write in a worker thread to avoid event loop congestion
      const json = JSON.stringify(dataToWrite)
      await this._writeInWorker(statePath, json)
      console.log(`[PERF][Main] saveWorkspaceState done ${(json.length / 1024).toFixed(1)}KB ${(performance.now() - _t).toFixed(1)}ms`)
    } catch (err) {
      console.error('[Main] saveWorkspaceState error:', err)
      // Fallback: try direct write
      try {
        if (!existsSync(workspaceDir)) {
          await mkdir(workspaceDir, { recursive: true })
        }
        await writeFile(statePath, JSON.stringify(dataToWrite), 'utf-8')
      } catch {
        // ignore — best effort
      }
    } finally {
      this.flushLock = null
      resolve!()
    }
  }

  private _writeInWorker(filePath: string, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        `const { parentPort, workerData } = require('worker_threads');
         const fs = require('fs');
         const path = require('path');
         const dir = path.dirname(workerData.filePath);
         if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
         fs.writeFileSync(workerData.filePath, workerData.data, 'utf-8');
         parentPort.postMessage('done');`,
        { eval: true, workerData: { filePath, data } }
      )
      worker.on('message', () => { resolve(); worker.terminate() })
      worker.on('error', (err) => { reject(err); worker.terminate() })
    })
  }

  // Synchronous save for beforeunload — async not possible in unload handlers
  saveWorkspaceStateSync(state: WorkspaceState): void {
    if (!this.currentWorkspace) return

    // Use in-memory cache to avoid disk read
    const merged = { ...(this.stateCache ?? {}), ...state }
    this.stateCache = merged
    this.stateCacheLoaded = true

    const workspaceDir = join(this.currentWorkspace.path, '.workspace')
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true })
    }

    const statePath = join(workspaceDir, 'state.json')
    writeFileSync(statePath, JSON.stringify(merged), 'utf-8')
  }

  listWorkspaces(): string[] {
    return this.settingsManager.getRecentWorkspaces()
  }

  getCurrentWorkspace(): WorkspaceInfo | null {
    return this.currentWorkspace
  }
}
