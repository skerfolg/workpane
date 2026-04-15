import { useEffect } from 'react'

export interface KeyboardShortcutsConfig {
  onToggleCommandPalette: () => void
  onSwitchWorkspace: () => void
  onToggleSidebar: () => void
  onToggleTerminal: () => void
  onNewTerminal: () => void
  onSplitVertical: () => void
  onSplitHorizontal: () => void
  onNextTab: () => void
  onCloseTab: () => void
  onOpenSearch: () => void
  onOpenExplorer: () => void
  onSaveFile: () => void
}

export function useKeyboardShortcuts(config: KeyboardShortcutsConfig): void {
  useEffect(() => {
    const {
      onToggleCommandPalette,
      onSwitchWorkspace,
      onToggleSidebar,
      onToggleTerminal,
      onNewTerminal,
      onSplitVertical,
      onSplitHorizontal,
      onNextTab,
      onCloseTab,
      onOpenSearch,
      onOpenExplorer,
      onSaveFile
    } = config

    const handleKeyDown = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey

      // Ctrl+Shift+P — Command Palette
      if (ctrl && shift && e.key === 'P') {
        e.preventDefault()
        onToggleCommandPalette()
        return
      }

      // Ctrl+Shift+W — Switch Workspace
      if (ctrl && shift && e.key === 'W') {
        e.preventDefault()
        onSwitchWorkspace()
        return
      }

      // Ctrl+B — Toggle Sidebar
      if (ctrl && !shift && e.key === 'b') {
        e.preventDefault()
        onToggleSidebar()
        return
      }

      // Ctrl+` — Toggle Terminal panel
      if (ctrl && !shift && e.key === '`') {
        e.preventDefault()
        onToggleTerminal()
        return
      }

      // Ctrl+Shift+T — New Terminal
      if (ctrl && shift && e.key === 'T') {
        e.preventDefault()
        onNewTerminal()
        return
      }

      // Ctrl+Shift+\ — Split focused panel horizontally (top/bottom)
      if (ctrl && shift && e.key === '\\') {
        e.preventDefault()
        onSplitHorizontal()
        return
      }

      // Ctrl+\ — Split focused panel vertically (left/right)
      if (ctrl && !shift && e.key === '\\') {
        e.preventDefault()
        onSplitVertical()
        return
      }

      // Ctrl+Tab — Next Tab
      if (ctrl && !shift && e.key === 'Tab') {
        e.preventDefault()
        onNextTab()
        return
      }

      // Ctrl+W — Close active tab
      if (ctrl && !shift && e.key === 'w') {
        e.preventDefault()
        onCloseTab()
        return
      }

      // Ctrl+Shift+F — Open Search
      if (ctrl && shift && e.key === 'F') {
        e.preventDefault()
        onOpenSearch()
        return
      }

      // Ctrl+E — Open Explorer
      if (ctrl && !shift && e.key === 'e') {
        e.preventDefault()
        onOpenExplorer()
        return
      }

      // Ctrl+S — Save File
      if (ctrl && !shift && e.key === 's') {
        e.preventDefault()
        onSaveFile()
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [config])
}
