import { test, expect } from '@playwright/test'
import { closeApp, launchApp, openRecentWorkspace } from './helpers/electron'

test.describe('Search Surviving Scopes', () => {
  test('keeps search usable with surviving scopes and opens a source result', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await page.locator('[data-testid="activity-bar-search"]').click()

      const scopeButtons = page.locator('.search-view__scope-btn')
      await expect(scopeButtons).toHaveCount(2)
      await expect(scopeButtons.filter({ hasText: 'Docs' })).toBeVisible()
      await expect(scopeButtons.filter({ hasText: 'Source' })).toBeVisible()
      await expect(scopeButtons.filter({ hasText: 'Issues' })).toHaveCount(0)

      const queryInput = page.locator('.search-view__input').first()
      await queryInput.fill('workspace:open-path')
      await queryInput.press('Enter')

      const firstMatch = page.locator('.search-view__match').first()
      await expect(firstMatch).toBeVisible()
      await firstMatch.click()

      await expect(page.locator('.markdown-area [role="tab"][aria-selected="true"]')).toContainText('index.ts')
    } finally {
      await closeApp(app)
    }
  })
})
