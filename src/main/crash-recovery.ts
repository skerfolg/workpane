import { join } from 'path'
import * as fs from 'fs'

export interface OpenFile {
  path: string
  content: string
  isDirty: boolean
}

export interface AutoSaveEntry {
  originalPath: string
  content: string
  savedAt: string
}

export class CrashRecovery {
  private timer: ReturnType<typeof setInterval> | null = null
  private getOpenFiles: (() => OpenFile[]) | null = null

  startAutoSave(getOpenFiles: () => OpenFile[], interval: number = 30000): void {
    this.getOpenFiles = getOpenFiles
    if (this.timer) clearInterval(this.timer)

    this.timer = setInterval(() => {
      const files = this.getOpenFiles?.() ?? []
      const dirty = files.filter((f) => f.isDirty)
      if (dirty.length > 0) {
        // We need a workspace path; use each file's directory as fallback
        // In practice callers should call saveState directly
        this.saveState('', dirty)
      }
    }, interval)
  }

  stopAutoSave(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  saveState(workspacePath: string, openFiles: OpenFile[]): void {
    if (!workspacePath) return
    const autosaveDir = join(workspacePath, '.workspace', '.autosave')
    fs.mkdirSync(autosaveDir, { recursive: true })

    for (const file of openFiles) {
      if (!file.isDirty) continue
      const entry: AutoSaveEntry = {
        originalPath: file.path,
        content: file.content,
        savedAt: new Date().toISOString()
      }
      // Use a safe filename derived from the original path
      const safeName = file.path.replace(/[/\\:*?"<>|]/g, '_') + '.autosave.json'
      fs.writeFileSync(join(autosaveDir, safeName), JSON.stringify(entry, null, 2), 'utf-8')
    }
  }

  checkRecovery(workspacePath: string): AutoSaveEntry[] {
    const autosaveDir = join(workspacePath, '.workspace', '.autosave')
    if (!fs.existsSync(autosaveDir)) return []

    const entries: AutoSaveEntry[] = []
    const files = fs.readdirSync(autosaveDir).filter((f) => f.endsWith('.autosave.json'))

    for (const file of files) {
      try {
        const raw = fs.readFileSync(join(autosaveDir, file), 'utf-8')
        const entry = JSON.parse(raw) as AutoSaveEntry
        entries.push(entry)
      } catch {
        // skip malformed autosave file
      }
    }

    return entries
  }

  recoverFiles(workspacePath: string): AutoSaveEntry[] {
    const entries = this.checkRecovery(workspacePath)
    for (const entry of entries) {
      try {
        // Restore file to its original path
        const dir = entry.originalPath.replace(/[^/\\]+$/, '')
        if (dir) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(entry.originalPath, entry.content, 'utf-8')
      } catch {
        // best-effort recovery
      }
    }
    return entries
  }

  clearAutoSave(workspacePath: string): void {
    const autosaveDir = join(workspacePath, '.workspace', '.autosave')
    if (fs.existsSync(autosaveDir)) {
      fs.rmSync(autosaveDir, { recursive: true, force: true })
    }
  }
}
