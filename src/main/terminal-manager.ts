import * as pty from 'node-pty'
import os from 'os'

export class TerminalManager {
  private terminals: Map<string, pty.IPty> = new Map()
  private cachedShell: string | null = null

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
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: resolvedCwd,
      env: process.env as Record<string, string>
    })
    this.terminals.set(id, term)
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
  }
}
