import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { FSWatcher, watch as chokidarWatch } from 'chokidar'
import { findMatchingProjectDir, resolveProjectsDir } from './session-log-locator'

/**
 * Session-log tailer — Slice 1C (I/O layer for Option E).
 *
 * Watches `~/.claude/projects/<encoded-cwd>/*.jsonl` for newline-delimited
 * envelope growth and emits each parsed envelope exactly once. Stateless
 * parsing (a JSON.parse per line) is delegated to caller wiring so the
 * tailer does not need to know about fingerprints or L0Events.
 *
 * Design choices (documented in Plan v3 Slice 1C):
 *   - One watcher per project directory — all jsonl files are tailed
 *     together so session rotation does not drop events
 *   - Per-file byte offset tracked in-memory only; on restart we resume
 *     at the current file size (we do NOT replay history)
 *   - Parse failures are swallowed and counted; a run of malformed lines
 *     does not kill the watcher (the jsonl format has historically
 *     tolerated partial writes during crashes)
 */

export interface SessionLogTailerEvents {
  /** A parsed envelope from a jsonl line. Payload is validated to be an object. */
  envelope: [{ terminalId: string; payload: Record<string, unknown>; filePath: string }]
  /** An unparseable jsonl line. Counts against telemetry but does not degrade. */
  'parse-error': [{ filePath: string; line: string; error: unknown }]
  /** File added, rotated, or unlinked. Useful for telemetry / debugging. */
  'file-event': [{ kind: 'add' | 'change' | 'unlink'; filePath: string }]
}

export interface SessionLogTailerOptions {
  /** Terminal id this tailer is bound to. Echoed on every envelope event. */
  terminalId: string
  /** cwd used to locate the project directory. */
  cwd: string
  /** Override the `~/.claude/projects` discovery (tests). */
  projectsDirOverride?: string | null
  /** Skip the watcher setup (tests). */
  dryRun?: boolean
}

type TailerEmitter = EventEmitter & {
  on<E extends keyof SessionLogTailerEvents>(
    event: E,
    listener: (...args: SessionLogTailerEvents[E]) => void
  ): TailerEmitter
  emit<E extends keyof SessionLogTailerEvents>(
    event: E,
    ...args: SessionLogTailerEvents[E]
  ): boolean
}

export class SessionLogTailer {
  private readonly emitter: TailerEmitter = new EventEmitter() as TailerEmitter
  private watcher: FSWatcher | null = null
  private projectDir: string | null = null
  private readonly offsets = new Map<string, number>()
  private disposed = false

  constructor(private readonly options: SessionLogTailerOptions) {}

  start(): { projectDir: string | null; started: boolean } {
    if (this.disposed) {
      throw new Error('SessionLogTailer: cannot start after dispose()')
    }
    if (this.watcher) {
      return { projectDir: this.projectDir, started: false }
    }

    const projectsDir = this.options.projectsDirOverride ?? resolveProjectsDir()
    if (!projectsDir) {
      return { projectDir: null, started: false }
    }

    const match = findMatchingProjectDir(projectsDir, this.options.cwd)
    if (!match) {
      return { projectDir: null, started: false }
    }
    this.projectDir = match.path

    if (this.options.dryRun) {
      return { projectDir: this.projectDir, started: false }
    }

    this.watcher = chokidarWatch(path.join(this.projectDir, '*.jsonl'), {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 }
    })

    this.watcher.on('add', (filePath: string) => this.handleFileEvent('add', filePath))
    this.watcher.on('change', (filePath: string) => this.handleFileEvent('change', filePath))
    this.watcher.on('unlink', (filePath: string) => this.handleFileEvent('unlink', filePath))

    return { projectDir: this.projectDir, started: true }
  }

  on<E extends keyof SessionLogTailerEvents>(
    event: E,
    listener: (...args: SessionLogTailerEvents[E]) => void
  ): this {
    this.emitter.on(event, listener)
    return this
  }

  off<E extends keyof SessionLogTailerEvents>(
    event: E,
    listener: (...args: SessionLogTailerEvents[E]) => void
  ): this {
    this.emitter.off(event, listener)
    return this
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.offsets.clear()
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  /**
   * Test-only: feed synthetic content for an observed file path so the
   * tail logic can be exercised without a real chokidar event.
   */
  _emitForTest(filePath: string, content: string): void {
    this.handleNewContent(filePath, content)
  }

  private handleFileEvent(kind: 'add' | 'change' | 'unlink', filePath: string): void {
    this.emitter.emit('file-event', { kind, filePath })

    if (kind === 'unlink') {
      this.offsets.delete(filePath)
      return
    }

    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      return
    }

    const currentSize = stat.size
    const previousOffset = this.offsets.get(filePath) ?? (kind === 'add' ? currentSize : 0)

    if (currentSize <= previousOffset) {
      if (kind === 'add') {
        this.offsets.set(filePath, currentSize)
      }
      return
    }

    let chunk = ''
    try {
      const fd = fs.openSync(filePath, 'r')
      try {
        const bufferSize = currentSize - previousOffset
        const buffer = Buffer.alloc(bufferSize)
        fs.readSync(fd, buffer, 0, bufferSize, previousOffset)
        chunk = buffer.toString('utf8')
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return
    }

    this.offsets.set(filePath, currentSize)
    this.handleNewContent(filePath, chunk)
  }

  private handleNewContent(filePath: string, chunk: string): void {
    const lines = chunk.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) {
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch (error) {
        this.emitter.emit('parse-error', { filePath, line: trimmed, error })
        continue
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        continue
      }
      this.emitter.emit('envelope', {
        terminalId: this.options.terminalId,
        payload: parsed as Record<string, unknown>,
        filePath
      })
    }
  }
}
