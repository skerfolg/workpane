import test from 'node:test'
import assert from 'node:assert/strict'
import type { LlmExecutionLane } from '../../src/shared/types'
import {
  createDirectHttpExecutionLane,
  createOfficialClientExecutionLane,
  GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
  OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID
} from '../../src/shared/types'
import { normalizeLlmSettingsState } from '../../src/main/settings-manager'

function createOfficialClientBridgeLane(
  providerId: 'gemini' | 'openai',
  overrides: Partial<LlmExecutionLane> = {}
): LlmExecutionLane {
  return {
    ...createOfficialClientExecutionLane(providerId, false, 1),
    ...overrides
  }
}

function getBridgeLane(lanes: LlmExecutionLane[], laneId: string): LlmExecutionLane {
  const bridgeLane = lanes.find((lane) => lane.laneId === laneId)
  assert.ok(bridgeLane, `expected normalized settings to include ${laneId}`)
  return bridgeLane
}

test('normalizeLlmSettingsState inserts both official_client_bridge lanes with default bridge validation state', () => {
  const normalized = normalizeLlmSettingsState({
    consentEnabled: true,
    selectedProvider: 'openai',
    fallbackOrder: ['groq', 'openai', 'gemini', 'anthropic'],
    providers: {
      gemini: { enabled: true, selectedModel: 'gemini-2.5-flash', apiKeyStored: false, lastModelRefreshAt: null },
      groq: { enabled: true, selectedModel: 'llama-3.3-70b-versatile', apiKeyStored: false, lastModelRefreshAt: null },
      anthropic: { enabled: false, selectedModel: 'claude-3-5-haiku-latest', apiKeyStored: false, lastModelRefreshAt: null },
      openai: { enabled: true, selectedModel: 'gpt-4o-mini', apiKeyStored: true, lastModelRefreshAt: null }
    }
  })

  const geminiBridgeLane = getBridgeLane(normalized.executionLanes, GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
  const openAiBridgeLane = getBridgeLane(normalized.executionLanes, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)

  assert.equal(normalized.executionLanes.some((lane) => lane.laneId === 'openai/direct_http'), true)
  assert.equal(normalized.executionLanes.some((lane) => lane.laneId === 'gemini/direct_http'), true)
  for (const bridgeLane of [geminiBridgeLane, openAiBridgeLane]) {
    assert.equal(bridgeLane.transport, 'official_client_bridge')
    assert.equal(bridgeLane.credentialStyle, 'provider_session')
    assert.equal(bridgeLane.enabled, false)
    assert.deepEqual(bridgeLane.validationState, {
      status: 'unknown',
      detail: null,
      lastValidatedAt: null
    })
    assert.equal('selectedModel' in (bridgeLane as unknown as Record<string, unknown>), false)
    assert.equal('modelId' in (bridgeLane as unknown as Record<string, unknown>), false)
  }
  assert.equal(geminiBridgeLane.providerId, 'gemini')
  assert.equal(openAiBridgeLane.providerId, 'openai')
  assert.equal(normalized.providers.openai.selectedModel, 'gpt-4o-mini')
  assert.equal(normalized.providers.gemini.selectedModel, 'gemini-2.5-flash')
})

test('normalizeLlmSettingsState preserves persisted official_client_bridge observability fields for both bridges', () => {
  const normalized = normalizeLlmSettingsState({
    consentEnabled: true,
    selectedProvider: 'groq',
    fallbackOrder: ['groq', 'openai', 'gemini', 'anthropic'],
    providers: {
      gemini: { enabled: true, selectedModel: 'gemini-2.5-flash', apiKeyStored: false, lastModelRefreshAt: null },
      groq: { enabled: true, selectedModel: 'llama-3.3-70b-versatile', apiKeyStored: true, lastModelRefreshAt: null },
      anthropic: { enabled: false, selectedModel: 'claude-3-5-haiku-latest', apiKeyStored: false, lastModelRefreshAt: null },
      openai: { enabled: true, selectedModel: 'gpt-4o-mini', apiKeyStored: false, lastModelRefreshAt: null }
    },
    executionLanes: [
      createDirectHttpExecutionLane('groq', true, 0),
      createOfficialClientBridgeLane('gemini', {
        enabled: true,
        priority: 1,
        validationState: {
          status: 'connected',
          detail: 'Authenticated via Gemini CLI',
          lastValidatedAt: '2026-04-17T00:05:00.000Z'
        }
      }),
      createDirectHttpExecutionLane('gemini', true, 2),
      createOfficialClientBridgeLane('openai', {
        enabled: true,
        priority: 3,
        validationState: {
          status: 'connected',
          detail: 'Authenticated via Codex CLI',
          lastValidatedAt: '2026-04-16T05:34:14.000Z'
        }
      }),
      createDirectHttpExecutionLane('openai', true, 4),
      createDirectHttpExecutionLane('anthropic', false, 5)
    ]
  })

  const geminiBridgeLane = getBridgeLane(normalized.executionLanes, GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
  const openAiBridgeLane = getBridgeLane(normalized.executionLanes, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)

  assert.deepEqual(
    normalized.executionLanes.map((lane) => lane.laneId),
    [
      'groq/direct_http',
      GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
      'gemini/direct_http',
      OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
      'openai/direct_http',
      'anthropic/direct_http'
    ]
  )
  assert.equal(geminiBridgeLane.enabled, true)
  assert.deepEqual(geminiBridgeLane.validationState, {
    status: 'connected',
    detail: 'Authenticated via Gemini CLI',
    lastValidatedAt: '2026-04-17T00:05:00.000Z'
  })
  assert.equal(openAiBridgeLane.enabled, true)
  assert.deepEqual(openAiBridgeLane.validationState, {
    status: 'connected',
    detail: 'Authenticated via Codex CLI',
    lastValidatedAt: '2026-04-16T05:34:14.000Z'
  })
  assert.equal(normalized.providers.openai.selectedModel, 'gpt-4o-mini')
})

test('normalizeLlmSettingsState strips display-only bridge model metadata from persisted lanes', () => {
  const normalized = normalizeLlmSettingsState({
    executionLanes: [
      createDirectHttpExecutionLane('gemini', true, 0),
      {
        ...createOfficialClientBridgeLane('gemini'),
        modelId: 'gemini-2.5-pro',
        selectedModel: 'gemini-2.5-pro',
        displayModelLabel: 'Managed by Gemini CLI'
      },
      {
        ...createOfficialClientBridgeLane('openai'),
        modelId: 'gpt-5',
        selectedModel: 'gpt-5',
        displayModelLabel: 'Managed by Codex CLI'
      },
      createDirectHttpExecutionLane('openai', true, 3),
      createDirectHttpExecutionLane('groq', true, 4),
      createDirectHttpExecutionLane('anthropic', false, 5)
    ]
  })

  const bridgeLanes = [
    getBridgeLane(normalized.executionLanes, GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID),
    getBridgeLane(normalized.executionLanes, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
  ].map((lane) => lane as unknown as Record<string, unknown>)

  for (const bridgeLane of bridgeLanes) {
    assert.equal('modelId' in bridgeLane, false)
    assert.equal('selectedModel' in bridgeLane, false)
    assert.equal('displayModelLabel' in bridgeLane, false)
  }
})

test('normalizeLlmSettingsState keeps persisted execution lane priority authoritative even when legacy shims are stale', () => {
  const normalized = normalizeLlmSettingsState({
    selectedProvider: 'gemini',
    fallbackOrder: ['gemini', 'groq', 'anthropic', 'openai'],
    executionLanes: [
      createDirectHttpExecutionLane('openai', true, 0),
      createOfficialClientBridgeLane('openai', {
        enabled: true,
        priority: 1,
        validationState: {
          status: 'connected',
          detail: 'Authenticated via Codex CLI',
          lastValidatedAt: '2026-04-16T05:34:14.000Z'
        }
      }),
      createDirectHttpExecutionLane('groq', true, 2),
      createOfficialClientBridgeLane('gemini', {
        enabled: true,
        priority: 3,
        validationState: {
          status: 'connected',
          detail: 'Authenticated via Gemini CLI',
          lastValidatedAt: '2026-04-17T00:05:00.000Z'
        }
      }),
      createDirectHttpExecutionLane('gemini', true, 4),
      createDirectHttpExecutionLane('anthropic', false, 5)
    ]
  })

  assert.deepEqual(
    normalized.executionLanes.map((lane) => lane.laneId),
    [
      OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
      'openai/direct_http',
      'groq/direct_http',
      GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
      'gemini/direct_http',
      'anthropic/direct_http'
    ]
  )
  assert.equal(normalized.selectedProvider, 'openai')
  assert.deepEqual(normalized.fallbackOrder, ['openai', 'groq', 'gemini', 'anthropic'])
})
