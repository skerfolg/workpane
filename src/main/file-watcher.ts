import chokidar, { FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'

export type FileChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface FileChangedPayload {
  type: FileChangeType
  path: string
}

export class WatcherManager {
  private watcher: FSWatcher | null = null
  private docsDebounceTimer: NodeJS.Timeout | null = null
  private projectDebounceTimer: NodeJS.Timeout | null = null
  private docsPending: FileChangedPayload[] = []
  private projectPending: FileChangedPayload[] = []
  private window: BrowserWindow | null = null
  private watchRoot: string = ''
  private flushCallbacks: Array<(rootDir: string, changes: FileChangedPayload[]) => void> = []

  get isWatching(): boolean {
    return this.watcher !== null
  }

  setWindow(win: BrowserWindow): void {
    this.window = win
  }

  /** Register a callback invoked each time a debounced batch of changes is flushed */
  onFlush(cb: (rootDir: string, changes: FileChangedPayload[]) => void): void {
    this.flushCallbacks.push(cb)
  }

  start(dirPath: string, excludePaths?: string[]): void {
    const _t = performance.now()
    console.log(`[PERF][Main] WatcherManager.start path=${dirPath}`)
    if (this.watcher) {
      this.stop()
    }

    this.watchRoot = dirPath

    // Build ignored patterns using RegExp for Windows backslash compatibility
    // Ignore known tool-internal dot-dirs that generate high-volume file events.
    // User-facing dot-dirs (.github, .vscode, .husky, etc.) are intentionally NOT ignored.
    const dotDirIgnored = /[/\\]\.(git|workspace|omc|claude|vs|worktrees|nuget[^/\\]*)[/\\]/
    // User-configured excludes (node_modules, dist, obj, bin, etc.)
    const userExcludes = (excludePaths || []).filter(p => p !== '.git')
    const userIgnored = userExcludes.length > 0
      ? new RegExp(`[/\\\\](${userExcludes.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[/\\\\]`)
      : null
    const ignored: (string | RegExp)[] = [dotDirIgnored]
    if (userIgnored) ignored.push(userIgnored)

    this.watcher = chokidar.watch(dirPath, {
      ignoreInitial: true,
      persistent: true,
      ignored,
      followSymlinks: false
    })
    console.log(`[PERF][Main] WatcherManager.start: chokidar.watch created ${(performance.now() - _t).toFixed(1)}ms`)

    const emit = (type: FileChangeType, path: string): void => {
      const _et = performance.now()
      const normalizedPath = path.replace(/\\/g, '/')
      const isDocsPath = normalizedPath.includes('/docs/')

      if (isDocsPath) {
        // Deduplicate by path — last event type wins
        const existing = this.docsPending.findIndex((c) => c.path === path)
        if (existing !== -1) this.docsPending.splice(existing, 1)
        this.docsPending.push({ type, path })
        if (this.docsDebounceTimer) clearTimeout(this.docsDebounceTimer)
        this.docsDebounceTimer = setTimeout(() => {
          const changes = this.docsPending.splice(0)
          console.log(`[PERF][Main] WatcherManager: flushing ${changes.length} docs changes ${(performance.now() - _et).toFixed(1)}ms`, changes.map(c => `${c.type}:${c.path}`))
          // Send a single batched IPC call with all changes
          if (changes.length > 0) {
            this.window?.webContents.send('files:changed', changes[changes.length - 1])
            for (const cb of this.flushCallbacks) cb(this.watchRoot, changes)
          }
        }, 300)
      } else {
        // Deduplicate by path — last event type wins
        const existing = this.projectPending.findIndex((c) => c.path === path)
        if (existing !== -1) this.projectPending.splice(existing, 1)
        this.projectPending.push({ type, path })
        if (this.projectDebounceTimer) clearTimeout(this.projectDebounceTimer)
        this.projectDebounceTimer = setTimeout(() => {
          const changes = this.projectPending.splice(0)
          console.log(`[PERF][Main] WatcherManager: flushing ${changes.length} project changes ${(performance.now() - _et).toFixed(1)}ms`, changes.map(c => `${c.type}:${c.path}`))
          // Send a single batched IPC call with all changes
          if (changes.length > 0) {
            this.window?.webContents.send('files:changed', changes[changes.length - 1])
            for (const cb of this.flushCallbacks) cb(this.watchRoot, changes)
          }
        }, 1000)
      }
    }

    this.watcher.on('add', (path) => emit('add', path))
    this.watcher.on('change', (path) => emit('change', path))
    this.watcher.on('unlink', (path) => emit('unlink', path))
    this.watcher.on('addDir', (path) => emit('addDir', path))
    this.watcher.on('unlinkDir', (path) => emit('unlinkDir', path))
    console.log(`[PERF][Main] WatcherManager.start done ${(performance.now() - _t).toFixed(1)}ms`)
  }

  stop(): void {
    if (this.docsDebounceTimer) {
      clearTimeout(this.docsDebounceTimer)
      this.docsDebounceTimer = null
    }
    if (this.projectDebounceTimer) {
      clearTimeout(this.projectDebounceTimer)
      this.projectDebounceTimer = null
    }
    this.docsPending = []
    this.projectPending = []
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}
