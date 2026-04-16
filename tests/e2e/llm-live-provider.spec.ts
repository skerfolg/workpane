import { test, expect } from '@playwright/test'
import { OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID } from '../../src/shared/types'
import { closeApp, launchApp, openRecentWorkspace } from './helpers/electron'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

// Non-gating smoke: keep this spec out of the deterministic CI/release gate pack.
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
        await window.llm.setLaneEnabled('openai/direct_http', true)
        await window.llm.setConsent(true)
        await window.llm.setApiKey('openai', apiKey)
      }, OPENAI_API_KEY)

      await expect.poll(async () => {
        return page.evaluate(async (bridgeLaneId) => {
          const state = await window.llm.getSettingsState()
          const directHttpLane = state.executionLanes.find((lane) => lane.laneId === 'openai/direct_http')
          const bridgeLane = state.executionLanes.find((lane) => lane.laneId === bridgeLaneId)
          return {
            directHttpEnabled: directHttpLane?.enabled ?? null,
            bridgeEnabled: bridgeLane?.enabled ?? null,
            directHttpTransport: directHttpLane?.transport ?? null,
            bridgeTransport: bridgeLane?.transport ?? null
          }
        }, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
      }).toEqual({
        directHttpEnabled: true,
        bridgeEnabled: false,
        directHttpTransport: 'direct_http',
        bridgeTransport: 'official_client_bridge'
      })

      const models = await page.evaluate(async () => {
        return window.llm.listModels('openai')
      })
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)

      const chosenModel = models.find((model) => model.id.includes('gpt-4o-mini'))?.id ?? models[0].id
      await page.evaluate(async (modelId) => {
        await window.llm.setSelectedModel('openai', modelId)
      }, chosenModel)

      const stateAfterModelSelection = await page.evaluate(async (bridgeLaneId) => {
        const state = await window.llm.getSettingsState()
        const bridgeLane = state.executionLanes.find((lane) => lane.laneId === bridgeLaneId)
        return {
          selectedModel: state.providers.openai.selectedModel,
          bridgeHasPersistedModelField: bridgeLane
            ? 'selectedModel' in (bridgeLane as Record<string, unknown>) || 'modelId' in (bridgeLane as Record<string, unknown>)
            : false
        }
      }, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
      expect(stateAfterModelSelection.selectedModel).toBe(chosenModel)
      expect(stateAfterModelSelection.bridgeHasPersistedModelField).toBe(false)

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

      await expect.poll(async () => {
        const stateAfterUse = await page.evaluate(async () => {
          return window.llm.getSettingsState()
        })
        return stateAfterUse.providers.openai.apiKeyStored
      }).toBe(true)
      if (result.source === 'llm') {
        const stateAfterUse = await page.evaluate(async () => {
          return window.llm.getSettingsState()
        })
        expect(stateAfterUse.usage.openai.requestCount).toBeGreaterThan(0)
      }

      await page.evaluate(async () => {
        await window.llm.clearApiKey('openai')
      })

      await expect.poll(async () => {
        const stateAfterClear = await page.evaluate(async () => {
          return window.llm.getSettingsState()
        })
        return stateAfterClear.providers.openai.apiKeyStored
      }).toBe(false)
    } finally {
      await closeApp(app)
    }
  })
})
