import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

/**
 * Hook IPC server — Slice 1B (Option A primary path).
 *
 * Listens on a per-WP-session Unix domain socket (macOS/Linux) or named
 * pipe (Windows) and accepts newline-delimited JSON hook payloads from
 * Claude Code's PreToolUse / PostToolUse / Session* hooks.
 *
 * Authentication model (per Plan v3 Slice 1B token spec):
 *   1. 256-bit token generated at WP app launch (crypto.randomBytes(32))
 *   2. Token written to a user-only file (chmod 0o600 on POSIX, default
 *      user-scoped DACL on Windows) at a deterministic path so the hook
 *      script can find it
 *   3. Each connection's first line must be {"auth": "<token>"}
 *   4. Wrong / missing auth → connection dropped, counter bumped
 *
 * Security hardening still deferred to Security-reviewer pass:
 *   - Windows named pipe explicit DACL (node's net.Server does not
 *     expose the security descriptor; current-user default is used)
 *   - Rate-limit backoff on repeated auth failures
 *   - Token rotation on suspicious activity
 *
 * This module is intentionally I/O-only. The adapter (CcHookAdapter)
 * lives separately and stays pure, so the full Option A flow is:
 *   hook-script → hook-server (this) → pipeline.ingest() → CcHookAdapter
 *     → L0Event → pipeline broadcast → DP-2 badge
 */

export interface HookServerEvents {
  payload: [{ terminalId: string; payload: Record<string, unknown> }]
  /** Emitted when a connection fails auth or sends a malformed frame. */
  'auth-failure': [{ reason: string; remoteAddress?: string }]
  /** RW-B/D4/G2: emitted when a frame is dropped by cwd / session_id filter. */
  filtered: [{ reason: 'cwd_mismatch' | 'session_id_mismatch'; payload: Record<string, unknown> }]
  listening: [{ socketPath: string }]
  error: [Error]
}

export interface HookServerOptions {
  /** Terminal id this server instance is bound to. */
  terminalId: string
  /** Override the socket path (tests). */
  socketPath?: string
  /** Override the token file path (tests). */
  tokenFilePath?: string
  /** Override the token (tests only — skips generation). */
  tokenOverride?: string
  /** Maximum frame size per message (bytes). Defaults to 64 KB. */
  maxFrameBytes?: number
  /**
   * RW-B + D4: workspace path this terminal runs in. When set, payloads
   * whose `cwd` field does not match (after normalization) are dropped
   * before reaching listeners. This prevents the CC bridge's broadcast-
   * to-all-sockets behavior from lighting up every terminal on a single
   * hook fire.
   */
  workspacePath?: string
}

const DEFAULT_MAX_FRAME_BYTES = 64 * 1024
const TOKEN_BYTES = 32 // 256-bit

type Emitter = EventEmitter & {
  on<E extends keyof HookServerEvents>(
    event: E,
    listener: (...args: HookServerEvents[E]) => void
  ): Emitter
  emit<E extends keyof HookServerEvents>(event: E, ...args: HookServerEvents[E]): boolean
}

function defaultSocketPath(terminalId: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\workpane-hook-${process.pid}-${terminalId}`
  }
  const runtime = process.env.XDG_RUNTIME_DIR ?? os.tmpdir()
  return path.join(runtime, `workpane-hook-${process.pid}-${terminalId}.sock`)
}

function defaultTokenFilePath(terminalId: string): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA ?? os.tmpdir()
    return path.join(base, 'WorkPane', 'hooks', `.token-${process.pid}-${terminalId}`)
  }
  const runtime = process.env.XDG_RUNTIME_DIR ?? os.tmpdir()
  return path.join(runtime, `workpane-hook-${process.pid}-${terminalId}.token`)
}

export class HookServer {
  private readonly emitter: Emitter = new EventEmitter() as Emitter
  private readonly socketPath: string
  private readonly tokenFilePath: string
  private readonly maxFrameBytes: number
  private readonly token: string
  private readonly terminalId: string
  /** Normalized workspace path for cwd filter. Empty string = no filter. */
  private readonly workspacePathNormalized: string
  private server: net.Server | null = null
  private disposed = false
  private authFailureCount = 0
  /** Session id captured from the first SessionStart payload for this terminal. */
  private capturedSessionId: string | null = null
  /** Counters exposed via diagnostics for RW-R7 / R8. */
  private filteredCwdMismatchCount = 0
  private filteredSessionMismatchCount = 0

  constructor(options: HookServerOptions) {
    this.terminalId = options.terminalId
    this.socketPath = options.socketPath ?? defaultSocketPath(options.terminalId)
    this.tokenFilePath = options.tokenFilePath ?? defaultTokenFilePath(options.terminalId)
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
    this.token = options.tokenOverride ?? crypto.randomBytes(TOKEN_BYTES).toString('hex')
    this.workspacePathNormalized = options.workspacePath
      ? normalizeWorkspacePath(options.workspacePath)
      : ''
  }

  /** Test-only diagnostics. */
  get _filteredCwdCountForTest(): number {
    return this.filteredCwdMismatchCount
  }
  get _filteredSessionCountForTest(): number {
    return this.filteredSessionMismatchCount
  }
  get _capturedSessionIdForTest(): string | null {
    return this.capturedSessionId
  }

  on<E extends keyof HookServerEvents>(event: E, listener: (...args: HookServerEvents[E]) => void): this {
    this.emitter.on(event, listener)
    return this
  }

  off<E extends keyof HookServerEvents>(event: E, listener: (...args: HookServerEvents[E]) => void): this {
    this.emitter.off(event, listener)
    return this
  }

  /**
   * Start listening. Writes the token file with user-only permissions
   * and binds the socket / named pipe. Caller is responsible for
   * instructing the hook script to read the token file.
   */
  async start(): Promise<{ socketPath: string; tokenFilePath: string }> {
    if (this.disposed) {
      throw new Error('HookServer: cannot start after dispose()')
    }
    if (this.server) {
      return { socketPath: this.socketPath, tokenFilePath: this.tokenFilePath }
    }

    this.writeTokenFile()
    await this.cleanupStaleSocket()

    const server = net.createServer((socket) => this.handleConnection(socket))
    this.server = server

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.socketPath, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })

    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(this.socketPath, 0o600)
      } catch {
        // Best effort; on some filesystems chmod is a no-op
      }
    }

    this.emitter.emit('listening', { socketPath: this.socketPath })
    return { socketPath: this.socketPath, tokenFilePath: this.tokenFilePath }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const server = this.server
    this.server = null
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
    await this.cleanupStaleSocket()
    try {
      fs.rmSync(this.tokenFilePath, { force: true })
    } catch {
      // Best effort
    }
  }

  /** Test-only: inspect auth-failure counter. */
  get _authFailureCountForTest(): number {
    return this.authFailureCount
  }

  /** Test-only: read the generated token. */
  get _tokenForTest(): string {
    return this.token
  }

  private writeTokenFile(): void {
    const dir = path.dirname(this.tokenFilePath)
    // mode 0o700 keeps the enclosing directory owner-only so a world-
    // readable umask cannot expose the token file listing
    // (security-reviewer LOW).
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    // Write with mode 0o600 so only the current user can read the token.
    // Windows NTFS honours default DACL (current user + admins + system).
    const fd = fs.openSync(this.tokenFilePath, 'w', 0o600)
    try {
      fs.writeSync(fd, this.token)
    } finally {
      fs.closeSync(fd)
    }
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(this.tokenFilePath, 0o600)
      } catch {
        // Best effort
      }
    }
  }

  private async cleanupStaleSocket(): Promise<void> {
    if (process.platform === 'win32') {
      // Named pipes are not filesystem entries; nothing to clean up.
      return
    }
    try {
      await fs.promises.unlink(this.socketPath)
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code && code !== 'ENOENT') {
        // Swallow and let listen() surface the bind error
      }
    }
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = ''
    let authenticated = false

    socket.setEncoding('utf8')

    const dropWithReason = (reason: string): void => {
      this.authFailureCount += 1
      this.emitter.emit('auth-failure', { reason, remoteAddress: socket.remoteAddress })
      socket.destroy()
    }

    socket.on('data', (chunk: string | Buffer) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (Buffer.byteLength(buffer) > this.maxFrameBytes) {
        dropWithReason('frame-too-large')
        return
      }

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        if (line.length === 0) {
          continue
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          dropWithReason('malformed-json')
          return
        }

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          dropWithReason('non-object-frame')
          return
        }
        const frame = parsed as Record<string, unknown>

        if (!authenticated) {
          if (typeof frame.auth !== 'string' || !this.tokensMatch(frame.auth)) {
            dropWithReason('invalid-token')
            return
          }
          authenticated = true
          continue
        }

        if (!this.passesCorrelationFilter(frame)) {
          // Already counted + emitted via passesCorrelationFilter
          continue
        }

        this.emitter.emit('payload', { terminalId: this.terminalId, payload: frame })
      }
    })

    socket.on('error', (error) => {
      this.emitter.emit('error', error)
    })
  }

  /**
   * D4 / G2: accept the frame only if it was emitted by the CC process
   * running in our terminal's workspace. When no workspacePath is set
   * (e.g. tests, or pre-binding phase) we accept everything, which
   * preserves the previous behavior.
   */
  private passesCorrelationFilter(frame: Record<string, unknown>): boolean {
    if (this.workspacePathNormalized) {
      const frameCwd = typeof frame.cwd === 'string' ? frame.cwd : null
      if (frameCwd != null) {
        const normalized = normalizeWorkspacePath(frameCwd)
        if (normalized !== this.workspacePathNormalized) {
          this.filteredCwdMismatchCount += 1
          this.emitter.emit('filtered', { reason: 'cwd_mismatch', payload: frame })
          return false
        }
      }
    }

    const frameSessionId = typeof frame.session_id === 'string' ? frame.session_id : null
    const hookEvent = typeof frame.hook_event_name === 'string' ? frame.hook_event_name : ''

    if (frameSessionId) {
      if (this.capturedSessionId === null) {
        // Capture only on an explicit SessionStart so a rogue local
        // process that already holds our token cannot race a fake
        // lifecycle event and lock out the real CC binding
        // (security-reviewer MEDIUM 2). Lifecycle messages before the
        // first SessionStart are allowed through because they carry no
        // lock consequence.
        if (hookEvent === 'SessionStart') {
          this.capturedSessionId = frameSessionId
        }
      } else if (this.capturedSessionId !== frameSessionId) {
        // A different session_id arrived while we still have a prior
        // one captured. Drop it outright — the SessionEnd-release case
        // is handled below only for the captured session_id itself.
        this.filteredSessionMismatchCount += 1
        this.emitter.emit('filtered', { reason: 'session_id_mismatch', payload: frame })
        return false
      }

      // Release on SessionEnd of the captured session so a fresh CC
      // session in the same terminal can re-bind. Code-reviewer CRIT:
      // previously this lived inside the `capturedSessionId !== frameSessionId`
      // branch which made it dead code.
      if (hookEvent === 'SessionEnd' && this.capturedSessionId === frameSessionId) {
        this.capturedSessionId = null
      }
    }

    return true
  }

  private tokensMatch(candidate: string): boolean {
    // Constant-time comparison that never branches on length. Token is
    // fixed-width hex so a length mismatch leaks nothing in practice,
    // but padding both sides to a shared length keeps the compare
    // branch-free for defense in depth (security-reviewer MEDIUM).
    const a = Buffer.from(this.token, 'utf8')
    const b = Buffer.from(candidate, 'utf8')
    const maxLen = Math.max(a.length, b.length)
    const aPad = Buffer.alloc(maxLen)
    a.copy(aPad)
    const bPad = Buffer.alloc(maxLen)
    b.copy(bPad)
    // timingSafeEqual is constant-time for equal-length inputs.
    const eqPadded = crypto.timingSafeEqual(aPad, bPad)
    // Final AND with length equality keeps semantics correct without a
    // short-circuit evaluation order that would reintroduce a branch.
    return eqPadded && a.length === b.length
  }
}

/**
 * Normalize a workspace path for cross-platform cwd comparison
 * (RW-R7). On Windows we lowercase because NTFS is case-insensitive
 * (so CC might report `C:\Foo` while WP cached `C:\foo`); on POSIX we
 * preserve case. Trailing slashes are stripped on both.
 */
function normalizeWorkspacePath(p: string): string {
  const resolved = path.resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
