import type { LlmProviderId, LlmSettingsState } from '../../shared/types'

export function buildProviderExecutionOrder(
  settings: LlmSettingsState
): LlmProviderId[] {
  const ordered = [settings.selectedProvider, ...settings.fallbackOrder]
  const seen = new Set<LlmProviderId>()
  const result: LlmProviderId[] = []

  for (const providerId of ordered) {
    if (seen.has(providerId)) continue
    seen.add(providerId)
    if (!settings.providers[providerId]?.enabled) continue
    result.push(providerId)
  }

  return result
}
