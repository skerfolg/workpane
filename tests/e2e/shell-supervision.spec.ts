import { test, expect } from '@playwright/test'
import { launchApp, closeApp, openRecentWorkspace } from './helpers/electron'

test.describe('Supervision Shell', () => {
  test('renders only supervision-first shell navigation', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await expect(page.locator('.activity-bar__item')).toHaveCount(3)
      await expect(page.locator('[data-testid="activity-bar-explorer"]')).toBeVisible()
      await expect(page.locator('[data-testid="activity-bar-search"]')).toBeVisible()
      await expect(page.locator('[data-testid="activity-bar-settings"]')).toBeVisible()
      await expect(page.locator('[data-testid="activity-bar-kanban"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="activity-bar-skills"]')).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })

  test('settings remains reachable from the surviving shell', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await page.locator('[data-testid="activity-bar-settings"]').click()
      await expect(page.locator('.settings-view')).toBeVisible({ timeout: 5000 })
      await expect(page.locator('select').first()).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('explorer shell keeps terminal and file explorer surfaces', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await page.locator('[data-testid="activity-bar-explorer"]').click()
      await expect(
        page.locator('.sidebar__section-header').filter({ hasText: 'Terminal' }).first()
      ).toBeVisible()
      await expect(
        page.locator('.sidebar__section-header').filter({ hasText: 'File Explorer' }).first()
      ).toBeVisible()
      await expect(page.locator('.status-bar')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })
})
