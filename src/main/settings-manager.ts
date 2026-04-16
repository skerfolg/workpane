import Store from 'electron-store'
import type { LlmExecutionLane, LlmProviderId, LlmProviderSettings, LlmSettingsState, LlmUsageSnapshot } from '../shared/types'
import {
  buildLegacyProviderOrder,
  createLlmValidationState,
  createDirectHttpExecutionLane,
  createOfficialClientExecutionLane,
  LLM_PROVIDER_IDS,
  OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
  pinOpenAiBridgeLane,
  syncLegacyProviderShims
} from '../shared/types'

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

function createDefaultExecutionLanes(
  providers: LlmSettingsState['providers']
): LlmExecutionLane[] {
  const providerOrder = buildLegacyProviderOrder('gemini', [...LLM_PROVIDER_IDS])
  const directHttpLanes = providerOrder.map((providerId, priority) =>
    createDirectHttpExecutionLane(providerId, providers[providerId].enabled, priority)
  )
  const openAiIndex = directHttpLanes.findIndex((lane) => lane.providerId === 'openai')
  const lanes = [...directHttpLanes]
  lanes.splice(openAiIndex === -1 ? lanes.length : openAiIndex, 0, createOfficialClientExecutionLane('openai', false, 0))
  return pinOpenAiBridgeLane(lanes)
}

function normalizeValidationState(
  rawState: unknown
): LlmExecutionLane['validationState'] {
  const raw = (rawState ?? {}) as Partial<LlmExecutionLane['validationState']>
  const status = raw.status
  return {
    status:
      status === 'connected' ||
      status === 'missing_client' ||
      status === 'unauthenticated' ||
      status === 'unsupported_platform' ||
      status === 'error'
        ? status
        : 'unknown',
    detail: typeof raw.detail === 'string' ? raw.detail : null,
    lastValidatedAt: typeof raw.lastValidatedAt === 'string' ? raw.lastValidatedAt : null
  }
}

function normalizeProviders(
  rawProviders: Partial<Record<LlmProviderId, Partial<LlmProviderSettings> | undefined>> | undefined
): LlmSettingsState['providers'] {
  const defaults = createDefaultProviders()
  return {
    gemini: { ...defaults.gemini, ...(rawProviders?.gemini ?? {}) },
    groq: { ...defaults.groq, ...(rawProviders?.groq ?? {}) },
    anthropic: { ...defaults.anthropic, ...(rawProviders?.anthropic ?? {}) },
    openai: { ...defaults.openai, ...(rawProviders?.openai ?? {}) }
  }
}

function normalizeUsage(
  rawUsage: Partial<Record<LlmProviderId, Partial<LlmUsageSnapshot> | undefined>> | undefined
): LlmSettingsState['usage'] {
  return {
    gemini: { ...createDefaultUsage('gemini'), ...(rawUsage?.gemini ?? {}) },
    groq: { ...createDefaultUsage('groq'), ...(rawUsage?.groq ?? {}) },
    anthropic: { ...createDefaultUsage('anthropic'), ...(rawUsage?.anthropic ?? {}) },
    openai: { ...createDefaultUsage('openai'), ...(rawUsage?.openai ?? {}) }
  }
}

function normalizeExecutionLanes(
  rawLanes: unknown,
  providers: LlmSettingsState['providers'],
  selectedProvider: LlmProviderId,
  fallbackOrder: LlmProviderId[]
): LlmExecutionLane[] {
  const rawExecutionLanes = Array.isArray(rawLanes)
    ? rawLanes.filter((lane): lane is Partial<LlmExecutionLane> & { providerId: LlmProviderId } => {
        return (
          typeof lane === 'object' &&
          lane !== null &&
          typeof (lane as { providerId?: unknown }).providerId === 'string' &&
          typeof (lane as { transport?: unknown }).transport === 'string'
        )
      })
    : []

  const fallbackProviderOrder = buildLegacyProviderOrder(selectedProvider, fallbackOrder)
  const orderedRawExecutionLanes = [...rawExecutionLanes].sort((left, right) => {
    const leftPriority = typeof left.priority === 'number' ? left.priority : Number.MAX_SAFE_INTEGER
    const rightPriority = typeof right.priority === 'number' ? right.priority : Number.MAX_SAFE_INTEGER
    return leftPriority - rightPriority
  })
  const directHttpLaneMap = new Map<LlmProviderId, Partial<LlmExecutionLane>>()
  const directHttpOrderFromRaw: LlmProviderId[] = []
  const seenDirectHttpProviders = new Set<LlmProviderId>()
  let persistedBridgeLane: Partial<LlmExecutionLane> | undefined
  for (const lane of orderedRawExecutionLanes) {
    if (lane.transport === 'direct_http' && LLM_PROVIDER_IDS.includes(lane.providerId)) {
      directHttpLaneMap.set(lane.providerId, lane)
      if (!seenDirectHttpProviders.has(lane.providerId)) {
        seenDirectHttpProviders.add(lane.providerId)
        directHttpOrderFromRaw.push(lane.providerId)
      }
    }
    if (
      lane.providerId === 'openai' &&
      lane.transport === 'official_client_bridge' &&
      lane.laneId === OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID
    ) {
      persistedBridgeLane = lane
    }
  }

  const authoritativeDirectHttpOrder = directHttpOrderFromRaw.length > 0
    ? [
        ...directHttpOrderFromRaw,
        ...fallbackProviderOrder.filter((providerId) => !seenDirectHttpProviders.has(providerId))
      ]
    : fallbackProviderOrder

  const directHttpLanes = authoritativeDirectHttpOrder.map((providerId, priority) => {
    const existing = directHttpLaneMap.get(providerId)
    const enabled = typeof existing?.enabled === 'boolean' ? existing.enabled : providers[providerId].enabled
    providers[providerId] = {
      ...providers[providerId],
      enabled
    }
    return {
      laneId: createDirectHttpExecutionLane(providerId, enabled, priority).laneId,
      providerId,
      transport: 'direct_http',
      credentialStyle: 'api_key',
      enabled,
      priority,
      validationState: normalizeValidationState(existing?.validationState)
    } satisfies LlmExecutionLane
  })

  const bridgeEnabled = typeof persistedBridgeLane?.enabled === 'boolean' ? persistedBridgeLane.enabled : false
  const bridgeLane: LlmExecutionLane = {
    laneId: createOfficialClientExecutionLane('openai', bridgeEnabled, 0).laneId,
    providerId: 'openai',
    transport: 'official_client_bridge',
    credentialStyle: 'provider_session',
    enabled: bridgeEnabled,
    priority: 0,
    validationState: persistedBridgeLane
      ? normalizeValidationState(persistedBridgeLane.validationState)
      : createLlmValidationState()
  }

  return pinOpenAiBridgeLane([...directHttpLanes, bridgeLane]).map((lane) => ({
    laneId: lane.laneId,
    providerId: lane.providerId,
    transport: lane.transport,
    credentialStyle: lane.transport === 'official_client_bridge' ? 'provider_session' : 'api_key',
    enabled: lane.enabled,
    priority: lane.priority,
    validationState: normalizeValidationState(lane.validationState)
  }))
}

export function normalizeLlmSettingsState(rawState: unknown): LlmSettingsState {
  const raw = (rawState ?? {}) as Partial<LlmSettingsState>
  const providers = normalizeProviders(raw.providers)
  const usage = normalizeUsage(raw.usage)
  const selectedProvider = raw.selectedProvider && LLM_PROVIDER_IDS.includes(raw.selectedProvider)
    ? raw.selectedProvider
    : 'gemini'
  const fallbackOrder = Array.isArray(raw.fallbackOrder)
    ? raw.fallbackOrder.filter((providerId): providerId is LlmProviderId => LLM_PROVIDER_IDS.includes(providerId))
    : [...LLM_PROVIDER_IDS]
  const executionLanes = normalizeExecutionLanes(raw.executionLanes, providers, selectedProvider, fallbackOrder)

  return syncLegacyProviderShims({
    consentEnabled: raw.consentEnabled ?? false,
    executionLanes,
    selectedProvider,
    fallbackOrder,
    providers,
    usage
  })
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
    executionLanes: createDefaultExecutionLanes(createDefaultProviders()),
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
    this.store.set('llm', normalizeLlmSettingsState(this.store.get('llm')))
  }

  get(key?: string): unknown {
    if (!key) {
      return this.store.store
    }
    return this.store.get(key as keyof SettingsSchema)
  }

  set(key: string, value: unknown): void {
    if (key === 'llm') {
      this.store.set(key, normalizeLlmSettingsState(value))
      return
    }
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
