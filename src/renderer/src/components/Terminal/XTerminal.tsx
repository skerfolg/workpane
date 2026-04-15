import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal, ILinkProvider, ILink, IBufferRange } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import './XTerminal.css'

interface XTerminalProps {
  id: string
  isActive: boolean
  onOpenFile?: (filePath: string) => void
}

// File extensions recognized as linkable source files
const FILE_EXT = '(?:tsx?|jsx?|json|md|css|scss|less|html|ya?ml|toml|py|go|rs|c|cpp|h|hpp|java|rb|sh|bat|ps1|vue|svelte|astro|prisma|sql|graphql|proto|xml|ini|cfg|conf|env|lock|log|txt)'

// Match file paths with optional :line or :line:col
// Handles: src/foo.ts, ./foo.ts, ../foo.ts, D:\foo.ts, /abs/path.ts, (src/foo.ts:10:5)
const FILE_PATH_RE = new RegExp(
  `(?:^|[\\s('"=])` +                      // preceded by whitespace, paren, quote, or start
  `(` +
    `(?:[A-Za-z]:[/\\\\]|\\./|\\.\\./)` +  // absolute (C:/ or C:\) or relative (./ or ../)
    `[\\w./@\\\\-]+\\.${FILE_EXT}` +        // path segments + extension
  `|` +
    `(?:[\\w@][\\w./@\\\\-]*/)` +           // relative without ./ (src/foo/)
    `[\\w.-]+\\.${FILE_EXT}` +              // filename + extension
  `)` +
  `(?::(\\d+)(?::(\\d+))?)?`,               // optional :line:col
  'g'
)

interface TerminalContextMenu {
  x: number
  y: number
  hasSelection: boolean
}

const clipboardApi = (window as any).clipboard as {
  readText: () => string
  writeText: (text: string) => void
} | undefined

// App-level shortcuts that must bypass xterm and propagate to document handlers
function isAppShortcut(e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || e.metaKey
  const shift = e.shiftKey
  if (!ctrl) return false

  // Ctrl+Shift combos: P (palette), T (new terminal), W (switch workspace),
  // F (search), K (kanban), \ (split horizontal)
  // Note: C (copy) and V (paste) are handled directly in attachCustomKeyEventHandler
  if (shift && (
    e.key === 'P' || e.key === 'T' || e.key === 'W' ||
    e.key === 'F' || e.key === 'K' || e.key === '\\'
  )) return true

  // Ctrl combos: ` (toggle terminal), \ (split vertical), B (sidebar),
  // E (explorer), S (save), W (close tab), Tab (next tab)
  if (!shift && (
    e.key === '`' || e.key === '\\' || e.key === 'b' ||
    e.key === 'e' || e.key === 's' || e.key === 'w' || e.key === 'Tab'
  )) return true

  return false
}

// Create a file path link provider for Ctrl+click navigation
function createFilePathLinkProvider(
  terminal: Terminal,
  onOpenFile: (filePath: string) => void,
  getWorkspacePath: () => string | null
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) { callback(undefined); return }

      const lineText = line.translateToString(true)
      const links: ILink[] = []

      FILE_PATH_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = FILE_PATH_RE.exec(lineText)) !== null) {
        const filePath = match[1]
        const fullMatch = match[0]
        const pathStart = match.index + fullMatch.indexOf(filePath)
        const colonSuffix = (match[2] ? `:${match[2]}` : '') + (match[3] ? `:${match[3]}` : '')

        const range: IBufferRange = {
          start: { x: pathStart + 1, y: bufferLineNumber },
          end: { x: pathStart + filePath.length + colonSuffix.length, y: bufferLineNumber }
        }

        links.push({
          range,
          text: filePath + colonSuffix,
          decorations: { pointerCursor: true, underline: true },
          activate(event: MouseEvent, text: string): void {
            if (!event.ctrlKey && !event.metaKey) return
            // Strip :line:col from path for file opening
            const pathOnly = text.replace(/:\d+(?::\d+)?$/, '')
            const wsPath = getWorkspacePath()
            let resolved = pathOnly

            if (wsPath && !pathOnly.match(/^[A-Za-z]:[/\\]/) && !pathOnly.startsWith('/')) {
              const normalWs = wsPath.replace(/\\/g, '/')
              const normalPath = pathOnly.replace(/\\/g, '/')
              const wsBasename = normalWs.split('/').pop() ?? ''

              // Avoid path doubling: if the relative path contains the workspace
              // basename as a directory segment, strip everything up to it.
              // e.g. "Workspace/EoBeamAnalyzer/.omc/foo.md" → ".omc/foo.md"
              const segments = normalPath.split('/')
              const wsIdx = wsBasename ? segments.indexOf(wsBasename) : -1
              if (wsIdx >= 0 && wsIdx < 3) {
                resolved = normalWs + '/' + segments.slice(wsIdx + 1).join('/')
              } else {
                resolved = normalWs + '/' + normalPath
              }
            }
            onOpenFile(resolved)
          }
        })
      }

      callback(links.length > 0 ? links : undefined)
    }
  }
}

export function XTerminal({ id, isActive, onOpenFile }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<WebglAddon | null>(null)
  const [contextMenu, setContextMenu] = useState<TerminalContextMenu | null>(null)

  const handleCopy = useCallback(() => {
    const term = terminalRef.current
    if (!term || !clipboardApi) return
    const selection = term.getSelection()
    if (selection) {
      clipboardApi.writeText(selection)
      term.clearSelection()
    }
  }, [])

  const handlePaste = useCallback(() => {
    if (!clipboardApi) return
    const text = clipboardApi.readText()
    if (text) {
      const api = (window as any).terminal
      if (api) api.write(id, text)
    }
  }, [id])

  // Main effect: create xterm.js view and wire IPC data listeners
  // PTY lifecycle is managed by TerminalContext, NOT here
  useEffect(() => {
    if (!containerRef.current) return

    const xtermStart = performance.now()
    const styles = getComputedStyle(document.documentElement)
    const bgColor = styles.getPropertyValue('--color-terminal-bg').trim() || '#13141e'
    const fgColor = styles.getPropertyValue('--text-1').trim() || '#c8cad8'
    const accentColor = styles.getPropertyValue('--accent').trim() || '#4c9eff'

    const term = new Terminal({
      theme: {
        background: bgColor,
        foreground: fgColor,
        cursor: fgColor,
        cursorAccent: bgColor,
        selectionBackground: accentColor + '40'
      },
      fontSize: 14,
      fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
      cursorBlink: true,
      scrollback: 3000,
      rightClickSelectsWord: true
    })

    // Intercept keys: return false to let event propagate to DOM, true to let xterm handle
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true

      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey

      // Ctrl+C or Ctrl+Shift+C — copy if selection exists, otherwise send SIGINT
      if (ctrl && (e.key === 'c' || e.key === 'C')) {
        if (term.hasSelection()) {
          e.preventDefault()
          handleCopy()
          return false
        }
        // No selection: let Ctrl+C pass to xterm as SIGINT (only without shift)
        return !shift
      }

      // Ctrl+V or Ctrl+Shift+V — paste from clipboard
      if (ctrl && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault()
        handlePaste()
        return false
      }

      // All other app-level shortcuts bypass xterm
      if (isAppShortcut(e)) return false

      return true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    const webLinksAddon = new WebLinksAddon((event, url) => {
      if (!event.ctrlKey && !event.metaKey) return
      const shellApi = (window as any).shell
      if (shellApi?.openExternal) {
        shellApi.openExternal(url)
      }
    })
    term.loadAddon(webLinksAddon)

    // File path link provider — Ctrl+click opens file in editor
    if (onOpenFile) {
      const wsApi = (window as any).workspace
      let cachedWsPath: string | null = null
      wsApi?.getCurrent?.()
        .then((ws: { path: string } | null) => { cachedWsPath = ws?.path ?? null })
        .catch(() => {})
      wsApi?.onChanged?.((info: { path: string } | null) => { cachedWsPath = info?.path ?? null })

      term.registerLinkProvider(
        createFilePathLinkProvider(term, onOpenFile, () => cachedWsPath)
      )
    }

    term.open(containerRef.current)

    // Load WebGL renderer with context-loss recovery
    const loadWebgl = (): void => {
      try {
        // Dispose previous addon if any
        webglAddonRef.current?.dispose()
        webglAddonRef.current = null

        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          console.warn('[XTerminal] WebGL context lost, falling back to DOM renderer')
          webglAddon.dispose()
          webglAddonRef.current = null
          // Force DOM renderer refresh
          term.refresh(0, term.rows - 1)
          // Try to reload WebGL after a short delay
          setTimeout(() => {
            if (terminalRef.current === term) loadWebgl()
          }, 1000)
        })
        term.loadAddon(webglAddon)
        webglAddonRef.current = webglAddon
      } catch (e) {
        console.warn('[XTerminal] WebGL addon failed, using DOM renderer:', e)
        webglAddonRef.current = null
      }
    }
    loadWebgl()

    terminalRef.current = term
    fitAddonRef.current = fitAddon
    console.log(`[PERF][Renderer] XTerminal xterm instance create: ${(performance.now() - xtermStart).toFixed(1)}ms`)

    // Wire IPC data listeners (PTY already created by TerminalContext)
    const api = (window as any).terminal
    let removeDataListener: (() => void) | undefined
    let removeExitListener: (() => void) | undefined
    let removeTestOpenListener: (() => void) | undefined

    if (api) {
      // Phase 1: Wire onData into QUEUE first — captures data arriving during async IPC roundtrip
      const queue: string[] = []
      let directMode = false
      removeDataListener = api.onData((termId: string, data: string) => {
        if (termId !== id) return
        if (directMode) {
          term.write(data)
        } else {
          queue.push(data)
        }
      }, id)

      removeExitListener = api.onExit((termId: string, exitCode: number) => {
        if (termId === id) {
          term.write(`\r\n\x1b[31mProcess exited with code ${exitCode}\x1b[0m\r\n`)
        }
      })

      term.onData((data: string) => {
        api.write(id, data)
      })

      // Phase 2: Fetch scrollback, flush queue, then switch to direct passthrough
      api.getScrollback(id).then((scrollback: string) => {
        if (scrollback) term.write(scrollback)
        // Phase 3: Flush data that arrived during the IPC roundtrip
        for (const chunk of queue) {
          term.write(chunk)
        }
        queue.length = 0
        // Phase 4: Switch to direct passthrough
        directMode = true
      }).catch(() => {
        // Scrollback unavailable — flush queue and switch to direct passthrough
        for (const chunk of queue) {
          term.write(chunk)
        }
        queue.length = 0
        directMode = true
      })

      // Initial fit + resize: use rAF to wait for first layout pass
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            fitAddon.fit()
            const { cols, rows } = term
            api.resize(id, cols, rows)
          } catch (e) {
            console.error('[XTerminal] fit failed:', e)
          }
        })
      })
    }

    // Electron e2e uses a synthetic terminal-originated open hook because xterm link clicks
    // are not stable enough across renderers to serve as deterministic test evidence.
    if (onOpenFile) {
      removeTestOpenListener = api?.onTestOpenFile?.(id, onOpenFile)
    }

    // Cleanup: only dispose xterm.js view, do NOT kill PTY
    return () => {
      removeDataListener?.()
      removeExitListener?.()
      removeTestOpenListener?.()
      webglAddonRef.current?.dispose()
      webglAddonRef.current = null
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [id, handleCopy, handlePaste])

  // Handle resize — debounced via rAF to avoid layout thrashing
  useEffect(() => {
    if (!containerRef.current) return

    let rafId: number | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (fitAddonRef.current && terminalRef.current) {
          try {
            fitAddonRef.current.fit()
            const { cols, rows } = terminalRef.current
            const api = (window as any).terminal
            if (api) api.resize(id, cols, rows)
          } catch {
            // ignore fit errors during rapid resize
          }
        }
      })
    })

    resizeObserver.observe(containerRef.current)
    return () => {
      resizeObserver.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [id])

  // Re-fit and refresh when becoming active (fixes WebGL canvas after tab switch / HMR)
  // With visibility:hidden strategy, layout dimensions are preserved so a single rAF suffices.
  useEffect(() => {
    if (!isActive || !fitAddonRef.current || !terminalRef.current) return

    const term = terminalRef.current
    const fitAddon = fitAddonRef.current

    const rafId = requestAnimationFrame(() => {
      try {
        fitAddon.fit()
      } catch { /* ignore */ }

      // Clear texture atlas to force glyph re-render without destroying GL context
      if (webglAddonRef.current) {
        try {
          (webglAddonRef.current as any).clearTextureAtlas()
        } catch { /* ignore — API may not be available */ }
      }

      term.refresh(0, term.rows - 1)

      // Sync PTY dimensions after fit
      const api = (window as any).terminal
      if (api) api.resize(id, term.cols, term.rows)
    })

    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [isActive, id])

  // Right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const hasSelection = !!terminalRef.current?.getSelection()
    setContextMenu({ x: e.clientX, y: e.clientY, hasSelection })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    terminalRef.current?.focus()
  }, [])

  const handleContextCopy = useCallback(() => {
    handleCopy()
    closeContextMenu()
  }, [handleCopy, closeContextMenu])

  const handleContextPaste = useCallback(() => {
    handlePaste()
    closeContextMenu()
  }, [handlePaste, closeContextMenu])

  const handleContextSelectAll = useCallback(() => {
    terminalRef.current?.selectAll()
    closeContextMenu()
  }, [closeContextMenu])

  const handleContextClear = useCallback(() => {
    terminalRef.current?.clear()
    closeContextMenu()
  }, [closeContextMenu])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  return (
    <div
      ref={containerRef}
      className="xterm-container"
      onContextMenu={handleContextMenu}
    >
      {contextMenu && (
        <div
          className="xterm-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="xterm-context-menu__item"
            disabled={!contextMenu.hasSelection}
            onClick={handleContextCopy}
          >
            <span>Copy</span>
            <span className="xterm-context-menu__shortcut">Ctrl+Shift+C</span>
          </button>
          <button
            className="xterm-context-menu__item"
            onClick={handleContextPaste}
          >
            <span>Paste</span>
            <span className="xterm-context-menu__shortcut">Ctrl+Shift+V</span>
          </button>
          <div className="xterm-context-menu__divider" />
          <button
            className="xterm-context-menu__item"
            onClick={handleContextSelectAll}
          >
            <span>Select All</span>
          </button>
          <button
            className="xterm-context-menu__item"
            onClick={handleContextClear}
          >
            <span>Clear</span>
          </button>
        </div>
      )}
    </div>
  )
}
