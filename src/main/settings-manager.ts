import Store from 'electron-store'

interface SettingsSchema {
  general: {
    language: string
    autoSave: boolean
    autoSaveInterval: number
  }
  appearance: {
    theme: string
  }
  terminal: {
    defaultShell: string
    fontSize: number
    fontFamily: string
  }
  editor: {
    fontSize: number
    wordWrap: boolean
    tabSize: number
  }
  workspace: {
    defaultPath: string
    recentWorkspaces: string[]
  }
  scanning: {
    excludePaths: string[]
  }
  kanban: {
    columns: { id: string; label: string }[]
  }
  notification: {
    enabled: boolean
    sound: boolean
    customPatterns: Array<{ name: string; pattern: string }>
  }
}

const defaults: SettingsSchema = {
  general: {
    language: 'en',
    autoSave: true,
    autoSaveInterval: 30000
  },
  appearance: {
    theme: 'dark'
  },
  terminal: {
    defaultShell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
    fontSize: 14,
    fontFamily: 'monospace'
  },
  editor: {
    fontSize: 14,
    wordWrap: true,
    tabSize: 2
  },
  workspace: {
    defaultPath: '',
    recentWorkspaces: []
  },
  scanning: {
    excludePaths: ['node_modules', '.git', 'dist', 'out', 'build']
  },
  kanban: {
    columns: [
      { id: 'open', label: 'Open' },
      { id: 'in-progress', label: 'In Progress' },
      { id: 'resolved', label: 'Resolved' }
    ]
  },
  notification: {
    enabled: true,
    sound: true,
    customPatterns: []
  }
}

export class SettingsManager {
  private store: Store<SettingsSchema>

  constructor() {
    this.store = new Store<SettingsSchema>({
      defaults
    })
  }

  get(key?: string): unknown {
    if (!key) {
      return this.store.store
    }
    return this.store.get(key as keyof SettingsSchema)
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value)
  }

  addRecentWorkspace(path: string): void {
    const recent = this.getRecentWorkspaces()
    const filtered = recent.filter((p) => p !== path)
    const updated = [path, ...filtered].slice(0, 10)
    this.store.set('workspace.recentWorkspaces', updated)
  }

  getRecentWorkspaces(): string[] {
    return this.store.get('workspace.recentWorkspaces') as string[]
  }
}
