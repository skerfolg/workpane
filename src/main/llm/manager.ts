import type {
  LlmExecutionLane,
  LlmClassificationResult,
  LlmLaneConnectResult,
  LlmLaneMoveDelta,
  LlmProviderId,
  LlmRuntimeInput,
  LlmSettingsState,
  LlmStorageStatus,
  LlmUsageSnapshot
} from '../../shared/types'
import { SettingsManager } from '../settings-manager'
import {
  createLlmValidationState,
  ERR_NON_DIRECT_HTTP_LANE,
  ERR_UNKNOWN_LANE_ID,
  isDirectHttpExecutionLane,
  isOfficialClientBridgeLane,
  GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
  OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
  pinOfficialClientBridgeLanes,
  syncLegacyProviderShims
} from '../../shared/types'
import { LlmCredentialStore } from './credential-store'
import { buildExecutionLaneOrder } from './fallback-chain'
import { buildNoApiHint } from './no-api-hint'
import type { BridgeConnectHooks, OfficialClientBridge } from './client-bridges/client-bridge-types'
import { GeminiOfficialClientBridge } from './client-bridges/gemini-official-client-bridge'
import { OpenAiOfficialClientBridge } from './client-bridges/openai-official-client-bridge'
import { getProviderAdapter } from './provider-adapters'

function cloneLlmState(settingsManager: SettingsManager): LlmSettingsState {
  return syncLegacyProviderShims(structuredClone(settingsManager.get('llm') as LlmSettingsState))
}

function updateUsage(
  snapshot: LlmUsageSnapshot,
  inputTokens: number,
  outputTokens: number
): LlmUsageSnapshot {
  return {
    ...snapshot,
    requestCount: snapshot.requestCount + 1,
    inputTokens: snapshot.inputTokens + inputTokens,
    outputTokens: snapshot.outputTokens + outputTokens,
    lastUsedAt: new Date().toISOString()
  }
}

function tailRecentOutput(text: string, maxLines: number): string {
  return text.split(/\r?\n/).slice(-maxLines).join('\n')
}

export class LlmManager {
  private credentialStore = new LlmCredentialStore()
  private officialClientBridges: Record<string, OfficialClientBridge>

  constructor(
    private readonly settingsManager: SettingsManager,
    options: {
      officialClientBridges?: Partial<Record<string, OfficialClientBridge>>
    } = {}
  ) {
    this.officialClientBridges = {
      [GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID]:
        options.officialClientBridges?.[GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID] ?? new GeminiOfficialClientBridge(),
      [OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID]:
        options.officialClientBridges?.[OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID] ?? new OpenAiOfficialClientBridge()
    }
  }

  private persistState(state: LlmSettingsState): void {
    state.executionLanes = pinOfficialClientBridgeLanes(state.executionLanes)
    syncLegacyProviderShims(state)
    this.settingsManager.set('llm', state)
  }

  private getExecutionLane(
    state: LlmSettingsState,
    laneId: string
  ): LlmExecutionLane {
    const lane = state.executionLanes.find((entry) => entry.laneId === laneId)
    if (!lane) {
      throw new Error(ERR_UNKNOWN_LANE_ID)
    }
    return lane
  }

  private getDirectHttpLaneControlTarget(
    state: LlmSettingsState,
    laneId: string
  ): LlmExecutionLane {
    const lane = this.getExecutionLane(state, laneId)
    if (!isDirectHttpExecutionLane(lane)) {
      throw new Error(ERR_NON_DIRECT_HTTP_LANE)
    }
    return lane
  }

  private getOfficialClientBridgeLane(
    state: LlmSettingsState,
    laneId: string
  ): LlmExecutionLane {
    const lane = this.getExecutionLane(state, laneId)
    if (!isOfficialClientBridgeLane(lane) || !this.officialClientBridges[lane.laneId]) {
      throw new Error(`Unsupported official-client bridge lane: ${laneId}`)
    }
    return lane
  }

  private getOfficialClientBridge(laneId: string): OfficialClientBridge {
    const bridge = this.officialClientBridges[laneId]
    if (!bridge) {
      throw new Error(`Unsupported official-client bridge lane: ${laneId}`)
    }
    return bridge
  }

  private updateLaneValidationState(
    state: LlmSettingsState,
    laneId: string,
    validationState: LlmExecutionLane['validationState'],
    enabled: boolean
  ): LlmExecutionLane {
    state.executionLanes = pinOfficialClientBridgeLanes(
      state.executionLanes.map((lane) => {
        if (lane.laneId !== laneId) {
          return lane
        }

        return {
          ...lane,
          enabled,
          validationState
        }
      })
    )
    return this.getExecutionLane(state, laneId)
  }

  getSettingsState(): LlmSettingsState {
    return cloneLlmState(this.settingsManager)
  }

  getStorageStatus(): LlmStorageStatus {
    return this.credentialStore.getStorageStatus()
  }

  async listModels(providerId: LlmProviderId) {
    const apiKey = await this.credentialStore.getCredential(providerId)
    if (!apiKey) {
      throw new Error(`No API key stored for ${providerId}.`)
    }

    const models = await getProviderAdapter(providerId).listModels(apiKey)
    const state = this.getSettingsState()
    state.providers[providerId].lastModelRefreshAt = new Date().toISOString()
    this.settingsManager.set('llm', state)
    return models
  }

  async setApiKey(providerId: LlmProviderId, apiKey: string): Promise<void> {
    await this.credentialStore.setCredential(providerId, apiKey)
    const state = this.getSettingsState()
    state.providers[providerId].apiKeyStored = true
    this.settingsManager.set('llm', state)
  }

  async clearApiKey(providerId: LlmProviderId): Promise<void> {
    await this.credentialStore.clearCredential(providerId)
    const state = this.getSettingsState()
    state.providers[providerId].apiKeyStored = false
    this.settingsManager.set('llm', state)
  }

  setConsentEnabled(enabled: boolean): void {
    const state = this.getSettingsState()
    state.consentEnabled = enabled
    this.settingsManager.set('llm', state)
  }

  async connectLane(
    laneId: string,
    hooks: BridgeConnectHooks
  ): Promise<LlmLaneConnectResult> {
    const state = this.getSettingsState()
    this.getOfficialClientBridgeLane(state, laneId)
    return await this.getOfficialClientBridge(laneId).connect(laneId, hooks)
  }

  async refreshLaneState(laneId: string): Promise<LlmExecutionLane> {
    const state = this.getSettingsState()
    const lane = this.getOfficialClientBridgeLane(state, laneId)
    const refresh = await this.getOfficialClientBridge(laneId).refreshState()
    const enabled = refresh.validationState.status === 'connected'
      ? true
      : lane.enabled && refresh.validationState.status === 'unknown'
    const updatedLane = this.updateLaneValidationState(state, laneId, refresh.validationState, enabled)
    this.persistState(state)
    return updatedLane
  }

  async validateLane(laneId: string): Promise<LlmExecutionLane> {
    const state = this.getSettingsState()
    this.getOfficialClientBridgeLane(state, laneId)
    const validation = await this.getOfficialClientBridge(laneId).validate()
    const updatedLane = this.updateLaneValidationState(
      state,
      laneId,
      validation.validationState,
      validation.validationState.status === 'connected'
    )
    this.persistState(state)
    return updatedLane
  }

  disconnectLane(laneId: string): LlmExecutionLane {
    const state = this.getSettingsState()
    this.getOfficialClientBridgeLane(state, laneId)
    const updatedLane = this.updateLaneValidationState(
      state,
      laneId,
      createLlmValidationState(),
      false
    )
    this.persistState(state)
    return updatedLane
  }

  setLaneEnabled(laneId: string, enabled: boolean): void {
    const state = this.getSettingsState()
    const targetLane = this.getDirectHttpLaneControlTarget(state, laneId)
    state.providers[targetLane.providerId].enabled = enabled
    state.executionLanes = pinOfficialClientBridgeLanes(
      state.executionLanes.map((lane) => lane.laneId === laneId ? { ...lane, enabled } : lane)
    )
    this.persistState(state)
  }

  moveLane(laneId: string, delta: LlmLaneMoveDelta): void {
    const state = this.getSettingsState()
    this.getDirectHttpLaneControlTarget(state, laneId)
    const directHttpLanes = [...state.executionLanes]
      .filter((lane) => isDirectHttpExecutionLane(lane))
      .sort((a, b) => a.priority - b.priority)
    const index = directHttpLanes.findIndex((lane) => lane.laneId === laneId)
    const swapIndex = index + delta
    if (index === -1 || swapIndex < 0 || swapIndex >= directHttpLanes.length) {
      return
    }
    ;[directHttpLanes[index], directHttpLanes[swapIndex]] = [directHttpLanes[swapIndex], directHttpLanes[index]]
    const nonDirectHttpLanes = state.executionLanes.filter((lane) => !isDirectHttpExecutionLane(lane))
    state.executionLanes = pinOfficialClientBridgeLanes([...directHttpLanes, ...nonDirectHttpLanes])
    this.persistState(state)
  }

  setSelectedModel(providerId: LlmProviderId, modelId: string): void {
    const state = this.getSettingsState()
    state.providers[providerId].selectedModel = modelId
    this.persistState(state)
  }

  async getCredentialPresence(): Promise<Record<LlmProviderId, boolean>> {
    return {
      gemini: await this.credentialStore.hasCredential('gemini'),
      groq: await this.credentialStore.hasCredential('groq'),
      anthropic: await this.credentialStore.hasCredential('anthropic'),
      openai: await this.credentialStore.hasCredential('openai')
    }
  }

  private async classifyDirectHttpLane(
    lane: LlmExecutionLane,
    state: LlmSettingsState,
    recentOutput: string
  ): Promise<LlmClassificationResult | null> {
    if (lane.transport !== 'direct_http') {
      return null
    }

    const apiKey = await this.credentialStore.getCredential(lane.providerId)
    if (!apiKey) {
      return null
    }

    const modelId = state.providers[lane.providerId].selectedModel
    try {
      const response = await getProviderAdapter(lane.providerId).classifyCause(apiKey, modelId, recentOutput)
      state.usage[lane.providerId] = updateUsage(state.usage[lane.providerId], response.inputTokens, response.outputTokens)
      this.persistState(state)
      return response.result
    } catch {
      return null
    }
  }

  private async classifyOfficialClientLane(
    lane: LlmExecutionLane,
    state: LlmSettingsState,
    recentOutput: string
  ): Promise<LlmClassificationResult | null> {
    if (!isOfficialClientBridgeLane(lane)) {
      return null
    }

    try {
      const response = await this.getOfficialClientBridge(lane.laneId).classifyCause(recentOutput)
      state.usage[lane.providerId] = updateUsage(state.usage[lane.providerId], response.inputTokens, response.outputTokens)
      this.updateLaneValidationState(state, lane.laneId, response.validationState, true)
      this.persistState(state)
      return response.result
    } catch (error) {
      const bridgeError =
        typeof error === 'object' && error !== null
          ? (error as { validationState?: LlmExecutionLane['validationState'] })
          : null
      const validationState = bridgeError?.validationState ??
        createLlmValidationState(
          'error',
          error instanceof Error ? error.message : 'Official-client bridge execution failed.',
          new Date().toISOString()
        )
      this.updateLaneValidationState(state, lane.laneId, validationState, lane.enabled)
      this.persistState(state)
      return null
    }
  }

  async classifyCandidate(input: LlmRuntimeInput): Promise<LlmClassificationResult> {
    const state = this.getSettingsState()
    const recentOutput = tailRecentOutput(input.recentOutput, 40)
    if (!state.consentEnabled) {
      return buildNoApiHint({ ...input, recentOutput })
    }

    const laneOrder = buildExecutionLaneOrder(state)
    for (const lane of laneOrder) {
      const officialClientResult = await this.classifyOfficialClientLane(lane, state, recentOutput)
      if (officialClientResult) {
        return officialClientResult
      }

      const result = await this.classifyDirectHttpLane(lane, state, recentOutput)
      if (result) {
        return result
      }
    }

    return buildNoApiHint({ ...input, recentOutput })
  }
}
