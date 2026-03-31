import { test, expect } from '@playwright/test'
import { launchApp, closeApp, openRecentWorkspace } from './helpers/electron'

test.describe('Skills Tab', () => {
  test('skills icon tooltip is "Skills"', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      const skillsBtn = page.locator('.activity-bar__item').nth(3)
      await expect(skillsBtn).toHaveAttribute('title', 'Skills')

      await page.screenshot({ path: 'artifacts/08-skills-icon.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('skills view opens on click', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await page.locator('.activity-bar__item').nth(3).click()
      await expect(page.locator('.skills-view')).toBeVisible({ timeout: 5000 })

      await page.screenshot({ path: 'artifacts/09-skills-view.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('skills view loads workpane-issue from local registry', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await page.locator('.activity-bar__item').nth(3).click()
      await page.waitForSelector('.skills-view', { timeout: 5000 })

      // Wait for loading to finish
      await page.waitForSelector('.skills-view__loading', { state: 'detached', timeout: 15000 })
        .catch(() => { /* loading indicator may not exist if load is instant */ })

      // No error should be shown
      await expect(page.locator('.skills-view__error')).not.toBeVisible()

      // workpane-issue skill card should appear
      await expect(page.locator('.skill-card').first()).toBeVisible({ timeout: 10000 })
      await expect(page.locator('.skill-card').first()).toContainText('workpane-issue')

      await page.screenshot({ path: 'artifacts/10-skills-loaded.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('skills search filters results', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await page.locator('.activity-bar__item').nth(3).click()
      await page.waitForSelector('.skill-card', { timeout: 15000 })

      const searchInput = page.locator('.skills-view input[type="text"], .skills-view input[placeholder]').first()

      // Search existing skill
      await searchInput.fill('workpane')
      await expect(page.locator('.skill-card')).toBeVisible()

      // Search non-existent
      await searchInput.fill('zzznomatch')
      await expect(page.locator('.skill-card')).not.toBeVisible()

      await page.screenshot({ path: 'artifacts/11-skills-search.png' })
    } finally {
      await closeApp(app)
    }
  })
})
