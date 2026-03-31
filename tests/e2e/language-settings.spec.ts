import { test, expect } from '@playwright/test'
import { launchApp, closeApp, openRecentWorkspace } from './helpers/electron'

test.describe('Language Settings', () => {
  test('activity bar tooltips are in English by default', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      // Settings button tooltip should be English (saved setting is 'en')
      const settingsBtn = page.locator('.activity-bar__item').last()
      await expect(settingsBtn).toHaveAttribute('title', 'Settings')

      await page.screenshot({ path: 'artifacts/04-tooltips-english.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('changing language to Korean updates tooltips immediately', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      // Open settings (last item)
      await page.locator('.activity-bar__item').last().click()
      await page.waitForSelector('.settings-view', { timeout: 5000 })

      // Switch to Korean
      const langSelect = page.locator('select').first()
      await langSelect.selectOption('ko')

      // Tooltip should update immediately
      const settingsBtn = page.locator('.activity-bar__item').last()
      await expect(settingsBtn).toHaveAttribute('title', '설정')

      await page.screenshot({ path: 'artifacts/05-tooltips-korean.png' })

      // Switch back to English
      await langSelect.selectOption('en')
      await expect(settingsBtn).toHaveAttribute('title', 'Settings')

      await page.screenshot({ path: 'artifacts/06-tooltips-back-english.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('settings view has language selector with English and Korean options', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await page.locator('.activity-bar__item').last().click()
      await page.waitForSelector('.settings-view', { timeout: 5000 })

      const langSelect = page.locator('select').first()
      await expect(langSelect).toBeVisible()

      const options = langSelect.locator('option')
      await expect(options).toHaveCount(2)
      await expect(options.nth(0)).toHaveAttribute('value', 'en')
      await expect(options.nth(1)).toHaveAttribute('value', 'ko')

      await page.screenshot({ path: 'artifacts/07-settings-language-selector.png' })
    } finally {
      await closeApp(app)
    }
  })
})
