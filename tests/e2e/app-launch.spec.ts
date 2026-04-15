import { test, expect } from '@playwright/test'
import { launchApp, closeApp, openRecentWorkspace } from './helpers/electron'

test.describe('App Launch', () => {
  test('shows welcome screen on startup', async () => {
    const { app, page } = await launchApp()

    try {
      // Welcome screen should be visible before opening a workspace
      await expect(page.locator('.welcome')).toBeVisible({ timeout: 15000 })
      await expect(page.locator('.welcome__title')).toBeVisible()
      await expect(page.locator('.welcome__btn--primary')).toBeVisible()

      await page.screenshot({ path: 'artifacts/01-welcome-screen.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('opens workspace and shows activity bar', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await expect(page.locator('.activity-bar')).toBeVisible()
      await expect(page.locator('.activity-bar__item')).toHaveCount(3)
      await expect(page.locator('[data-testid="activity-bar-explorer"]')).toBeVisible()
      await expect(page.locator('[data-testid="activity-bar-search"]')).toBeVisible()
      await expect(page.locator('[data-testid="activity-bar-settings"]')).toBeVisible()
      await expect(page.locator('[data-testid="activity-bar-skills"]')).toHaveCount(0)
      await expect(page.locator('.sidebar')).toBeVisible()
      await expect(page.locator('.sidebar')).toContainText('Terminal')
      await expect(page.locator('.sidebar')).toContainText('File Explorer')
      await expect(page.locator('.sidebar__explorer > .sidebar__section')).toHaveCount(2)
      await expect(page.locator('.status-bar')).toBeVisible()

      await page.screenshot({ path: 'artifacts/02-main-app.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('welcome screen keeps workspace-first copy only', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForSelector('.welcome', { timeout: 15000 })
      await expect(page.locator('.welcome__subtitle')).toBeVisible()
      await expect(page.locator('.welcome__btn--primary')).toBeVisible()
      await expect(page.locator('.welcome__skills-info')).toHaveCount(0)

      await page.screenshot({ path: 'artifacts/03-welcome-skills-info.png' })
    } finally {
      await closeApp(app)
    }
  })
})
