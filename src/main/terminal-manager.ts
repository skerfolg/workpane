import * as pty from 'node-pty'
import os from 'os'
import { spawnSync } from 'child_process'
import { isL0Vendor, type L0Status, type L0Vendor } from '../shared/types'

const SHELL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

function resolveWindowsExecutable(name: string): { cmd: string; prefix: readonly string[] } {
  if (name.includes('\\') || name.includes('/')) {
    return { cmd: name, prefix: [] }
  }
  if (os.platform() !== 'win32') {
    return { cmd: name, prefix: [] }
  }
  if (!SHELL_NAME_PATTERN.test(name)) {
    return { cmd: name, prefix: [] }
  }
  const result = spawnSync('where', [name], { encoding: 'utf8', timeout: 3000, shell: false })
  if (result.status !== 0 || !result.stdout) {
    return { cmd: name, prefix: [] }
  }
  const candidates = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const exe = candidates.find((p) => p.toLowerCase().endsWith('.exe'))
  if (exe) return { cmd: exe, prefix: [] }
  const cmdScript = candidates.find((p) => {
    const lower = p.toLowerCase()
    return lower.endsWith('.cmd') || lower.endsWith('.bat')
  })
  if (cmdScript) {
    return { cmd: 'cmd.exe', prefix: ['/d', '/s', '/c', cmdScript] }
  }
  return { cmd: candidates[0] ?? name, prefix: [] }
}

export interface TerminalCreateOptions {
  shell?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  vendorHint?: L0Vendor
  spawnArgs?: string[]
}

const MAX_SPAWN_ARGS = 8
const ALLOWED_SPAWN_ARG_PATTERN = /^[A-Za-z0-9_.:/@=-]{1,256}$/
const BLOCKED_SPAWN_ARG_FLAGS = new Set([
  '-c',
  '-command',
  '-encodedcommand',
  '--command',
  '--encodedcommand',
  '--init-file',
  '--rcfile',
  '-i',
  '-exec',
  '-e'
])

function sanitizeSpawnArgs(args: string[] | undefined): string[] | undefined {
  if (!args || args.length === 0) {
    return undefined
  }
  if (args.length > MAX_SPAWN_ARGS) {
    throw new Error(`spawnArgs exceeds ${MAX_SPAWN_ARGS} entries`)
  }
  const validated: string[] = []
  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new Error('spawnArgs entries must be strings')
    }
    if (!ALLOWED_SPAWN_ARG_PATTERN.test(arg)) {
      throw new Error(`spawnArgs entry rejected by allowlist: ${arg}`)
    }
    if (BLOCKED_SPAWN_ARG_FLAGS.has(arg.toLowerCase())) {
      throw new Error(`spawnArgs entry is a blocked shell flag: ${arg}`)
    }
    validated.push(arg)
  }
  return validated
}

function sanitizeVendorHint(vendorHint: unknown): L0Vendor | undefined {
  if (vendorHint === undefined) {
    return undefined
  }
  return isL0Vendor(vendorHint) ? vendorHint : undefined
}

export class TerminalManager {
  private terminals: Map<string, pty.IPty> = new Map()
  private cachedShell: string | null = null
  private scrollbackBuffers: Map<string, string[]> = new Map()
  private scrollbackByteCounts: Map<string, number> = new Map()
  private terminalWorkspaces: Map<string, string> = new Map()
  private terminalVendorHints: Map<string, L0Vendor> = new Map()
  private readonly MAX_BUFFER_BYTES = 524_288  // 512KB
  // Slice 2.6 — vendor auto-detect from stdout banner. The renderer doesn't
  // pass vendorHint when creating terminals, so claude-code terminals would
  // never trigger onClaudeBind without this fallback. Caps out after the
  // first ~4KB of output (CC banner is in first ~200 bytes after spawn).
  private vendorAutoDetectBuffer: Map<string, string> = new Map()
  private vendorAutoDetected: Set<string> = new Set()
  private readonly VENDOR_AUTO_DETECT_BUFFER_CAP = 4096
  private terminalDisposables: Map<string, Array<{ dispose: () => void }>> = new Map()
  private approvalDetector: import('./approval-detector').ApprovalDetector | null = null
  private l0Pipeline: import('./l0/pipeline').L0Pipeline | null = null
  private l0RuntimeHooks: {
    onClaudeBind: (args: { terminalId: string; workspacePath: string }) => Promise<void> | void
    onTerminalClose: (terminalId: string) => Promise<void> | void
  } | null = null

  getDefaultShell(): string {
    if (this.cachedShell) return this.cachedShell
    if (os.platform() === 'win32') {
      // Prefer PowerShell 7 (pwsh) over legacy Windows PowerShell
      const pwshPaths = [
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe'
      ]
      for (const p of pwshPaths) {
        try {
          require('fs').accessSync(p)
          this.cachedShell = p
          return p
        } catch {
          // not found, try next
        }
      }
      // Fallback: try pwsh in PATH, then legacy powershell
      this.cachedShell = 'pwsh.exe'
      return this.cachedShell
    }
    this.cachedShell = process.env.SHELL || (os.platform() === 'darwin' ? 'zsh' : 'bash')
    return this.cachedShell
  }

  appendToBuffer(id: string, data: string): void {
    let buf = this.scrollbackBuffers.get(id)
    if (!buf) {
      buf = []
      this.scrollbackBuffers.set(id, buf)
    }
    let byteCount = this.scrollbackByteCounts.get(id) ?? 0
    buf.push(data)
    byteCount += Buffer.byteLength(data)
    while (byteCount > this.MAX_BUFFER_BYTES && buf.length > 0) {
      const removed = buf.shift()!
      byteCount -= Buffer.byteLength(removed)
    }
    this.scrollbackByteCounts.set(id, byteCount)
    // Slice 2.6 — auto-detect Claude Code vendor from stdout banner before
    // the L0 pipeline ingest, so a banner that lands on the first PTY tick
    // still triggers HookServer + tailer-pool wire-up via onClaudeBind.
    this.tryAutoDetectClaudeVendor(id, data)
    const suppressApprovalDetector =
      this.l0Pipeline?.ingest(id, data, this.getWorkspace(id) ?? '')?.suppressApprovalDetector ?? false
    if (!suppressApprovalDetector) {
      this.approvalDetector?.check(id, data, this.getWorkspace(id) ?? '')
    }
  }

  /**
   * Slice 2.6 — Claude Code emits a stable boot banner on first activation:
   *
   *     Claude Code v2.1.119
   *     Opus 4.7 (1M context) · Claude Max
   *     <cwd>
   *
   * If the renderer didn't pass vendorHint='claude-code' (the current
   * default — no UI surfaces explicit vendor selection), we still want
   * the L0 runtime to wire up. Strip ANSI from the first ~4KB and match
   * the version line; on hit, set the vendor + fire onClaudeBind exactly
   * once. After the cap or after a hit, all further data for this
   * terminal is skipped — this is on the hot path.
   */
  private tryAutoDetectClaudeVendor(id: string, data: string): void {
    if (this.terminalVendorHints.has(id)) return
    if (this.vendorAutoDetected.has(id)) return

    const prior = this.vendorAutoDetectBuffer.get(id) ?? ''
    const next = prior + data
    if (next.length > this.VENDOR_AUTO_DETECT_BUFFER_CAP) {
      // Give up — banner should appear in the first PTY tick or two.
      this.vendorAutoDetectBuffer.delete(id)
      this.vendorAutoDetected.add(id)
      return
    }
    this.vendorAutoDetectBuffer.set(id, next)

    // Strip CSI / OSC ANSI escape sequences before pattern match. CC's
    // banner uses bold/color codes that would otherwise split the literal.
    // eslint-disable-next-line no-control-regex
    const stripped = next.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
    if (!/Claude Code v\d+\.\d+\.\d+/.test(stripped)) return

    // Hit — wire up as if vendorHint had been provided at spawn time.
    const cwd = this.getWorkspace(id) ?? ''
    this.terminalVendorHints.set(id, 'claude-code')
    this.vendorAutoDetectBuffer.delete(id)
    this.vendorAutoDetected.add(id)
    this.l0Pipeline?.bindVendor(id, 'claude-code')
    if (this.l0RuntimeHooks) {
      void Promise.resolve(
        this.l0RuntimeHooks.onClaudeBind({ terminalId: id, workspacePath: cwd })
      ).catch((error) => {
        console.warn(`[l0-runtime] onClaudeBind (auto-detected) failed for ${id}:`, error)
      })
    }
  }

  getScrollback(id: string): string {
    const buf = this.scrollbackBuffers.get(id)
    if (!buf || buf.length === 0) return ''

    // Fast path: if total bytes under limit, join directly
    const byteCount = this.scrollbackByteCounts.get(id) ?? 0
    const MAX_RETURN = 262_144  // 256KB
    if (byteCount <= MAX_RETURN) return buf.join('')

    // Slow path: return last 256KB
    const result: string[] = []
    let bytes = 0
    for (let i = buf.length - 1; i >= 0 && bytes < MAX_RETURN; i--) {
      result.unshift(buf[i])
      bytes += Buffer.byteLength(buf[i])
    }
    return result.join('')
  }

  addDisposable(id: string, disposable: { dispose: () => void }): void {
    let list = this.terminalDisposables.get(id)
    if (!list) {
      list = []
      this.terminalDisposables.set(id, list)
    }
    list.push(disposable)
  }

  getWorkspace(id: string): string | undefined {
    return this.terminalWorkspaces.get(id)
  }

  setApprovalDetector(detector: import('./approval-detector').ApprovalDetector): void {
    this.approvalDetector = detector
  }

  setL0Pipeline(pipeline: import('./l0/pipeline').L0Pipeline): void {
    this.l0Pipeline = pipeline
  }

  /**
   * RW-B: injected by main/index.ts to start HookServer + tailer-pool
   * subscription whenever a terminal is marked as 'claude-code' vendor
   * and binds its cwd. Optional so unit tests that only wire a
   * TerminalManager do not need the L0 runtime plumbing.
   */
  setL0RuntimeHooks(hooks: {
    onClaudeBind: (args: {
      terminalId: string
      workspacePath: string
    }) => Promise<void> | void
    onTerminalClose: (terminalId: string) => Promise<void> | void
  }): void {
    this.l0RuntimeHooks = hooks
  }

  private buildSpawnEnv(env?: NodeJS.ProcessEnv): Record<string, string> {
    return Object.fromEntries(
      Object.entries(env ?? (process.env as NodeJS.ProcessEnv))
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  }

  create(id: string, options: TerminalCreateOptions = {}): void {
    const _t = performance.now()
    console.log(`[PERF][Main] TerminalManager.create start id=${id}`)
    if (this.terminals.has(id)) return
    const requestedShell = options.shell || this.getDefaultShell()
    const { cmd: resolvedShell, prefix: shellPrefix } = resolveWindowsExecutable(requestedShell)
    const resolvedCwd = options.cwd || process.env.HOME || process.env.USERPROFILE || '.'

    const sanitizedSpawnArgs = sanitizeSpawnArgs(options.spawnArgs)
    const sanitizedVendorHint = sanitizeVendorHint(options.vendorHint)

    const args: string[] = [...shellPrefix]
    // PowerShell ignores node-pty's cwd option; pass -WorkingDirectory explicitly
    if (resolvedCwd && this.isPowerShell(resolvedShell)) {
      args.push('-WorkingDirectory', resolvedCwd)
    }
    if (sanitizedSpawnArgs) {
      args.push(...sanitizedSpawnArgs)
    }

    if (sanitizedVendorHint) {
      this.terminalVendorHints.set(id, sanitizedVendorHint)
      // Bind BEFORE spawn so any L0 chunks emitted on the very first PTY
      // tick are recognized by the pipeline (Code-reviewer HIGH-2 race fix).
      this.l0Pipeline?.bindVendor(id, sanitizedVendorHint)
      // RW-B: claude-code terminals also bring up a per-terminal
      // HookServer + join the session-log tailer pool. main/index.ts
      // wires the actual components via setL0RuntimeHooks; we just
      // trigger the callback here.
      if (sanitizedVendorHint === 'claude-code' && this.l0RuntimeHooks) {
        void Promise.resolve(
          this.l0RuntimeHooks.onClaudeBind({ terminalId: id, workspacePath: resolvedCwd })
        ).catch((error) => {
          console.warn(`[l0-runtime] onClaudeBind failed for ${id}:`, error)
        })
      }
    }

    const term = pty.spawn(resolvedShell, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: resolvedCwd,
      env: this.buildSpawnEnv(options.env)
    })
    this.terminals.set(id, term)
    this.terminalWorkspaces.set(id, resolvedCwd)
    console.log(`[PERF][Main] TerminalManager.create done id=${id} requested=${requestedShell} resolved=${resolvedShell} ${(performance.now() - _t).toFixed(1)}ms`)
  }

  getVendorHint(id: string): L0Vendor | undefined {
    return this.terminalVendorHints.get(id)
  }

  getL0Status(id: string): L0Status {
    return this.l0Pipeline?.getStatus(id) ?? { terminalId: id, mode: 'inactive' }
  }

  private isPowerShell(shell: string): boolean {
    const lower = shell.toLowerCase()
    return lower.includes('pwsh') || lower.includes('powershell')
  }

  write(id: string, data: string): void {
    this.terminals.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.terminals.get(id)?.resize(cols, rows)
  }

  kill(id: string): void {
    // Dispose listeners first to prevent callbacks during shutdown
    const disposables = this.terminalDisposables.get(id)
    if (disposables) {
      for (const d of disposables) {
        try { d.dispose() } catch { /* ignore */ }
      }
      this.terminalDisposables.delete(id)
    }
    const term = this.terminals.get(id)
    if (term) {
      term.kill()
      this.terminals.delete(id)
    }
    this.scrollbackBuffers.delete(id)
    this.scrollbackByteCounts.delete(id)
    this.terminalWorkspaces.delete(id)
    const priorVendor = this.terminalVendorHints.get(id)
    this.terminalVendorHints.delete(id)
    // Slice 2.6 — release the auto-detect tracking maps so a recycled id
    // (which can happen across reload cycles in dev) starts clean.
    this.vendorAutoDetectBuffer.delete(id)
    this.vendorAutoDetected.delete(id)
    this.l0Pipeline?.reset(id)
    // RW-B: inform main-process L0 runtime so HookServer is disposed
    // and the tailer-pool reference is released. We fire this even for
    // non-claude-code terminals because the runtime may own other
    // per-terminal state (telemetry, dedup buffers) that deserves
    // cleanup. Errors are swallowed — kill must always succeed.
    if (priorVendor === 'claude-code' && this.l0RuntimeHooks) {
      void Promise.resolve(this.l0RuntimeHooks.onTerminalClose(id)).catch((error) => {
        console.warn(`[l0-runtime] onTerminalClose failed for ${id}:`, error)
      })
    }
  }

  get(id: string): pty.IPty | undefined {
    return this.terminals.get(id)
  }

  getAll(): string[] {
    return Array.from(this.terminals.keys())
  }

  dispose(): void {
    for (const [id] of this.terminals) {
      this.kill(id)
    }
    this.scrollbackBuffers.clear()
    this.scrollbackByteCounts.clear()
    this.terminalWorkspaces.clear()
    this.terminalVendorHints.clear()
    this.terminalDisposables.clear()
    this.l0Pipeline?.dispose()
  }
}
