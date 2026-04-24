import { test, expect, Page } from '@playwright/test'
import {
  closeApp,
  emitRendererL0StatusChanged,
  launchApp,
  resetWorkspaceStateFile,
  WORKSPACE_PATH
} from './helpers/electron'

async function openWorkspaceWithSingleTerminal(page: Page, terminalId: string): Promise<void> {
  await resetWorkspaceStateFile(page, {
    version: 2,
    editorTabs: [],
    activeEditorFilePath: null,
    terminals: [{ id: terminalId, name: 'Claude Code' }],
    groups: [
      {
        id: 'group-1',
        name: 'Group 1',
        layoutTree: {
          type: 'leaf',
          panelId: 'panel-1',
          terminalIds: [terminalId],
          browserIds: [],
          activeTerminalId: terminalId
        },
        terminalIds: [terminalId],
        activeTerminalId: terminalId,
        focusedPanelId: 'panel-1',
        collapsed: false
      }
    ],
    activeGroupId: 'group-1'
  })
  try {
    await page.waitForSelector('.welcome', { timeout: 15000 })
  } catch {
    // Welcome paint can be skipped under fast launches.
  }
  await page.evaluate(async (workspacePath) => {
    await window.workspace.openPath(workspacePath)
  }, WORKSPACE_PATH)
  await page.waitForSelector('.activity-bar', { timeout: 15000 })
  await page.waitForTimeout(1000)
}

test.describe('M1c L0 CC stream-json badge flow', () => {
  test('DP-2 badge progresses from ready to vendor-event on status events', async () => {
    test.setTimeout(120000)
    const { app, page } = await launchApp()

    try {
      const terminalId = 'terminal-cc-stream'
      await openWorkspaceWithSingleTerminal(page, terminalId)

      const badge = page.locator('[data-testid="l0-status-badge"]')

      // No L0 status emitted yet → badge hidden (mode='inactive' implicit).
      await expect(badge).toHaveCount(0)

      // Vendor hint arrived but first event has not fingerprinted yet.
      await emitRendererL0StatusChanged(app, {
        terminalId,
        mode: 'awaiting-first-event',
        vendor: 'claude-code'
      })
      await expect(badge).toBeVisible({ timeout: 5000 })
      await expect(badge).toHaveAttribute('data-l0-mode', 'awaiting-first-event')
      await expect(badge).toContainText('L0 ready')

      // First event arrives, adapter locks the schema fingerprint.
      await emitRendererL0StatusChanged(app, {
        terminalId,
        mode: 'active',
        vendor: 'claude-code',
        fingerprint: 'a1b2c3d4e5f6'
      })
      await expect(badge).toHaveAttribute('data-l0-mode', 'active')
      await expect(badge).toContainText('L0 vendor-event')
      await expect(badge).toHaveAttribute('title', /fingerprint: a1b2c3d4e5f6/)
    } finally {
      await closeApp(app)
    }
  })
})
