import { test, expect } from '@playwright/test'
import { closeApp, launchApp, openRecentWorkspace } from './helpers/electron'

test.describe('v1.1 Queue Manual Tasks', () => {
  test('adds and completes a manual task from the sidebar queue', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await page.evaluate(async () => {
        await window.monitoringHistory.createManualTask(
          'Follow up review',
          'Check the persistent timeline output'
        )
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.activity-bar', { timeout: 15000 })

      const queue = page.getByTestId('monitoring-queue')
      await expect(queue).toContainText('Follow up review')
      await expect(queue).toContainText('manual task')

      await page.evaluate(async () => {
        const tasks = await window.monitoringHistory.listManualTasks()
        const target = tasks.find((task) => task.title === 'Follow up review')
        if (target) {
          await window.monitoringHistory.completeManualTask(target.id)
        }
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.activity-bar', { timeout: 15000 })

      await expect(queue).toContainText('Recent completed')
      await expect(queue).toContainText('Follow up review')
    } finally {
      await closeApp(app)
    }
  })
})
