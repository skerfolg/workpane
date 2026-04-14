import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  closeApp,
  invokeMonitoringTestClear,
  invokeMonitoringTestUpsert,
  launchApp,
  resetWorkspaceStateFile
} from './helpers/electron'

const WORKSPACE_PATH = 'D:/4. Workspace/PromptManager'

async function seedWorkspace(page: Page): Promise<void> {
  await resetWorkspaceStateFile(page, {
    version: 2,
    editorTabs: [],
    activeEditorFilePath: null,
    terminals: [
      { id: 'terminal-1', name: 'Terminal 1' },
      { id: 'terminal-2', name: 'Terminal 2' },
      { id: 'terminal-3', name: 'Terminal 3' }
    ],
    groups: [
      {
        id: 'group-1',
        name: 'Group 1',
        layoutTree: {
          type: 'leaf',
          panelId: 'panel-1',
          terminalIds: ['terminal-1'],
          browserIds: [],
          activeTerminalId: 'terminal-1'
        },
        terminalIds: ['terminal-1'],
        activeTerminalId: 'terminal-1',
        focusedPanelId: 'panel-1',
        collapsed: false
      },
      {
        id: 'group-2',
        name: 'Group 2',
        layoutTree: {
          type: 'leaf',
          panelId: 'panel-2',
          terminalIds: ['terminal-2', 'terminal-3'],
          browserIds: [],
          activeTerminalId: 'terminal-2'
        },
        terminalIds: ['terminal-2', 'terminal-3'],
        activeTerminalId: 'terminal-2',
        focusedPanelId: 'panel-2',
        collapsed: false
      }
    ],
    activeGroupId: 'group-2'
  })
}

async function openWorkspaceWithBaseline(page: Page): Promise<void> {
  await page.waitForSelector('.welcome', { timeout: 15000 })
  await page.evaluate(async (workspacePath) => {
    await window.workspace.openPath(workspacePath)
  }, WORKSPACE_PATH)
  await seedWorkspace(page)
  await page.reload({ waitUntil: 'domcontentloaded' })

  try {
    await page.waitForSelector('.activity-bar', { timeout: 15000 })
  } catch {
    await page.evaluate(async (workspacePath) => {
      await window.workspace.openPath(workspacePath)
    }, WORKSPACE_PATH)
    await page.waitForSelector('.activity-bar', { timeout: 15000 })
  }
}

function statusBarFeedTrigger(page: Page): Locator {
  return page.locator('[data-testid="monitoring-global-feed-trigger"]').first()
}

function statusBarFeedPopover(page: Page): Locator {
  return page.locator(
    [
      '[data-testid=\"monitoring-global-feed\"]',
      '[aria-label=\"Workspace feed\"]',
      '[aria-label=\"Global monitoring feed\"]',
      '[aria-label=\"Monitoring workspace feed\"]',
      '.status-bar__monitoring-feed'
    ].join(', ')
  ).first()
}

function feedRow(page: Page, text: string): Locator {
  const popover = statusBarFeedPopover(page)
  return popover.locator(
    [
      '[data-testid=\"monitoring-global-feed-row\"]',
      '[role=\"button\"]',
      'button',
      '[role=\"listitem\"]',
      '.status-bar__monitoring-feed-row'
    ].join(', ')
  ).filter({ hasText: text }).first()
}

function groupHeader(page: Page, groupName: string): Locator {
  return page
    .locator('.terminal-tree__group')
    .filter({ has: page.locator('.terminal-tree__group-name', { hasText: groupName }) })
    .first()
}

function terminalRow(page: Page, terminalName: string): Locator {
  return page
    .locator('.terminal-tree__item')
    .filter({ has: page.locator('.terminal-tree__name', { hasText: terminalName }) })
    .first()
}

async function deleteTerminalFromTree(page: Page, terminalName: string): Promise<void> {
  const row = terminalRow(page, terminalName)
  await expect(row).toBeVisible({ timeout: 15000 })
  await row.click({ button: 'right' })
  await page.locator('.terminal-tree__context-menu .terminal-tree__context-item--danger').click()
}

test.describe('Slice 4 App-Wide In-Session Workspace Feed', () => {
  test('shows deterministic cross-terminal chronology, supports click-through, and avoids queue controls', async () => {
    test.setTimeout(120000)
    const { app, page } = await launchApp()

    try {
      await openWorkspaceWithBaseline(page)

      await invokeMonitoringTestUpsert(page, {
        terminalId: 'terminal-1',
        workspacePath: WORKSPACE_PATH,
        patternName: 'approval-prompt',
        matchedText: 'Apply this change? (y/n)',
        category: 'approval',
        confidence: 'low',
        source: 'no-api',
        summary: 'Possible approval needed',
        timestamp: 1000
      })

      await invokeMonitoringTestUpsert(page, {
        terminalId: 'terminal-2',
        workspacePath: WORKSPACE_PATH,
        patternName: 'approval-prompt',
        matchedText: 'Apply this change? (y/n)',
        category: 'approval',
        confidence: 'high',
        source: 'llm',
        summary: 'Approval needed',
        timestamp: 1000
      })

      await invokeMonitoringTestUpsert(page, {
        terminalId: 'terminal-3',
        workspacePath: WORKSPACE_PATH,
        patternName: 'command-error',
        matchedText: 'Command failed',
        category: 'error',
        confidence: 'high',
        source: 'llm',
        summary: 'Attention needed',
        timestamp: 900
      })

      await invokeMonitoringTestClear(page, {
        terminalId: 'terminal-3',
        reason: 'write',
        timestamp: 1100
      })
      await page.waitForTimeout(1000)

      const trigger = statusBarFeedTrigger(page)
      await expect(trigger).toContainText('Recent')
      await expect(trigger).toContainText('4')
      await expect(page.locator('.status-bar')).not.toContainText('llm classification')
      await trigger.click()

      const popover = statusBarFeedPopover(page)
      await expect(popover).toBeVisible()

      const popoverText = await popover.textContent()
      const clearedIndex = popoverText?.indexOf('Attention state cleared') ?? -1
      const terminal2Index = popoverText?.indexOf('Entered · Approval needed') ?? -1
      const terminal1Index = popoverText?.indexOf('Entered · Possible approval needed') ?? -1

      expect(clearedIndex).toBeGreaterThanOrEqual(0)
      expect(terminal2Index).toBeGreaterThanOrEqual(0)
      expect(terminal1Index).toBeGreaterThanOrEqual(0)
      expect(clearedIndex).toBeLessThan(terminal2Index)
      expect(terminal2Index).toBeLessThan(terminal1Index)

      await expect(popover).toContainText(/entered · llm classification · high confidence/i)
      await expect(popover).toContainText(/entered · no-api hint · low confidence/i)
      await expect(popover).toContainText(/cleared · after local input/i)
      await expect(popover).not.toContainText(/ack|assign|filter|bulk/i)

      const terminal1FeedRow = feedRow(page, 'Terminal 1')
      await expect(terminal1FeedRow).toBeVisible()
      await terminal1FeedRow.click()

      await expect(groupHeader(page, 'Group 1')).toHaveClass(/terminal-tree__group--active/)
      await expect(terminalRow(page, 'Terminal 1')).toHaveAttribute('aria-selected', 'true')

      await trigger.click()
      await deleteTerminalFromTree(page, 'Terminal 1')
      await trigger.click()

      const unavailableRow = feedRow(page, 'Terminal unavailable')
      await expect(unavailableRow).toBeVisible()
      await expect
        .poll(async () => {
          return await unavailableRow.evaluate((element) => {
            const htmlElement = element as HTMLElement
            return (
              htmlElement.getAttribute('aria-disabled') === 'true' ||
              (htmlElement instanceof HTMLButtonElement && htmlElement.disabled)
            )
          })
        })
        .toBe(true)
    } finally {
      await closeApp(app)
    }
  })

  test('resets the workspace feed on same-path reopen', async () => {
    test.setTimeout(120000)
    const { app, page } = await launchApp()

    try {
      await openWorkspaceWithBaseline(page)

      await invokeMonitoringTestUpsert(page, {
        terminalId: 'terminal-2',
        workspacePath: WORKSPACE_PATH,
        patternName: 'approval-prompt',
        matchedText: 'Apply this change? (y/n)',
        category: 'approval',
        confidence: 'high',
        source: 'llm',
        summary: 'Approval needed',
        timestamp: 2000
      })
      await page.waitForTimeout(1000)

      const trigger = statusBarFeedTrigger(page)
      await expect(trigger).toContainText('Recent')
      await trigger.click()
      await expect(statusBarFeedPopover(page)).toContainText('Entered · Approval needed')

      await page.evaluate(async (workspacePath) => {
        await window.workspace.openPath(workspacePath)
      }, WORKSPACE_PATH)

      await expect(statusBarFeedTrigger(page)).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })
})
