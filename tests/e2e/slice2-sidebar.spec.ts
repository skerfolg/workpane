import { test, expect, ElectronApplication, Page } from '@playwright/test'
import {
  closeApp,
  emitRendererMonitoringClear,
  emitRendererMonitoringUpsert,
  launchApp,
  resetWorkspaceStateFile,
  WORKSPACE_PATH
} from './helpers/electron'

function groupHeader(page: Page, groupName: string) {
  return page
    .locator('.terminal-tree__group')
    .filter({ has: page.locator('.terminal-tree__group-name', { hasText: groupName }) })
    .first()
}

function groupTreeItem(page: Page, groupName: string) {
  return page
    .locator('.terminal-tree__list > li')
    .filter({ has: page.locator('.terminal-tree__group-name', { hasText: groupName }) })
    .first()
}

async function openWorkspaceWithBaseline(page: Page): Promise<void> {
  await page.waitForSelector('.welcome', { timeout: 15000 })
  await page.evaluate(async (workspacePath) => {
    await window.workspace.openPath(workspacePath)
  }, WORKSPACE_PATH)
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
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.activity-bar', { timeout: 15000 })
  await page.waitForTimeout(1000)
}

function terminalRow(page: Page, terminalName: string) {
  return page
    .locator('.terminal-tree__item')
    .filter({ has: page.locator('.terminal-tree__name', { hasText: terminalName }) })
    .first()
}

async function setGroupCollapsed(page: Page, groupName: string, collapsed: boolean): Promise<void> {
  const header = groupHeader(page, groupName)
  await expect(header).toBeVisible({ timeout: 15000 })
  const expanded = await header.evaluate((element) => {
    const treeItem = element.parentElement
    return treeItem?.getAttribute('aria-expanded') === 'true'
  })
  if (expanded === !collapsed) {
    return
  }
  await header.locator('.terminal-tree__chevron').click()
}

async function sendAttentionNeeded(
  app: ElectronApplication,
  terminalId: string,
  source: 'llm' | 'no-api' = 'llm'
): Promise<void> {
  await emitRendererMonitoringUpsert(app, {
    terminalId,
    workspacePath: WORKSPACE_PATH,
    patternName: 'approval-prompt',
    matchedText: 'Apply this change? (y/n)',
    category: 'approval',
    confidence: source === 'llm' ? 'high' : 'low',
    source,
    summary: source === 'llm' ? 'Approval needed' : 'Possible approval needed'
  })
}

test.describe('Slice 2 Sidebar Discoverability', () => {
  test('updates collapsed group cues and clears stale state on clear events', async () => {
    test.setTimeout(120000)
    const { app, page } = await launchApp()

    try {
      await openWorkspaceWithBaseline(page)
      const group = { id: 'group-1', name: 'Group 1', terminalIds: ['terminal-1'] }
      const terminalId = group.terminalIds[0]
      const terminalName = 'Terminal 1'

      await setGroupCollapsed(page, group.name, true)

      await sendAttentionNeeded(app, terminalId, 'no-api')

      const terminalSectionHeader = page.locator('.sidebar__section-header').filter({ hasText: 'Terminal' })
      await expect(terminalSectionHeader).toContainText('1')

      const groupRow = groupHeader(page, group.name)
      await expect(groupRow.locator('.terminal-tree__group-attention-badge')).toHaveText('1')
      await expect(groupRow).toHaveAttribute('title', /1 terminal need attention/i)

      await setGroupCollapsed(page, group.name, false)
      const row = terminalRow(page, terminalName)
      await expect(row.locator('.terminal-tree__item-indicator')).toBeVisible()
      await expect(row.locator('.terminal-tree__item-indicator')).toHaveAttribute('title', /possible approval needed/i)
      await expect(row).not.toContainText('Possible approval needed')

      await emitRendererMonitoringClear(app, { terminalId, reason: 'write' })
      await expect(row.locator('.terminal-tree__item-indicator')).toHaveCount(0)
      await expect(groupRow.locator('.terminal-tree__group-attention-badge')).toHaveCount(0)
      await expect(terminalSectionHeader).not.toContainText('1')
    } finally {
      await closeApp(app)
    }
  })

  test('preserves terminal tree context menu and drag reorder under row decoration', async () => {
    test.setTimeout(120000)
    const { app, page } = await launchApp()

    try {
      await openWorkspaceWithBaseline(page)
      const activeGroup = { id: 'group-1', name: 'Group 1', terminalIds: ['terminal-1'] }
      const activeGroupHeader = groupHeader(page, activeGroup.name)
      const activeGroupItem = groupTreeItem(page, activeGroup.name)
      await activeGroupHeader.click()

      await page.locator('.terminal-tree__add-btn--small').first().click()
      await expect(activeGroupItem.locator('.terminal-tree__item')).toHaveCount(2, { timeout: 15000 })

      const firstTerminalId = 'terminal-1'
      const firstTerminalName = 'Terminal 1'
      const terminalNames = await activeGroupItem
        .locator('.terminal-tree__item .terminal-tree__name')
        .allTextContents()
      const secondTerminalName = terminalNames.find((name) => name !== firstTerminalName)
      if (!secondTerminalName) {
        throw new Error('Failed to find the newly created terminal row in Group 1')
      }

      await sendAttentionNeeded(app, firstTerminalId)
      const firstRow = terminalRow(page, firstTerminalName)
      const secondRow = terminalRow(page, secondTerminalName)
      await expect(firstRow.locator('.terminal-tree__item-indicator')).toBeVisible()

      await secondRow.click({ button: 'right' })
      await expect(page.locator('.terminal-tree__context-menu')).toBeVisible()

      const beforeOrder = await activeGroupItem.locator('.terminal-tree__item .terminal-tree__name').allTextContents()
      await secondRow.dragTo(firstRow)
      await page.waitForTimeout(1200)

      await expect.poll(async () => {
        return (await activeGroupItem.locator('.terminal-tree__item .terminal-tree__name').allTextContents()).join(',')
      }, { timeout: 15000 }).not.toBe(beforeOrder.join(','))
    } finally {
      await closeApp(app)
    }
  })
})
