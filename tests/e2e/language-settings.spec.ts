import { test, expect } from '@playwright/test'
import { launchApp, closeApp, openRecentWorkspace } from './helpers/electron'

async function setLanguage(page: Parameters<typeof openRecentWorkspace>[0], language: 'en' | 'ko'): Promise<void> {
  await page.evaluate(async (value) => {
    await window.settings.set('general.language', value)
  }, language)
}

test.describe('Language Settings', () => {
  test('activity bar tooltips follow persisted English language', async () => {
    const { app, page } = await launchApp()

    try {
      await setLanguage(page, 'en')
      await openRecentWorkspace(page)

      await expect(page.locator('.activity-bar__item')).toHaveCount(3)
      await expect(page.locator('[data-testid="activity-bar-explorer"]')).toHaveAttribute('title', 'Explorer')
      await expect(page.locator('[data-testid="activity-bar-search"]')).toHaveAttribute('title', 'Search')
      await expect(page.locator('[data-testid="activity-bar-settings"]')).toHaveAttribute('title', 'Settings')
      await expect(page.locator('[data-testid="activity-bar-kanban"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="activity-bar-skills"]')).toHaveCount(0)

      await page.screenshot({ path: 'artifacts/04-tooltips-english.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('changing language to Korean updates tooltips immediately', async () => {
    const { app, page } = await launchApp()

    try {
      await setLanguage(page, 'en')
      await openRecentWorkspace(page)

      await page.locator('[data-testid="activity-bar-settings"]').click()
      await page.waitForSelector('.settings-view', { timeout: 15000 })

      const langSelect = page.locator('select').first()
      await langSelect.selectOption('ko')

      await expect(page.locator('[data-testid="activity-bar-explorer"]')).toHaveAttribute('title', '탐색기')
      await expect(page.locator('[data-testid="activity-bar-search"]')).toHaveAttribute('title', '검색')
      await expect(page.locator('[data-testid="activity-bar-settings"]')).toHaveAttribute('title', '설정')
      await expect(page.locator('[data-testid="activity-bar-skills"]')).toHaveCount(0)

      await page.screenshot({ path: 'artifacts/05-tooltips-korean.png' })

      await langSelect.selectOption('en')
      await expect(page.locator('[data-testid="activity-bar-explorer"]')).toHaveAttribute('title', 'Explorer')
      await expect(page.locator('[data-testid="activity-bar-search"]')).toHaveAttribute('title', 'Search')
      await expect(page.locator('[data-testid="activity-bar-settings"]')).toHaveAttribute('title', 'Settings')

      await page.screenshot({ path: 'artifacts/06-tooltips-back-english.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('settings view has language selector with English and Korean options', async () => {
    const { app, page } = await launchApp()

    try {
      await setLanguage(page, 'en')
      await openRecentWorkspace(page)

      await page.locator('[data-testid="activity-bar-settings"]').click()
      await page.waitForSelector('.settings-view', { timeout: 15000 })

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
