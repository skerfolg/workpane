import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import './XTerminal.css'

interface XTerminalProps {
  id: string
  isActive: boolean
}

export function XTerminal({ id, isActive }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

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
      scrollback: 5000
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    const webLinksAddon = new WebLinksAddon((_, url) => {
      const shellApi = (window as any).shell
      if (shellApi?.openExternal) {
        shellApi.openExternal(url)
      }
    })
    term.loadAddon(webLinksAddon)

    term.open(containerRef.current)
    terminalRef.current = term
    fitAddonRef.current = fitAddon
    console.log(`[PERF][Renderer] XTerminal xterm instance create: ${(performance.now() - xtermStart).toFixed(1)}ms`)

    // Wire IPC data listeners (PTY already created by TerminalContext)
    const api = (window as any).terminal
    let removeDataListener: (() => void) | undefined
    let removeExitListener: (() => void) | undefined

    if (api) {
      removeDataListener = api.onData((termId: string, data: string) => {
        if (termId === id) term.write(data)
      })

      removeExitListener = api.onExit((termId: string, exitCode: number) => {
        if (termId === id) {
          term.write(`\r\n\x1b[31mProcess exited with code ${exitCode}\x1b[0m\r\n`)
        }
      })

      term.onData((data: string) => {
        api.write(id, data)
      })

      // Initial fit + resize after a delay for layout to settle
      setTimeout(() => {
        try {
          fitAddon.fit()
          const { cols, rows } = term
          api.resize(id, cols, rows)
        } catch (e) {
          console.error('[XTerminal] fit failed:', e)
        }
      }, 300)
    }

    // Cleanup: only dispose xterm.js view, do NOT kill PTY
    return () => {
      removeDataListener?.()
      removeExitListener?.()
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [id])

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit()
          const { cols, rows } = terminalRef.current
          const api = (window as any).terminal
          if (api) api.resize(id, cols, rows)
        } catch (e) {
          // ignore fit errors during rapid resize
        }
      }
    })

    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [id])

  // Re-fit when becoming active
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      setTimeout(() => fitAddonRef.current?.fit(), 50)
    }
  }, [isActive])

  return (
    <div
      ref={containerRef}
      className="xterm-container"
    />
  )
}
