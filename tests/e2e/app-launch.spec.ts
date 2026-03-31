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

      // Activity bar should be visible after opening workspace
      await expect(page.locator('.activity-bar')).toBeVisible()

      // Should have 5 items: explorer, kanban, search, skills, settings
      const items = page.locator('.activity-bar__item')
      await expect(items).toHaveCount(5)

      await page.screenshot({ path: 'artifacts/02-main-app.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('welcome skills info text is in English', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForSelector('.welcome', { timeout: 15000 })

      const skillsInfo = page.locator('.welcome__skills-info span')
      await expect(skillsInfo).toContainText('Open a workspace to browse and install coding agent skills')

      await page.screenshot({ path: 'artifacts/03-welcome-skills-info.png' })
    } finally {
      await closeApp(app)
    }
  })
})
