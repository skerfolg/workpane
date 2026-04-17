import { test, expect } from '@playwright/test'
import {
  GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
  OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID
} from '../../src/shared/types'
import { closeApp, launchApp, openRecentWorkspace } from './helpers/electron'

async function openSettings(page: Parameters<typeof openRecentWorkspace>[0]): Promise<void> {
  await openRecentWorkspace(page)
  await page.locator('.activity-bar__item').last().click()
  await page.waitForSelector('.settings-view', { timeout: 15000 })
}

test.describe('LLM Settings', () => {
  test('shows both official bridge lanes with validationState observability fields', async () => {
    const { app, page } = await launchApp()

    try {
      await openSettings(page)

      const llmSection = page.locator('.settings-section').filter({ hasText: 'LLM Integration' })
      await expect(llmSection).toBeVisible()
      await expect(llmSection).toContainText('Secure Storage Status')
      await expect(llmSection).toContainText('Execution Lanes')
      await expect(llmSection).toContainText(/Managed by Codex CLI|Model selection in Codex/)
      await expect(llmSection).toContainText(/Managed by Gemini CLI/)

      await expect.poll(async () => {
        return page.evaluate(async (bridgeLaneIds) => {
          const state = await window.llm.getSettingsState()
          const bridgeLanes = bridgeLaneIds.map((bridgeLaneId: string) =>
            state.executionLanes.find((lane) => lane.laneId === bridgeLaneId)
          )
          return {
            laneIds: bridgeLanes.map((lane) => lane?.laneId ?? null),
            transports: bridgeLanes.map((lane) => lane?.transport ?? null),
            credentialStyles: bridgeLanes.map((lane) => lane?.credentialStyle ?? null),
            validationStateKeys: bridgeLanes.map((lane) => lane ? Object.keys(lane.validationState).sort() : []),
            hasPersistedModelField: bridgeLanes.map((lane) =>
              lane
                ? 'selectedModel' in (lane as Record<string, unknown>) || 'modelId' in (lane as Record<string, unknown>)
                : null
            )
          }
        }, [GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID])
      }).toEqual({
        laneIds: [GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID],
        transports: ['official_client_bridge', 'official_client_bridge'],
        credentialStyles: ['provider_session', 'provider_session'],
        validationStateKeys: [
          ['detail', 'lastValidatedAt', 'status'],
          ['detail', 'lastValidatedAt', 'status']
        ],
        hasPersistedModelField: [false, false]
      })
    } finally {
      await closeApp(app)
    }
  })

  test('exposes multi-bridge lifecycle controls, omits removed provider mutators, and supports refresh-state alias parity', async () => {
    const { app, page } = await launchApp()

    try {
      await openSettings(page)

      const llmSection = page.locator('.settings-section').filter({ hasText: 'LLM Integration' })
      await expect(llmSection).toBeVisible()
      await expect(llmSection).toContainText('Google Gemini · official_client_bridge')
      await expect(llmSection).toContainText('OpenAI · official_client_bridge')
      await expect(llmSection).toContainText(/Validate/i)
      await expect(llmSection).toContainText(/Refresh state|Refresh/i)
      await expect(llmSection).toContainText(/Disconnect/i)
      await expect(llmSection).toContainText(/local[- ]only/i)

      const publicSurface = await page.evaluate(() => ({
        hasConnect: typeof (window.llm as unknown as Record<string, unknown>).connect === 'function',
        hasDisconnect: typeof (window.llm as unknown as Record<string, unknown>).disconnect === 'function',
        hasValidate: typeof (window.llm as unknown as Record<string, unknown>).validate === 'function',
        hasSetLaneEnabled: typeof (window.llm as unknown as Record<string, unknown>).setLaneEnabled === 'function',
        hasMoveLane: typeof (window.llm as unknown as Record<string, unknown>).moveLane === 'function',
        hasSetProviderEnabled:
          typeof (window.llm as unknown as Record<string, unknown>).setProviderEnabled === 'function',
        hasSetSelectedProvider:
          typeof (window.llm as unknown as Record<string, unknown>).setSelectedProvider === 'function',
        hasSetFallbackOrder:
          typeof (window.llm as unknown as Record<string, unknown>).setFallbackOrder === 'function',
        hasRefreshState:
          typeof (window.llm as unknown as Record<string, unknown>).refreshState === 'function' ||
          typeof (window.llm as unknown as Record<string, unknown>)['refresh-state'] === 'function'
      }))

      expect(publicSurface).toEqual({
        hasConnect: true,
        hasDisconnect: true,
        hasValidate: true,
        hasSetLaneEnabled: true,
        hasMoveLane: true,
        hasSetProviderEnabled: false,
        hasSetSelectedProvider: false,
        hasSetFallbackOrder: false,
        hasRefreshState: true
      })

      const parity = await page.evaluate(async (bridgeLaneIds) => {
        return await Promise.all(bridgeLaneIds.map(async (bridgeLaneId: string) => {
          const byIdentifier = await window.llm['refresh-state'](bridgeLaneId)
          const byMethod = await window.llm.refreshState(bridgeLaneId)
          return {
            aliasLaneId: byIdentifier.laneId,
            methodLaneId: byMethod.laneId,
            aliasValidationKeys: Object.keys(byIdentifier.validationState).sort(),
            methodValidationKeys: Object.keys(byMethod.validationState).sort()
          }
        }))
      }, [GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID])

      expect(parity).toEqual([
        {
          aliasLaneId: GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
          methodLaneId: GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
          aliasValidationKeys: ['detail', 'lastValidatedAt', 'status'],
          methodValidationKeys: ['detail', 'lastValidatedAt', 'status']
        },
        {
          aliasLaneId: OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
          methodLaneId: OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
          aliasValidationKeys: ['detail', 'lastValidatedAt', 'status'],
          methodValidationKeys: ['detail', 'lastValidatedAt', 'status']
        }
      ])
    } finally {
      await closeApp(app)
    }
  })

  test('Gemini connect guidance stays visible from an unauthenticated state and clears after follow-up actions', async () => {
    const { app, page } = await launchApp()

    try {
      await openSettings(page)

      await page.evaluate(async (bridgeLaneId) => {
        const current = await window.llm.getSettingsState()
        const nextState = {
          ...current,
          executionLanes: current.executionLanes.map((lane) => {
            if (lane.laneId !== bridgeLaneId) {
              return lane
            }

            return {
              ...lane,
              enabled: false,
              validationState: {
                status: 'unauthenticated',
                detail: 'Sign in with Google to continue.',
                lastValidatedAt: '2026-04-17T00:20:00.000Z'
              }
            }
          })
        }

        await window.settings.set('llm', nextState)
      }, GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('.activity-bar__item').last().click()
      await page.waitForSelector('.settings-view', { timeout: 15000 })

      const geminiBridgeSection = page.locator('.settings-row--column').filter({
        has: page.locator('.settings-row__label', { hasText: 'Google Gemini · official_client_bridge' })
      })
      await expect(geminiBridgeSection).toBeVisible()
      await expect(geminiBridgeSection).toContainText(/Sign in with Google to continue/i)

      await geminiBridgeSection.getByRole('button', { name: /^Connect$/i }).click()
      await expect(geminiBridgeSection).toContainText(/Pending user action in terminal/i)
      await expect(geminiBridgeSection).toContainText(/Sign in with Google/i)

      await geminiBridgeSection.getByRole('button', { name: /Refresh State/i }).click()
      await expect(geminiBridgeSection).not.toContainText(/Pending user action in terminal/i)

      await geminiBridgeSection.getByRole('button', { name: /Disconnect \(local only\)/i }).click()
      await expect(geminiBridgeSection).not.toContainText(/Pending user action in terminal/i)
    } finally {
      await closeApp(app)
    }
  })

  test('records connected Gemini bridge validation state and surfaces the observability detail', async () => {
    const { app, page } = await launchApp()

    try {
      await openSettings(page)

      await page.evaluate(async (bridgeLaneId) => {
        const current = await window.llm.getSettingsState()
        const nextState = {
          ...current,
          executionLanes: current.executionLanes.map((lane) => {
            if (lane.laneId !== bridgeLaneId) {
              return lane
            }

            return {
              ...lane,
              enabled: true,
              validationState: {
                status: 'connected',
                detail: 'Authenticated via Gemini CLI',
                lastValidatedAt: '2026-04-16T05:34:14.000Z'
              }
            }
          })
        }

        await window.settings.set('llm', nextState)
      }, GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('.activity-bar__item').last().click()
      await page.waitForSelector('.settings-view', { timeout: 15000 })

      await expect.poll(async () => {
        return page.evaluate(async (bridgeLaneId) => {
          const current = await window.llm.getSettingsState()
          const bridgeLane = current.executionLanes.find((lane) => lane.laneId === bridgeLaneId)
          return bridgeLane?.validationState ?? null
        }, GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
      }).toEqual({
        status: 'connected',
        detail: 'Authenticated via Gemini CLI',
        lastValidatedAt: '2026-04-16T05:34:14.000Z'
      })

      const geminiBridgeSection = page.locator('.settings-row--column').filter({
        has: page.locator('.settings-row__label', { hasText: 'Google Gemini · official_client_bridge' })
      })
      await expect(geminiBridgeSection).toContainText(/connected/i)
      await expect(geminiBridgeSection).toContainText('Authenticated via Gemini CLI')
      await expect(geminiBridgeSection).toContainText(/local[- ]only/i)
    } finally {
      await closeApp(app)
    }
  })

  test('refresh state updates the Gemini official bridge lane through the real runtime path', async () => {
    const { app, page } = await launchApp()

    try {
      await openSettings(page)

      const refreshedLane = await page.evaluate(async (bridgeLaneId) => {
        return window.llm.refreshState(bridgeLaneId)
      }, GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)

      expect(refreshedLane.laneId).toBe(GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
      expect(Object.keys(refreshedLane.validationState).sort()).toEqual(['detail', 'lastValidatedAt', 'status'])

      await expect.poll(async () => {
        return page.evaluate(async (bridgeLaneId) => {
          const state = await window.llm.getSettingsState()
          const bridgeLane = state.executionLanes.find((lane) => lane.laneId === bridgeLaneId)
          return bridgeLane?.validationState ?? null
        }, GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
      }).toEqual(refreshedLane.validationState)
    } finally {
      await closeApp(app)
    }
  })

  test('updates consent through renderer/main llm bridge', async () => {
    const { app, page } = await launchApp()

    try {
      await openSettings(page)

      await page.evaluate(async () => {
        await window.llm.setConsent(true)
      })

      await expect.poll(async () => {
        const state = await page.evaluate(async () => {
          const current = await window.llm.getSettingsState()
          return current.consentEnabled
        })
        return state
      }).toBe(true)

      await page.evaluate(async () => {
        await window.llm.setConsent(false)
      })

      await expect.poll(async () => {
        const state = await page.evaluate(async () => {
          const current = await window.llm.getSettingsState()
          return current.consentEnabled
        })
        return state
      }).toBe(false)
    } finally {
      await closeApp(app)
    }
  })
})
