import test from 'node:test'
import assert from 'node:assert/strict'
import type { LlmSettingsState } from '../../src/shared/types'
import { buildProviderExecutionOrder } from '../../src/main/llm/fallback-chain'
import { buildNoApiHint } from '../../src/main/llm/no-api-hint'
import { getProviderAdapter } from '../../src/main/llm/provider-adapters'

function createSettingsState(): LlmSettingsState {
  return {
    consentEnabled: false,
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

test('buildProviderExecutionOrder keeps preferred provider first and skips disabled providers', () => {
  const settings = createSettingsState()
  settings.selectedProvider = 'openai'
  settings.fallbackOrder = ['groq', 'openai', 'anthropic', 'gemini']

  const order = buildProviderExecutionOrder(settings)

  assert.deepEqual(order, ['openai', 'groq', 'gemini'])
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
