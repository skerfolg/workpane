import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const mainPath = path.join(__dirname, '../../../out/main/index.js')

  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return { app, page }
}

export async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close()
}

/**
 * Opens the first recent workspace from the Welcome screen
 * and waits for the main app layout (activity bar) to appear.
 */
export async function openRecentWorkspace(page: Page): Promise<void> {
  // Wait for welcome screen
  await page.waitForSelector('.welcome', { timeout: 15000 })

  // Click the first recent workspace item
  const recentItem = page.locator('.welcome__recent-item').first()
  await recentItem.waitFor({ state: 'visible', timeout: 10000 })
  await recentItem.click()

  // Wait for main layout to render
  await page.waitForSelector('.activity-bar', { timeout: 15000 })
}
