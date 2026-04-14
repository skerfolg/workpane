import { test, expect, Page } from '@playwright/test'
import {
  closeApp,
  invokeMonitoringTestClear,
  invokeMonitoringTestUpsert,
  launchApp,
  openRecentWorkspace,
  resetWorkspaceStateFile
} from './helpers/electron'

const WORKSPACE_PATH = 'D:/4. Workspace/PromptManager'

async function seedSingleTerminalWorkspace(page: Page): Promise<void> {
  await resetWorkspaceStateFile(page, {
    version: 2,
    editorTabs: [],
    activeEditorFilePath: null,
    terminals: [
      { id: 'terminal-1', name: 'Terminal 1' }
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
      }
    ],
    activeGroupId: 'group-1'
  })
}

async function openWorkspaceWithBaseline(page: Page): Promise<void> {
  await openRecentWorkspace(page)
  await seedSingleTerminalWorkspace(page)
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

function transitionLogToggle(page: Page) {
  return page.getByTitle(/transition log/i)
}

test.describe('Slice 3 Panel-Local Transition Log', () => {
  test('renders entered and updated transitions, coalesces unchanged updates, and preserves tentative wording', async () => {
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
        timestamp: 1
      })

      const toggle = transitionLogToggle(page)
      await expect(toggle).toHaveAttribute('title', /toggle transition log/i)
      await toggle.click()

      await expect(page.getByText('Entered · Possible approval needed')).toBeVisible()
      await expect(page.getByText(/entered · no-api hint · low confidence/i)).toBeVisible()

      // Same semantic tuple: should coalesce, not append.
      await invokeMonitoringTestUpsert(page, {
        terminalId: 'terminal-1',
        workspacePath: WORKSPACE_PATH,
        patternName: 'approval-prompt',
        matchedText: 'Apply this change? (y/n)',
        category: 'approval',
        confidence: 'low',
        source: 'no-api',
        summary: 'Possible approval needed',
        timestamp: 2
      })

      await expect(page.getByText('Entered · Possible approval needed')).toHaveCount(1)

      // Semantic change: should append updated.
      await invokeMonitoringTestUpsert(page, {
        terminalId: 'terminal-1',
        workspacePath: WORKSPACE_PATH,
        patternName: 'approval-prompt',
        matchedText: 'Apply this change? (y/n)',
        category: 'approval',
        confidence: 'high',
        source: 'llm',
        summary: 'Approval needed',
        timestamp: 3
      })

      await expect(page.getByText('Updated · Approval needed')).toBeVisible()
      await expect(page.getByText(/updated · llm classification · high confidence/i)).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('appends cleared transition, keeps chronology across toggles, and resets on same-path workspace reopen', async () => {
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
        confidence: 'high',
        source: 'llm',
        summary: 'Approval needed',
        timestamp: 1
      })

      const toggle = transitionLogToggle(page)
      await toggle.click()
      await expect(page.getByText('Entered · Approval needed')).toBeVisible()

      await invokeMonitoringTestClear(page, {
        terminalId: 'terminal-1',
        reason: 'write',
        timestamp: 2
      })

      await expect(page.getByText('Attention state cleared')).toBeVisible()
      await expect(page.getByText(/cleared · after local input/i)).toBeVisible()
      await expect(page.getByText('Entered · Approval needed')).toHaveCount(1)

      await toggle.click()
      await toggle.click()
      await expect(page.getByText('Attention state cleared')).toBeVisible()

      await page.evaluate(async (workspacePath) => {
        await window.workspace.openPath(workspacePath)
      }, WORKSPACE_PATH)

      await expect(page.getByTitle(/no transition history yet/i)).toBeVisible()
      await expect(page.getByText('Attention state cleared')).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })
})
