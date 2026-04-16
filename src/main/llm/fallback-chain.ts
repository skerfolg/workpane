import type { LlmExecutionLane, LlmProviderId, LlmSettingsState } from '../../shared/types'
import { LLM_PROVIDER_CAPABILITIES } from '../../shared/types'

export function buildExecutionLaneOrder(
  settings: LlmSettingsState
): LlmExecutionLane[] {
  return [...settings.executionLanes]
    .filter((lane) => lane.enabled)
    .filter((lane) => !LLM_PROVIDER_CAPABILITIES[lane.providerId].blockedStates.includes(lane.validationState.status))
    .sort((a, b) => a.priority - b.priority)
}

export function buildProviderExecutionOrder(
  settings: LlmSettingsState
): LlmProviderId[] {
  const seen = new Set<LlmProviderId>()
  const result: LlmProviderId[] = []

  for (const lane of buildExecutionLaneOrder(settings)) {
    if (lane.transport !== 'direct_http') continue
    if (seen.has(lane.providerId)) continue
    seen.add(lane.providerId)
    result.push(lane.providerId)
  }

  return result
}
