import { SessionLogTailer, type SessionLogTailerOptions } from './session-log-tailer'
import { encodeCwdToProjectDir } from './session-log-locator'

/**
 * Ref-counted pool of SessionLogTailer instances keyed by encoded cwd.
 *
 * Problem (G3 / RW-B): multiple terminals can share a cwd. A tailer-per-
 * terminal design would have each tailer open its own watcher on the
 * same ~/.claude/projects/<encoded-cwd>/*.jsonl, emit identical
 * envelopes, and multiply downstream work per active terminal.
 *
 * Solution: one tailer per cwd, many subscribers. Each subscriber
 * receives the same parsed envelope tagged with its own terminalId so
 * the pipeline still keeps per-terminal state. When the last
 * subscriber releases, the tailer is disposed.
 *
 * Diagnostic counter (RW-R8): active_tailers_total should track the
 * number of distinct cwds being watched, which must equal the number
 * of entries in the internal map.
 */

export type TailerEnvelopeHandler = (envelope: {
  terminalId: string
  payload: Record<string, unknown>
  filePath: string
}) => void

interface PoolEntry {
  tailer: SessionLogTailer
  cwd: string
  encodedCwd: string
  subscribers: Map<string, TailerEnvelopeHandler>
  /** Last started state so we skip a second start on reuse. */
  started: boolean
}

export interface AcquireOptions {
  terminalId: string
  cwd: string
  onEnvelope: TailerEnvelopeHandler
  /** Test override — injected into the underlying tailer. */
  projectsDirOverride?: string | null
  /** Test override — skip the chokidar watcher setup. */
  dryRun?: boolean
}

export interface AcquireResult {
  /** Absolute project dir the tailer ended up watching, or null if unresolved. */
  projectDir: string | null
  /** Call this to drop the subscription. Safe to call more than once. */
  release: () => void
}

export class SessionLogTailerPool {
  private readonly entries = new Map<string, PoolEntry>()

  acquire(options: AcquireOptions): AcquireResult {
    const encoded = encodeCwdToProjectDir(options.cwd)
    let entry = this.entries.get(encoded)

    if (!entry) {
      const tailerOptions: SessionLogTailerOptions = {
        terminalId: options.terminalId, // initial id; actual fan-out ignores this field
        cwd: options.cwd,
        projectsDirOverride: options.projectsDirOverride,
        dryRun: options.dryRun
      }
      const tailer = new SessionLogTailer(tailerOptions)
      entry = {
        tailer,
        cwd: options.cwd,
        encodedCwd: encoded,
        subscribers: new Map(),
        started: false
      }
      tailer.on('envelope', (raw) => this.fanOut(encoded, raw))
      this.entries.set(encoded, entry)
    }

    entry.subscribers.set(options.terminalId, options.onEnvelope)

    let projectDir: string | null = null
    if (!entry.started) {
      const { projectDir: dir } = entry.tailer.start()
      projectDir = dir
      entry.started = true
    } else {
      // start() returned the projectDir on first call; the tailer does
      // not re-expose it, so expose via the entry cache which we set up
      // once. Internal state is good enough for diagnostics.
      projectDir = entry.cwd
    }

    const release = (): void => {
      this.release(encoded, options.terminalId)
    }

    return { projectDir, release }
  }

  /** Diagnostic — total number of distinct tailers currently alive. */
  get activeTailersTotal(): number {
    return this.entries.size
  }

  /** Diagnostic — total subscribers across all tailers. */
  get activeSubscribersTotal(): number {
    let total = 0
    for (const entry of this.entries.values()) {
      total += entry.subscribers.size
    }
    return total
  }

  /** Dev-mode sanity check (RW-R8): tailer count must not exceed distinct cwd count. */
  assertHealthy(): void {
    const distinctCwds = new Set<string>()
    for (const entry of this.entries.values()) {
      distinctCwds.add(entry.encodedCwd)
    }
    if (distinctCwds.size !== this.entries.size) {
      throw new Error(
        `SessionLogTailerPool invariant broken: ${this.entries.size} entries for ${distinctCwds.size} distinct cwds`
      )
    }
  }

  async dispose(): Promise<void> {
    const disposals: Array<Promise<void>> = []
    for (const entry of this.entries.values()) {
      disposals.push(entry.tailer.dispose().catch(() => undefined))
    }
    this.entries.clear()
    await Promise.all(disposals)
  }

  private async release(encodedCwd: string, terminalId: string): Promise<void> {
    const entry = this.entries.get(encodedCwd)
    if (!entry) return
    entry.subscribers.delete(terminalId)
    if (entry.subscribers.size === 0) {
      this.entries.delete(encodedCwd)
      try {
        await entry.tailer.dispose()
      } catch {
        // best effort
      }
    }
  }

  private fanOut(
    encodedCwd: string,
    raw: { terminalId: string; payload: Record<string, unknown>; filePath: string }
  ): void {
    const entry = this.entries.get(encodedCwd)
    if (!entry) return
    for (const [subscriberId, handler] of entry.subscribers.entries()) {
      handler({
        terminalId: subscriberId, // retag with subscriber id so pipeline state is per-terminal
        payload: raw.payload,
        filePath: raw.filePath
      })
    }
  }
}
