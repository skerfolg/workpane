import { test, expect } from '@playwright/test'
import { closeApp, launchApp, openRecentWorkspace } from './helpers/electron'

test.describe('LLM Settings', () => {
  test('shows LLM integration section with storage status', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)
      await page.locator('.activity-bar__item').last().click()
      await page.waitForSelector('.settings-view', { timeout: 15000 })

      const llmSection = page.locator('.settings-section').filter({ hasText: 'LLM Integration' })
      await expect(llmSection).toBeVisible()
      await expect(llmSection).toContainText('Secure Storage Status')
      await expect(llmSection).toContainText('Preferred Provider')
    } finally {
      await closeApp(app)
    }
  })

  test('updates consent through renderer/main llm bridge', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)
      await page.locator('.activity-bar__item').last().click()
      await page.waitForSelector('.settings-view', { timeout: 15000 })

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
