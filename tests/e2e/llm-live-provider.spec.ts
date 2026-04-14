import { test, expect } from '@playwright/test'
import { closeApp, launchApp, openRecentWorkspace } from './helpers/electron'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

test.describe('LLM Live Provider Smoke', () => {
  test.skip(!OPENAI_API_KEY, 'OPENAI_API_KEY is required for live-provider smoke.')

  test('stores key, loads models, classifies, records usage, and clears key', async () => {
    test.setTimeout(120000)
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      const storage = await page.evaluate(async () => {
        return window.llm.getStorageStatus()
      })
      expect(storage.available).toBe(true)

      await page.evaluate(async (apiKey) => {
        await window.llm.setProviderEnabled('openai', true)
        await window.llm.setSelectedProvider('openai')
        await window.llm.setConsent(true)
        await window.llm.setApiKey('openai', apiKey)
      }, OPENAI_API_KEY)

      const models = await page.evaluate(async () => {
        return window.llm.listModels('openai')
      })
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)

      const chosenModel = models.find((model) => model.id.includes('gpt-4o-mini'))?.id ?? models[0].id
      await page.evaluate(async (modelId) => {
        await window.llm.setSelectedModel('openai', modelId)
      }, chosenModel)

      const result = await page.evaluate(async () => {
        return window.llm.classifyPreview({
          terminalId: 'live-smoke-terminal',
          workspacePath: 'D:/4. Workspace/PromptManager',
          patternName: 'Approve changes?',
          matchedText: 'Approve changes?',
          recentOutput: [
            'Created patch for auth middleware.',
            'Approve changes?',
            'Please confirm whether to apply the patch.'
          ].join('\n')
        })
      })

      expect(['llm', 'no-api']).toContain(result.source)
      expect(typeof result.summary).toBe('string')
      expect(result.summary.length).toBeGreaterThan(0)
      expect(['approval', 'input-needed', 'error', 'unknown']).toContain(result.category)
      expect(['low', 'medium', 'high']).toContain(result.confidence)

      const stateAfterUse = await page.evaluate(async () => {
        return window.llm.getSettingsState()
      })
      expect(stateAfterUse.providers.openai.apiKeyStored).toBe(true)
      if (result.source === 'llm') {
        expect(stateAfterUse.usage.openai.requestCount).toBeGreaterThan(0)
      }

      await page.evaluate(async () => {
        await window.llm.clearApiKey('openai')
      })

      const stateAfterClear = await page.evaluate(async () => {
        return window.llm.getSettingsState()
      })
      expect(stateAfterClear.providers.openai.apiKeyStored).toBe(false)
    } finally {
      await closeApp(app)
    }
  })
})
