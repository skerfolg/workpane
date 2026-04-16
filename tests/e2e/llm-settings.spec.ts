import { test, expect } from '@playwright/test'
import { OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID } from '../../src/shared/types'
import { closeApp, launchApp, openRecentWorkspace } from './helpers/electron'

async function openSettings(page: Parameters<typeof openRecentWorkspace>[0]): Promise<void> {
  await openRecentWorkspace(page)
  await page.locator('.activity-bar__item').last().click()
  await page.waitForSelector('.settings-view', { timeout: 15000 })
}

test.describe('LLM Settings', () => {
  test('shows the official bridge lane with validationState observability fields', async () => {
    const { app, page } = await launchApp()

    try {
      await openSettings(page)

      const llmSection = page.locator('.settings-section').filter({ hasText: 'LLM Integration' })
      await expect(llmSection).toBeVisible()
      await expect(llmSection).toContainText('Secure Storage Status')
      await expect(llmSection).toContainText('Execution Lanes')
      await expect(llmSection).toContainText(/Managed by Codex CLI|Model selection in Codex/)

      await expect.poll(async () => {
        return page.evaluate(async (bridgeLaneId) => {
          const state = await window.llm.getSettingsState()
          const bridgeLane = state.executionLanes.find((lane) => lane.laneId === bridgeLaneId)
          return {
            hasOfficialClientLane: Boolean(bridgeLane),
            transport: bridgeLane?.transport ?? null,
            credentialStyle: bridgeLane?.credentialStyle ?? null,
            validationStateKeys: bridgeLane ? Object.keys(bridgeLane.validationState).sort() : [],
            hasPersistedModelField: bridgeLane
              ? 'selectedModel' in (bridgeLane as Record<string, unknown>) || 'modelId' in (bridgeLane as Record<string, unknown>)
              : null
          }
        }, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
      }).toEqual({
        hasOfficialClientLane: true,
        transport: 'official_client_bridge',
        credentialStyle: 'provider_session',
        validationStateKeys: ['detail', 'lastValidatedAt', 'status'],
        hasPersistedModelField: false
      })
    } finally {
      await closeApp(app)
    }
  })

  test('exposes bridge lifecycle controls, omits removed provider mutators, and supports refresh-state alias parity', async () => {
    const { app, page } = await launchApp()

    try {
      await openSettings(page)

      const llmSection = page.locator('.settings-section').filter({ hasText: 'LLM Integration' })
      await expect(llmSection).toBeVisible()
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

      const parity = await page.evaluate(async (bridgeLaneId) => {
        const byIdentifier = await window.llm['refresh-state'](bridgeLaneId)
        const byMethod = await window.llm.refreshState(bridgeLaneId)
        return {
          aliasLaneId: byIdentifier.laneId,
          methodLaneId: byMethod.laneId,
          aliasValidationKeys: Object.keys(byIdentifier.validationState).sort(),
          methodValidationKeys: Object.keys(byMethod.validationState).sort()
        }
      }, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)

      expect(parity).toEqual({
        aliasLaneId: OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
        methodLaneId: OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID,
        aliasValidationKeys: ['detail', 'lastValidatedAt', 'status'],
        methodValidationKeys: ['detail', 'lastValidatedAt', 'status']
      })
    } finally {
      await closeApp(app)
    }
  })

  test('connect and disconnect use the runtime bridge path without leaving a stale pending banner', async () => {
    const { app, page } = await launchApp()

    try {
      await openSettings(page)

      const llmSection = page.locator('.settings-section').filter({ hasText: 'LLM Integration' })
      await expect(llmSection).toBeVisible()

      await llmSection.getByRole('button', { name: /^Connect$/i }).click()
      await expect(llmSection).toContainText(/Pending user action in terminal/i)

      await llmSection.getByRole('button', { name: /Refresh State/i }).click()
      await expect(llmSection).not.toContainText(/Pending user action in terminal/i)

      await llmSection.getByRole('button', { name: /Disconnect \(local only\)/i }).click()
      await expect(llmSection).not.toContainText(/Pending user action in terminal/i)
    } finally {
      await closeApp(app)
    }
  })

  test('records connected bridge validation state and surfaces the observability detail', async () => {
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
                detail: 'Authenticated via Codex CLI',
                lastValidatedAt: '2026-04-16T05:34:14.000Z'
              }
            }
          })
        }

        await window.settings.set('llm', nextState)
      }, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('.activity-bar__item').last().click()
      await page.waitForSelector('.settings-view', { timeout: 15000 })

      await expect.poll(async () => {
        return page.evaluate(async (bridgeLaneId) => {
          const current = await window.llm.getSettingsState()
          const bridgeLane = current.executionLanes.find((lane) => lane.laneId === bridgeLaneId)
          return bridgeLane?.validationState ?? null
        }, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
      }).toEqual({
        status: 'connected',
        detail: 'Authenticated via Codex CLI',
        lastValidatedAt: '2026-04-16T05:34:14.000Z'
      })

      const llmSection = page.locator('.settings-section').filter({ hasText: 'LLM Integration' })
      await expect(llmSection).toContainText(/connected/i)
      await expect(llmSection).toContainText('Authenticated via Codex CLI')
      await expect(llmSection).toContainText(/local[- ]only/i)
    } finally {
      await closeApp(app)
    }
  })

  test('refresh state updates the official bridge lane through the real runtime path', async () => {
    const { app, page } = await launchApp()

    try {
      await openSettings(page)

      const refreshedLane = await page.evaluate(async (bridgeLaneId) => {
        return window.llm.refreshState(bridgeLaneId)
      }, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)

      expect(refreshedLane.laneId).toBe(OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
      expect(Object.keys(refreshedLane.validationState).sort()).toEqual(['detail', 'lastValidatedAt', 'status'])

      await expect.poll(async () => {
        return page.evaluate(async (bridgeLaneId) => {
          const state = await window.llm.getSettingsState()
          const bridgeLane = state.executionLanes.find((lane) => lane.laneId === bridgeLaneId)
          return bridgeLane?.validationState ?? null
        }, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID)
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
