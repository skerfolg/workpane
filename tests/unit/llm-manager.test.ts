import test from 'node:test'
import assert from 'node:assert/strict'
import type {
  LlmExecutionLane,
  LlmClassificationResult,
  LlmModelSummary,
  LlmProviderId,
  LlmRuntimeInput,
  LlmSettingsState,
  LlmStorageStatus
} from '../../src/shared/types'
import {
  createDirectHttpExecutionLane,
  createLlmValidationState,
  createOfficialClientExecutionLane,
  ERR_NON_DIRECT_HTTP_LANE,
  ERR_UNKNOWN_LANE_ID,
  OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID
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
    executionLanes: [
      createDirectHttpExecutionLane('gemini', true, 0),
      createDirectHttpExecutionLane('groq', true, 1),
      createDirectHttpExecutionLane('anthropic', false, 2),
      createDirectHttpExecutionLane('openai', true, 3)
    ],
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

function createOfficialClientBridgeLane(
  overrides: Partial<LlmExecutionLane> = {}
): LlmExecutionLane {
  return {
    ...createOfficialClientExecutionLane('openai', true, 0),
    validationState: createLlmValidationState('connected', 'Authenticated via Codex CLI', '2026-04-16T05:34:14.000Z'),
    ...overrides
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

test('moveLane reorders only direct_http lanes and keeps the bridge pinned ahead of openai direct_http', () => {
  currentCredentialStore = createCredentialStore()
  currentAdapters = {}
  const settings = createSettingsManager()
  settings.state.executionLanes = [
    createDirectHttpExecutionLane('gemini', true, 0),
    createOfficialClientBridgeLane({ priority: 1 }),
    createDirectHttpExecutionLane('openai', true, 2),
    createDirectHttpExecutionLane('groq', true, 3),
    createDirectHttpExecutionLane('anthropic', false, 4)
  ]
  const manager = new LlmManager(settings as never)

  manager.moveLane('openai/direct_http', -1)
  manager.moveLane('openai/direct_http', -1)

  assert.equal(settings.state.selectedProvider, 'openai')
  assert.deepEqual(settings.state.fallbackOrder, ['openai', 'gemini', 'groq', 'anthropic'])
  assert.deepEqual(
    settings.state.executionLanes
      .filter((lane) => lane.transport === 'direct_http')
      .map((lane) => lane.providerId),
    ['openai', 'gemini', 'groq', 'anthropic']
  )
  const bridgeIndex = settings.state.executionLanes.findIndex(
    (lane) => lane.laneId === OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID
  )
  const directHttpIndex = settings.state.executionLanes.findIndex((lane) => lane.laneId === 'openai/direct_http')
  assert.equal(bridgeIndex + 1, directHttpIndex)
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
  settings.state.executionLanes = [
    createDirectHttpExecutionLane('groq', true, 0),
    createDirectHttpExecutionLane('openai', true, 1),
    createDirectHttpExecutionLane('anthropic', false, 2),
    createDirectHttpExecutionLane('gemini', true, 3)
  ]
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

test('classifyCandidate follows execution lane priority even when provider shims are stale', async () => {
  let groqCalls = 0
  currentCredentialStore = createCredentialStore({
    groq: 'groq-secret',
    openai: 'openai-secret'
  })
  currentAdapters = {
    groq: {
      async listModels() {
        throw new Error('not used in lane-priority classify test')
      },
      async classifyCause() {
        groqCalls += 1
        return {
          result: {
            category: 'approval',
            summary: 'Groq should not win',
            confidence: 'low',
            source: 'llm',
            providerId: 'groq',
            modelId: 'llama-3.3-70b-versatile',
            recentOutputExcerpt: 'unused'
          },
          inputTokens: 1,
          outputTokens: 1
        }
      }
    },
    openai: {
      async listModels() {
        throw new Error('not used in lane-priority classify test')
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
          inputTokens: 10,
          outputTokens: 5
        }
      }
    }
  }
  const settings = createSettingsManager()
  settings.state.consentEnabled = true
  settings.state.selectedProvider = 'groq'
  settings.state.fallbackOrder = ['groq', 'openai', 'anthropic', 'gemini']
  settings.state.executionLanes = [
    createDirectHttpExecutionLane('openai', true, 0),
    createDirectHttpExecutionLane('groq', true, 1),
    createDirectHttpExecutionLane('gemini', true, 2),
    createDirectHttpExecutionLane('anthropic', false, 3)
  ]
  const manager = new LlmManager(settings as never)

  const result = await manager.classifyCandidate(createInput())

  assert.equal(result.providerId, 'openai')
  assert.equal(groqCalls, 0)
  assert.equal(settings.state.usage.openai.requestCount, 1)
  assert.equal(settings.state.usage.groq.requestCount, 0)
})

test('moveLane swaps a direct_http lane down by one position and updates fallback order shims', () => {
  currentCredentialStore = createCredentialStore()
  currentAdapters = {}
  const settings = createSettingsManager()
  const manager = new LlmManager(settings as never)

  manager.moveLane('groq/direct_http', 1)

  assert.deepEqual(
    settings.state.executionLanes
      .filter((lane) => lane.transport === 'direct_http')
      .map((lane) => lane.providerId),
    ['gemini', 'anthropic', 'groq', 'openai']
  )
  assert.equal(settings.state.selectedProvider, 'gemini')
  assert.deepEqual(settings.state.fallbackOrder, ['gemini', 'anthropic', 'groq', 'openai'])
})

test('setLaneEnabled updates the direct_http lane without disabling the bridge lane', () => {
  currentCredentialStore = createCredentialStore()
  currentAdapters = {}
  const settings = createSettingsManager()
  settings.state.executionLanes = [
    createDirectHttpExecutionLane('gemini', true, 0),
    createOfficialClientBridgeLane({ priority: 1, enabled: true }),
    createDirectHttpExecutionLane('openai', true, 2),
    createDirectHttpExecutionLane('groq', true, 3),
    createDirectHttpExecutionLane('anthropic', false, 4)
  ]
  const manager = new LlmManager(settings as never)

  manager.setLaneEnabled('openai/direct_http', false)

  const bridgeLane = settings.state.executionLanes.find(
    (lane) => lane.laneId === OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID
  )
  const directHttpLane = settings.state.executionLanes.find((lane) => lane.laneId === 'openai/direct_http')

  assert.equal(settings.state.providers.openai.enabled, false)
  assert.equal(directHttpLane?.enabled, false)
  assert.equal(bridgeLane?.enabled, true)
  assert.deepEqual(bridgeLane?.validationState, {
    status: 'connected',
    detail: 'Authenticated via Codex CLI',
    lastValidatedAt: '2026-04-16T05:34:14.000Z'
  })
})

test('setLaneEnabled rejects an unknown lane id with the contract error message', () => {
  currentCredentialStore = createCredentialStore()
  currentAdapters = {}
  const settings = createSettingsManager()
  const manager = new LlmManager(settings as never)

  assert.throws(() => {
    manager.setLaneEnabled('missing/direct_http', true)
  }, new Error(ERR_UNKNOWN_LANE_ID))
})

test('setLaneEnabled rejects non-direct_http lanes with the contract error message', () => {
  currentCredentialStore = createCredentialStore()
  currentAdapters = {}
  const settings = createSettingsManager()
  settings.state.executionLanes = [
    createOfficialClientBridgeLane({ priority: 0 }),
    createDirectHttpExecutionLane('openai', true, 1)
  ]
  const manager = new LlmManager(settings as never)

  assert.throws(() => {
    manager.setLaneEnabled(OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID, false)
  }, new Error(ERR_NON_DIRECT_HTTP_LANE))
})

test('moveLane rejects non-direct_http lanes with the contract error message', () => {
  currentCredentialStore = createCredentialStore()
  currentAdapters = {}
  const settings = createSettingsManager()
  settings.state.executionLanes = [
    createOfficialClientBridgeLane({ priority: 0 }),
    createDirectHttpExecutionLane('openai', true, 1)
  ]
  const manager = new LlmManager(settings as never)

  assert.throws(() => {
    manager.moveLane(OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID, 1)
  }, new Error(ERR_NON_DIRECT_HTTP_LANE))
})
