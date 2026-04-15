import test from 'node:test'
import assert from 'node:assert/strict'
import type {
  LlmClassificationResult,
  LlmModelSummary,
  LlmProviderId,
  LlmRuntimeInput,
  LlmSettingsState,
  LlmStorageStatus
} from '../../src/shared/types'

type SettingsLike = {
  state: LlmSettingsState
  get: (key?: string) => unknown
  set: (key: string, value: unknown) => void
}

type FakeCredentialStore = {
  credentials: Partial<Record<LlmProviderId, string>>
  storageStatus: LlmStorageStatus
  getStorageStatus: () => LlmStorageStatus
  getCredential: (providerId: LlmProviderId) => Promise<string | null>
  hasCredential: (providerId: LlmProviderId) => Promise<boolean>
  setCredential: (providerId: LlmProviderId, apiKey: string) => Promise<void>
  clearCredential: (providerId: LlmProviderId) => Promise<void>
}

type FakeProviderAdapter = {
  listModels: (apiKey: string) => Promise<LlmModelSummary[]>
  classifyCause: (
    apiKey: string,
    modelId: string,
    recentOutput: string
  ) => Promise<{ result: LlmClassificationResult; inputTokens: number; outputTokens: number }>
}

function createSettingsState(): LlmSettingsState {
  return {
    consentEnabled: false,
    selectedProvider: 'gemini',
    fallbackOrder: ['gemini', 'groq', 'anthropic', 'openai'],
    providers: {
      gemini: {
        enabled: true,
        selectedModel: 'gemini-2.5-flash',
        apiKeyStored: false,
        lastModelRefreshAt: null
      },
      groq: {
        enabled: true,
        selectedModel: 'llama-3.3-70b-versatile',
        apiKeyStored: false,
        lastModelRefreshAt: null
      },
      anthropic: {
        enabled: false,
        selectedModel: 'claude-3-5-haiku-latest',
        apiKeyStored: false,
        lastModelRefreshAt: null
      },
      openai: {
        enabled: true,
        selectedModel: 'gpt-4o-mini',
        apiKeyStored: false,
        lastModelRefreshAt: null
      }
    },
    usage: {
      gemini: {
        providerId: 'gemini',
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: null,
        lastUsedAt: null
      },
      groq: {
        providerId: 'groq',
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: null,
        lastUsedAt: null
      },
      anthropic: {
        providerId: 'anthropic',
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: null,
        lastUsedAt: null
      },
      openai: {
        providerId: 'openai',
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: null,
        lastUsedAt: null
      }
    }
  }
}

function createSettingsManager(initialState = createSettingsState()): SettingsLike {
  const settings: SettingsLike = {
    state: structuredClone(initialState),
    get(key?: string): unknown {
      if (!key || key === 'llm') {
        return this.state
      }
      throw new Error(`Unsupported settings get key: ${String(key)}`)
    },
    set(key: string, value: unknown): void {
      if (key !== 'llm') {
        throw new Error(`Unsupported settings set key: ${key}`)
      }
      this.state = structuredClone(value as LlmSettingsState)
    }
  }

  return settings
}

function createCredentialStore(
  credentials: Partial<Record<LlmProviderId, string>> = {}
): FakeCredentialStore {
  return {
    credentials: { ...credentials },
    storageStatus: {
      available: true,
      backend: 'dpapi',
      degraded: false,
      detail: 'unit-test'
    },
    getStorageStatus() {
      return this.storageStatus
    },
    async getCredential(providerId) {
      return this.credentials[providerId] ?? null
    },
    async hasCredential(providerId) {
      return Boolean(this.credentials[providerId])
    },
    async setCredential(providerId, apiKey) {
      this.credentials[providerId] = apiKey
    },
    async clearCredential(providerId) {
      delete this.credentials[providerId]
    }
  }
}

function createInput(overrides: Partial<LlmRuntimeInput> = {}): LlmRuntimeInput {
  return {
    terminalId: 'terminal-1',
    workspacePath: 'D:/workspace/demo',
    patternName: 'Approve changes?',
    matchedText: 'Approve changes?',
    recentOutput: [
      'line 1',
      'line 2',
      'Please review the patch.',
      'Approve changes?'
    ].join('\n'),
    ...overrides
  }
}

const providerAdapterModule = require('../../src/main/llm/provider-adapters') as {
  getProviderAdapter: (providerId: LlmProviderId) => FakeProviderAdapter
}
const credentialStoreModule = require('../../src/main/llm/credential-store') as {
  LlmCredentialStore: new () => FakeCredentialStore
}

const originalGetProviderAdapter = providerAdapterModule.getProviderAdapter
const originalCredentialStoreCtor = credentialStoreModule.LlmCredentialStore

let currentCredentialStore: FakeCredentialStore | null = null
let currentAdapters: Partial<Record<LlmProviderId, FakeProviderAdapter>> = {}

credentialStoreModule.LlmCredentialStore = function TestCredentialStoreFactory() {
  if (!currentCredentialStore) {
    throw new Error('Missing fake credential store for llm-manager unit test')
  }
  return currentCredentialStore
} as unknown as new () => FakeCredentialStore

providerAdapterModule.getProviderAdapter = ((providerId: LlmProviderId) => {
  const adapter = currentAdapters[providerId]
  if (!adapter) {
    throw new Error(`Missing fake provider adapter for ${providerId}`)
  }
  return adapter
}) as typeof providerAdapterModule.getProviderAdapter

const { LlmManager } = require('../../src/main/llm/manager') as typeof import('../../src/main/llm/manager')

test.after(() => {
  providerAdapterModule.getProviderAdapter = originalGetProviderAdapter
  credentialStoreModule.LlmCredentialStore = originalCredentialStoreCtor
})

test('setFallbackOrder deduplicates providers and appends missing supported providers', () => {
  currentCredentialStore = createCredentialStore()
  currentAdapters = {}
  const settings = createSettingsManager()
  const manager = new LlmManager(settings as never)

  manager.setFallbackOrder(['openai', 'groq', 'openai', 'invalid-provider' as never])

  assert.deepEqual(settings.state.fallbackOrder, ['openai', 'groq', 'gemini', 'anthropic'])
})

test('setApiKey and clearApiKey keep persisted apiKeyStored state in sync with the credential store', async () => {
  currentCredentialStore = createCredentialStore()
  currentAdapters = {}
  const settings = createSettingsManager()
  const manager = new LlmManager(settings as never)

  await manager.setApiKey('openai', 'openai-secret')
  assert.equal(currentCredentialStore.credentials.openai, 'openai-secret')
  assert.equal(settings.state.providers.openai.apiKeyStored, true)

  await manager.clearApiKey('openai')
  assert.equal(currentCredentialStore.credentials.openai, undefined)
  assert.equal(settings.state.providers.openai.apiKeyStored, false)
})

test('listModels requires a stored credential and stamps the provider refresh time after a successful load', async () => {
  currentCredentialStore = createCredentialStore({ openai: 'openai-secret' })
  currentAdapters = {
    openai: {
      async listModels(apiKey) {
        assert.equal(apiKey, 'openai-secret')
        return [
          {
            id: 'gpt-4o-mini',
            providerId: 'openai',
            displayName: 'GPT-4o mini'
          }
        ]
      },
      async classifyCause() {
        throw new Error('not used in listModels test')
      }
    }
  }
  const settings = createSettingsManager()
  const manager = new LlmManager(settings as never)

  const models = await manager.listModels('openai')

  assert.equal(models.length, 1)
  assert.equal(models[0]?.id, 'gpt-4o-mini')
  assert.match(settings.state.providers.openai.lastModelRefreshAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
})

test('classifyCandidate short-circuits to no-api when consent is disabled', async () => {
  currentCredentialStore = createCredentialStore({
    openai: 'openai-secret'
  })
  currentAdapters = {
    openai: {
      async listModels() {
        throw new Error('not used in classifyCandidate no-api test')
      },
      async classifyCause() {
        throw new Error('consent-disabled path should not call provider adapters')
      }
    }
  }
  const settings = createSettingsManager()
  settings.state.consentEnabled = false
  const manager = new LlmManager(settings as never)

  const result = await manager.classifyCandidate(createInput())

  assert.equal(result.source, 'no-api')
  assert.equal(result.providerId, null)
  assert.match(result.recentOutputExcerpt, /Please review the patch|Approve changes\?/i)
  assert.equal(settings.state.usage.openai.requestCount, 0)
})

test('classifyCandidate falls through failing providers and records usage only for the successful adapter', async () => {
  currentCredentialStore = createCredentialStore({
    groq: 'groq-secret',
    openai: 'openai-secret'
  })
  currentAdapters = {
    groq: {
      async listModels() {
        throw new Error('not used in fallback classify test')
      },
      async classifyCause() {
        throw new Error('temporary upstream failure')
      }
    },
    openai: {
      async listModels() {
        throw new Error('not used in fallback classify test')
      },
      async classifyCause(apiKey, modelId, recentOutput) {
        assert.equal(apiKey, 'openai-secret')
        assert.equal(modelId, 'gpt-4o-mini')
        assert.match(recentOutput, /Approve changes\?/)
        return {
          result: {
            category: 'approval',
            summary: 'Approval needed',
            confidence: 'high',
            source: 'llm',
            providerId: 'openai',
            modelId,
            recentOutputExcerpt: recentOutput
          },
          inputTokens: 17,
          outputTokens: 9
        }
      }
    }
  }
  const settings = createSettingsManager()
  settings.state.consentEnabled = true
  settings.state.selectedProvider = 'groq'
  settings.state.fallbackOrder = ['groq', 'openai', 'anthropic', 'gemini']
  const manager = new LlmManager(settings as never)

  const result = await manager.classifyCandidate(createInput())

  assert.equal(result.source, 'llm')
  assert.equal(result.providerId, 'openai')
  assert.equal(settings.state.usage.groq.requestCount, 0)
  assert.equal(settings.state.usage.openai.requestCount, 1)
  assert.equal(settings.state.usage.openai.inputTokens, 17)
  assert.equal(settings.state.usage.openai.outputTokens, 9)
  assert.match(settings.state.usage.openai.lastUsedAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
})
