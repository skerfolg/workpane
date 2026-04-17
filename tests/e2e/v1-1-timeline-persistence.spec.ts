import { test, expect } from '@playwright/test'
import { closeApp, launchApp, openRecentWorkspace, invokeMonitoringTestTransition } from './helpers/electron'

test.describe('v1.1 Timeline Persistence', () => {
  test('shows persisted timeline events after renderer reload', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await invokeMonitoringTestTransition(page, {
        terminalId: 'terminal-1',
        workspacePath: 'D:/4. Workspace/PromptManager',
        kind: 'entered',
        category: 'approval',
        confidence: 'high',
        source: 'llm',
        summary: 'Approval needed',
        patternName: 'Approve changes?',
        matchedText: 'Approve changes?'
      })

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.activity-bar', { timeout: 15000 })

      const storedEvents = await page.evaluate(async () => {
        return window.monitoringHistory.listSessionEvents('terminal-1', 'all', 10)
      })
      expect(storedEvents.length).toBeGreaterThan(0)

      await page.getByText('Terminal 1').first().click()

      await page.getByTestId('terminal-persisted-timeline-toggle').first().click({ force: true })
      await expect(page.getByText(/Entered · Approval needed/i)).toBeVisible()
      await expect(page.getByText(/entered · llm classification · high confidence/i)).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })
})
