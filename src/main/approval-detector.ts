interface ApprovalPattern {
  id: string
  name: string
  regex: RegExp
  builtin: boolean
}

interface ApprovalEvent {
  terminalId: string
  workspacePath: string
  patternName: string
  matchedText: string
  timestamp: number
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-2]|\x1b[>=<]|\x1b\[[\?]?[0-9;]*[hlm]|\x1b\[[0-9]*[ABCDEFGJKST]/g, '')
}

const BUILTIN_PATTERNS: ApprovalPattern[] = [
  { id: 'claude-proceed', name: 'Claude Code: Do you want to proceed?', regex: /Do you want to proceed\?/, builtin: true },
  { id: 'claude-enter', name: 'Claude Code: press Enter to confirm', regex: /press Enter to confirm/i, builtin: true },
  { id: 'claude-yn-upper', name: 'Claude Code: (Y/n)', regex: /\(Y\/n\)/, builtin: true },
  { id: 'claude-yn-lower', name: 'Claude Code: (y/N)', regex: /\(y\/N\)/, builtin: true },
  { id: 'claude-yn-prompt', name: 'Claude Code: ? (y/n)', regex: /\? \(y\/n\)/i, builtin: true },
  { id: 'codex-approve', name: 'Codex: Approve changes?', regex: /Approve changes\?/i, builtin: true },
  { id: 'codex-allow', name: 'Codex: Allow action', regex: /Allow .+ to .+/i, builtin: true },
  { id: 'codex-confirm', name: 'Codex: Confirm action', regex: /Confirm .+ action/i, builtin: true }
]

const SLIDING_WINDOW_MAX_BYTES = 2048
const QUIESCENCE_MS = 300
const DEDUP_WINDOW_MS = 5000

export class ApprovalDetector {
  private onDetected: (event: ApprovalEvent) => void
  private patterns: ApprovalPattern[] = [...BUILTIN_PATTERNS]

  private pendingRaw: Map<string, string> = new Map()
  private quiescenceTimers: Map<string, NodeJS.Timeout> = new Map()
  private slidingWindows: Map<string, string> = new Map()
  private lastEmissions: Map<string, number> = new Map()

  constructor(onDetected: (event: ApprovalEvent) => void) {
    this.onDetected = onDetected
  }

  check(id: string, rawData: string, workspacePath: string): void {
    const pending = (this.pendingRaw.get(id) ?? '') + rawData
    this.pendingRaw.set(id, pending)

    const existing = this.quiescenceTimers.get(id)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      const raw = this.pendingRaw.get(id) ?? ''
      this.pendingRaw.set(id, '')

      const stripped = stripAnsi(raw)
      let window = (this.slidingWindows.get(id) ?? '') + stripped
      const windowBytes = Buffer.byteLength(window)
      if (windowBytes > SLIDING_WINDOW_MAX_BYTES) {
        // Trim from the front to keep within limit
        const excess = windowBytes - SLIDING_WINDOW_MAX_BYTES
        window = window.slice(excess)
      }
      this.slidingWindows.set(id, window)

      const now = Date.now()
      for (const pattern of this.patterns) {
        if (pattern.regex.test(window)) {
          const dedupKey = `${id}:${pattern.id}`
          const lastEmit = this.lastEmissions.get(dedupKey) ?? 0
          if (now - lastEmit < DEDUP_WINDOW_MS) continue

          this.lastEmissions.set(dedupKey, now)
          const match = window.match(pattern.regex)
          this.onDetected({
            terminalId: id,
            workspacePath,
            patternName: pattern.name,
            matchedText: match?.[0] ?? '',
            timestamp: now
          })
        }
      }
    }, QUIESCENCE_MS)

    this.quiescenceTimers.set(id, timer)
  }

  setCustomPatterns(patterns: Array<{ name: string; pattern: string }>): void {
    const custom: ApprovalPattern[] = patterns.map((p, i) => ({
      id: `custom-${i}`,
      name: p.name,
      regex: new RegExp(p.pattern),
      builtin: false
    }))
    this.patterns = [
      ...BUILTIN_PATTERNS,
      ...custom
    ]
  }

  dispose(): void {
    for (const timer of this.quiescenceTimers.values()) {
      clearTimeout(timer)
    }
    this.quiescenceTimers.clear()
    this.pendingRaw.clear()
    this.slidingWindows.clear()
    this.lastEmissions.clear()
  }
}
