import fs from 'node:fs/promises'
import path from 'node:path'
import { test, expect, ElectronApplication, Page } from '@playwright/test'
import {
  closeApp,
  emitRendererMonitoringClear,
  emitRendererMonitoringUpsert,
  launchApp,
} from './helpers/electron'

function groupHeader(page: Page, groupName: string) {
  return page
    .locator('.terminal-tree__group')
    .filter({ has: page.locator('.terminal-tree__group-name', { hasText: groupName }) })
    .first()
}

const WORKSPACE_PATH = path.join(process.cwd())

async function resetWorkspaceState(): Promise<void> {
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
  await page.waitForSelector('.welcome', { timeout: 15000 })
  await page.evaluate(async (workspacePath) => {
    await window.workspace.openPath(workspacePath)
  }, WORKSPACE_PATH)
  await resetWorkspaceState()
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
    workspacePath: 'D:/4. Workspace/PromptManager',
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
      const activeHeader = groupHeader(page, activeGroup.name)
      await activeHeader.click()

      await page.locator('.terminal-tree__add-btn--small').first().click()
      await expect(page.locator('.terminal-tree__item')).toHaveCount(2, { timeout: 15000 })

      const firstTerminalId = 'terminal-1'
      const secondTerminalId = 'terminal-2'
      const firstTerminalName = 'Terminal 1'
      const secondTerminalName = 'Terminal 2'

      await sendAttentionNeeded(app, secondTerminalId)
      const secondRow = terminalRow(page, secondTerminalName)
      await expect(secondRow.locator('.terminal-tree__item-indicator')).toBeVisible()

      await secondRow.click({ button: 'right' })
      await expect(page.locator('.terminal-tree__context-menu')).toBeVisible()

      const beforeOrder = await page.locator('.terminal-tree__item .terminal-tree__name').allTextContents()
      await secondRow.dragTo(terminalRow(page, firstTerminalName))
      await page.waitForTimeout(1200)

      await expect.poll(async () => {
        return (await page.locator('.terminal-tree__item .terminal-tree__name').allTextContents()).join(',')
      }, { timeout: 15000 }).not.toBe(beforeOrder.join(','))
    } finally {
      await closeApp(app)
    }
  })
})
