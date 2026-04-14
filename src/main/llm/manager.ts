import type {
  LlmClassificationResult,
  LlmProviderId,
  LlmRuntimeInput,
  LlmSettingsState,
  LlmStorageStatus,
  LlmUsageSnapshot
} from '../../shared/types'
import { SettingsManager } from '../settings-manager'
import { LLM_PROVIDER_IDS, isLlmProviderId } from '../../shared/types'
import { LlmCredentialStore } from './credential-store'
import { buildProviderExecutionOrder } from './fallback-chain'
import { buildNoApiHint } from './no-api-hint'
import { getProviderAdapter } from './provider-adapters'

function cloneLlmState(settingsManager: SettingsManager): LlmSettingsState {
  return structuredClone(settingsManager.get('llm') as LlmSettingsState)
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

  constructor(private readonly settingsManager: SettingsManager) {}

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

  setSelectedProvider(providerId: LlmProviderId): void {
    const state = this.getSettingsState()
    state.selectedProvider = providerId
    this.settingsManager.set('llm', state)
  }

  setProviderEnabled(providerId: LlmProviderId, enabled: boolean): void {
    const state = this.getSettingsState()
    state.providers[providerId].enabled = enabled
    this.settingsManager.set('llm', state)
  }

  setSelectedModel(providerId: LlmProviderId, modelId: string): void {
    const state = this.getSettingsState()
    state.providers[providerId].selectedModel = modelId
    this.settingsManager.set('llm', state)
  }

  setFallbackOrder(order: LlmProviderId[]): void {
    const state = this.getSettingsState()
    const next = order.filter((providerId, index) =>
      isLlmProviderId(providerId) && order.indexOf(providerId) === index
    )
    for (const providerId of LLM_PROVIDER_IDS) {
      if (!next.includes(providerId)) next.push(providerId)
    }
    state.fallbackOrder = next
    this.settingsManager.set('llm', state)
  }

  async getCredentialPresence(): Promise<Record<LlmProviderId, boolean>> {
    return {
      gemini: await this.credentialStore.hasCredential('gemini'),
      groq: await this.credentialStore.hasCredential('groq'),
      anthropic: await this.credentialStore.hasCredential('anthropic'),
      openai: await this.credentialStore.hasCredential('openai')
    }
  }

  async classifyCandidate(input: LlmRuntimeInput): Promise<LlmClassificationResult> {
    const state = this.getSettingsState()
    const recentOutput = tailRecentOutput(input.recentOutput, 40)
    if (!state.consentEnabled) {
      return buildNoApiHint({ ...input, recentOutput })
    }

    const providerOrder = buildProviderExecutionOrder(state)
    for (const providerId of providerOrder) {
      const apiKey = await this.credentialStore.getCredential(providerId)
      if (!apiKey) continue

      const modelId = state.providers[providerId].selectedModel
      try {
        const response = await getProviderAdapter(providerId).classifyCause(apiKey, modelId, recentOutput)
        state.usage[providerId] = updateUsage(state.usage[providerId], response.inputTokens, response.outputTokens)
        this.settingsManager.set('llm', state)
        return response.result
      } catch {
        continue
      }
    }

    return buildNoApiHint({ ...input, recentOutput })
  }
}
