import { test, expect } from '@playwright/test'
import { closeApp, launchApp, openRecentWorkspace, invokeMonitoringTestUpsert } from './helpers/electron'

test.describe('v1.1 Mission Control', () => {
  test('opens the overlay, prioritizes pending sessions, and closes on card click', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await invokeMonitoringTestUpsert(page, {
        terminalId: 'terminal-1',
        workspacePath: 'D:/4. Workspace/PromptManager',
        patternName: 'Approve changes?',
        matchedText: 'Approve changes?',
        category: 'approval',
        confidence: 'high',
        source: 'llm',
        summary: 'Approval needed'
      })

      await page.getByTestId('activity-bar-mission-control').click()
      const dialog = page.getByRole('dialog', { name: 'Mission Control' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('Mission Control')
      await expect(dialog.locator('.mission-control__card--attention')).toContainText('Pending')

      await dialog.locator('.mission-control__card').first().click()
      await expect(dialog).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })
})
