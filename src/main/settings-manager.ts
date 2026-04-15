import Store from 'electron-store'
import type { LlmProviderId, LlmSettingsState } from '../shared/types'
import { LLM_PROVIDER_IDS } from '../shared/types'

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
  notification: {
    enabled: boolean
    sound: boolean
    customPatterns: Array<{ name: string; pattern: string }>
  }
  llm: LlmSettingsState
}

function createDefaultUsage(providerId: LlmProviderId) {
  return {
    providerId,
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: null,
    lastUsedAt: null
  }
}

function createDefaultProviders(): LlmSettingsState['providers'] {
  return {
    gemini: { enabled: true, selectedModel: 'gemini-2.5-flash', apiKeyStored: false, lastModelRefreshAt: null },
    groq: { enabled: false, selectedModel: 'llama-3.3-70b-versatile', apiKeyStored: false, lastModelRefreshAt: null },
    anthropic: { enabled: false, selectedModel: 'claude-3-5-haiku-latest', apiKeyStored: false, lastModelRefreshAt: null },
    openai: { enabled: false, selectedModel: 'gpt-4o-mini', apiKeyStored: false, lastModelRefreshAt: null }
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
  notification: {
    enabled: true,
    sound: true,
    customPatterns: []
  },
  llm: {
    consentEnabled: false,
    selectedProvider: 'gemini',
    fallbackOrder: [...LLM_PROVIDER_IDS],
    providers: createDefaultProviders(),
    usage: {
      gemini: createDefaultUsage('gemini'),
      groq: createDefaultUsage('groq'),
      anthropic: createDefaultUsage('anthropic'),
      openai: createDefaultUsage('openai')
    }
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
