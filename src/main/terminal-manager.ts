import * as pty from 'node-pty'
import os from 'os'

export class TerminalManager {
  private terminals: Map<string, pty.IPty> = new Map()
  private cachedShell: string | null = null
  private scrollbackBuffers: Map<string, string[]> = new Map()
  private scrollbackByteCounts: Map<string, number> = new Map()
  private terminalWorkspaces: Map<string, string> = new Map()
  private readonly MAX_BUFFER_BYTES = 1_048_576  // 1MB
  private approvalDetector: import('./approval-detector').ApprovalDetector | null = null

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
    this.approvalDetector?.check(id, data, this.getWorkspace(id) ?? '')
  }

  getScrollback(id: string): string {
    return this.scrollbackBuffers.get(id)?.join('') ?? ''
  }

  getWorkspace(id: string): string | undefined {
    return this.terminalWorkspaces.get(id)
  }

  setApprovalDetector(detector: import('./approval-detector').ApprovalDetector): void {
    this.approvalDetector = detector
  }

  create(id: string, shell?: string, cwd?: string): void {
    const _t = performance.now()
    console.log(`[PERF][Main] TerminalManager.create start id=${id}`)
    if (this.terminals.has(id)) return
    const s = shell || this.getDefaultShell()
    const resolvedCwd = cwd || process.env.HOME || process.env.USERPROFILE || '.'

    // PowerShell ignores node-pty's cwd option; pass -WorkingDirectory explicitly
    const args: string[] = []
    if (resolvedCwd && this.isPowerShell(s)) {
      args.push('-WorkingDirectory', resolvedCwd)
    }

    const term = pty.spawn(s, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: resolvedCwd,
      env: process.env as Record<string, string>
    })
    this.terminals.set(id, term)
    this.terminalWorkspaces.set(id, resolvedCwd)
    console.log(`[PERF][Main] TerminalManager.create done id=${id} shell=${s} ${(performance.now() - _t).toFixed(1)}ms`)
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
    const term = this.terminals.get(id)
    if (term) {
      term.kill()
      this.terminals.delete(id)
    }
    this.scrollbackBuffers.delete(id)
    this.scrollbackByteCounts.delete(id)
    this.terminalWorkspaces.delete(id)
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
  }
}
