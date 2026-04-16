import test from 'node:test'
import assert from 'node:assert/strict'
import type { LlmExecutionLane, LlmSettingsState } from '../../src/shared/types'
import {
  buildDerivedProviderOrderFromLanes,
  createDirectHttpExecutionLane,
  createLlmValidationState,
  createOfficialClientExecutionLane,
  OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
  syncLegacyProviderShims
} from '../../src/shared/types'
import { buildProviderExecutionOrder } from '../../src/main/llm/fallback-chain'
import { buildNoApiHint } from '../../src/main/llm/no-api-hint'
import { getProviderAdapter } from '../../src/main/llm/provider-adapters'

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
      gemini: { enabled: true, selectedModel: 'gemini-2.5-flash', apiKeyStored: false, lastModelRefreshAt: null },
      groq: { enabled: true, selectedModel: 'llama-3.3-70b-versatile', apiKeyStored: false, lastModelRefreshAt: null },
      anthropic: { enabled: false, selectedModel: 'claude-3-5-haiku-latest', apiKeyStored: false, lastModelRefreshAt: null },
      openai: { enabled: true, selectedModel: 'gpt-4o-mini', apiKeyStored: false, lastModelRefreshAt: null }
    },
    usage: {
      gemini: { providerId: 'gemini', requestCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null, lastUsedAt: null },
      groq: { providerId: 'groq', requestCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null, lastUsedAt: null },
      anthropic: { providerId: 'anthropic', requestCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null, lastUsedAt: null },
      openai: { providerId: 'openai', requestCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null, lastUsedAt: null }
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

test('buildProviderExecutionOrder ignores official bridge lanes and keeps direct_http order stable', () => {
  const settings = createSettingsState()
  settings.executionLanes = [
    createOfficialClientBridgeLane({ priority: 0 }),
    createDirectHttpExecutionLane('openai', true, 1),
    createDirectHttpExecutionLane('groq', true, 2),
    createDirectHttpExecutionLane('gemini', true, 3),
    createDirectHttpExecutionLane('anthropic', false, 4)
  ]
  settings.selectedProvider = 'gemini'
  settings.fallbackOrder = ['gemini', 'groq', 'anthropic', 'openai']

  const order = buildProviderExecutionOrder(settings)
  const derivedOrder = buildDerivedProviderOrderFromLanes(settings.executionLanes)
  const synced = syncLegacyProviderShims(structuredClone(settings))

  assert.deepEqual(order, ['openai', 'groq', 'gemini'])
  assert.deepEqual(derivedOrder, ['openai', 'groq', 'gemini', 'anthropic'])
  assert.equal(synced.selectedProvider, 'openai')
  assert.deepEqual(synced.fallbackOrder, ['openai', 'groq', 'gemini', 'anthropic'])
  assert.equal(
    settings.executionLanes.filter((lane) => lane.providerId === 'openai').length,
    2
  )
})

test('buildNoApiHint returns low-confidence cause categories from recent output', () => {
  const result = buildNoApiHint({
    terminalId: 't-1',
    workspacePath: 'D:/workspace',
    patternName: 'Approve changes?',
    matchedText: 'Approve changes?',
    recentOutput: 'Please review the patch.\nApprove changes?'
  })

  assert.equal(result.source, 'no-api')
  assert.equal(result.confidence, 'low')
  assert.equal(result.category, 'approval')
  assert.match(result.summary, /Please review|Approve changes/i)
})

test('provider adapters expose listModels and classifyCause methods for all supported providers', () => {
  for (const providerId of ['gemini', 'groq', 'anthropic', 'openai'] as const) {
    const adapter = getProviderAdapter(providerId)
    assert.equal(typeof adapter.listModels, 'function')
    assert.equal(typeof adapter.classifyCause, 'function')
  }
})
