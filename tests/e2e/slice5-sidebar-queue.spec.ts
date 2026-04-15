import fs from 'node:fs/promises'
import path from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  closeApp,
  invokeMonitoringTestClear,
  invokeMonitoringTestUpsert,
  launchApp
} from './helpers/electron'

const WORKSPACE_PATH = path.join(process.cwd())

async function seedWorkspaceState(): Promise<void> {
  const workspaceDir = path.join(WORKSPACE_PATH, '.workspace')
  await fs.mkdir(workspaceDir, { recursive: true })
  await fs.writeFile(
    path.join(workspaceDir, 'state.json'),
    JSON.stringify({
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
    }, null, 2),
    'utf-8'
  )
}

async function openWorkspaceWithBaseline(page: Page): Promise<void> {
  await seedWorkspaceState()
  await page.waitForSelector('.welcome', { timeout: 15000 })
  await page.evaluate(async (workspacePath) => {
    await window.workspace.openPath(workspacePath)
  }, WORKSPACE_PATH)
  await page.waitForSelector('.activity-bar', { timeout: 15000 })
  await page.waitForTimeout(1000)
}

function terminalSection(page: Page): Locator {
  return page.locator('.sidebar__section').filter({
    has: page.locator('.sidebar__section-header', { hasText: 'Terminal' })
  }).first()
}

function queueSubsection(page: Page): Locator {
  return terminalSection(page).locator(
    [
      '[data-testid="monitoring-queue-subsection"]',
      '[data-testid="monitoring-queue"]',
      '[aria-label="Attention queue"]',
      '[aria-label="Terminal queue"]',
      '.monitoring-queue',
      '.terminal-tree__queue'
    ].join(', ')
  ).first()
}

function queueRow(page: Page, text: string): Locator {
  return queueSubsection(page).locator(
    [
      '[data-testid="monitoring-queue-row"]',
      'button',
      '[role="button"]',
      '[role="listitem"]',
      '.monitoring-queue__row',
      '.terminal-tree__queue-row'
    ].join(', ')
  ).filter({ hasText: text }).first()
}

function statusBarFeedTrigger(page: Page): Locator {
  return page.locator('[data-testid="monitoring-global-feed-trigger"]').first()
}

function statusBarFeedPopover(page: Page): Locator {
  return page.locator(
    [
      '[data-testid="monitoring-global-feed"]',
      '[aria-label="Workspace feed"]',
      '[aria-label="Global monitoring feed"]',
      '[aria-label="Monitoring workspace feed"]',
      '.status-bar__monitoring-feed'
    ].join(', ')
  ).first()
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

test.describe('Slice 5 Terminal-Local Sidebar Queue', () => {
  test('shows live unresolved queue rows, preserves chronology separately, and avoids mission-control controls', async () => {
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

      const section = terminalSection(page)
      await expect(section).toBeVisible()
      await expect(section).toContainText('Terminal')

      const queue = queueSubsection(page)
      await expect(queue).toBeVisible()
      await expect(queue).toContainText('Queue')
      await expect(page.locator('.sidebar__explorer > .sidebar__section')).toHaveCount(2)

      const queueText = await queue.textContent()
      const terminal2Index = queueText?.indexOf('Terminal 2') ?? -1
      const terminal1Index = queueText?.indexOf('Terminal 1') ?? -1

      expect(terminal2Index).toBeGreaterThanOrEqual(0)
      expect(terminal1Index).toBeGreaterThanOrEqual(0)
      expect(terminal2Index).toBeLessThan(terminal1Index)

      await expect(queue).toContainText('Terminal 2')
      await expect(queue).toContainText('Group 2')
      await expect(queue).toContainText(/approval needed/i)
      await expect(queue).toContainText(/llm classification · high confidence/i)
      await expect(queue).toContainText(/possible approval needed/i)
      await expect(queue).toContainText(/no-api hint · low confidence/i)
      await expect(queue).not.toContainText(/entered ·|updated ·|attention state cleared/i)
      await expect(queue).not.toContainText(/terminal 3/i)
      await expect(queue).not.toContainText(/ack|assign|defer|snooze|bulk|filter|group by|sort|pin|select/i)
      await expect(page.locator('.activity-bar')).not.toContainText(/^Queue$/)
      await expect(page.locator('[data-testid="monitoring-queue-drawer"], .monitoring-queue-drawer')).toHaveCount(0)

      const terminal1QueueRow = queueRow(page, 'Terminal 1')
      await expect(terminal1QueueRow).toBeVisible()
      await terminal1QueueRow.click()

      await expect(groupHeader(page, 'Group 1')).toHaveClass(/terminal-tree__group--active/)
      await expect(terminalRow(page, 'Terminal 1')).toHaveAttribute('aria-selected', 'true')

      await invokeMonitoringTestClear(page, {
        terminalId: 'terminal-1',
        reason: 'write',
        timestamp: 1200
      })
      await page.waitForTimeout(500)

      await expect(queue).not.toContainText('Terminal 1')
      await expect(queue).toContainText('Terminal 2')

      const trigger = statusBarFeedTrigger(page)
      await expect(trigger).toContainText('Recent')
      await trigger.click()
      const feed = statusBarFeedPopover(page)
      await expect(feed).toBeVisible()
      await expect(feed).toContainText('Terminal 1')
      await expect(feed).toContainText(/Attention state cleared/i)

      await deleteTerminalFromTree(page, 'Terminal 2')
      await expect(queueSubsection(page)).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })

  test('resets the sidebar queue on same-path reopen', async () => {
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

      await expect(queueSubsection(page)).toBeVisible()
      await expect(queueSubsection(page)).toContainText('Terminal 2')

      await page.evaluate(async (workspacePath) => {
        await window.workspace.openPath(workspacePath)
      }, WORKSPACE_PATH)

      await expect(queueSubsection(page)).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })
})
