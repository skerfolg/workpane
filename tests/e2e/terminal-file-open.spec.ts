import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import {
  closeApp,
  launchApp,
  WORKSPACE_PATH
} from './helpers/electron'

const TERMINAL_ID = 'terminal-slice4-1'
const TERMINAL_PANEL_ID = 'panel-slice4-1'
const SOURCE_AGENTS_FILE_PATH = path.join(WORKSPACE_PATH, 'AGENTS.md')

function createTerminalWorkspace(): string {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'workpane-terminal-open-'))
  const workspaceStateDir = path.join(workspacePath, '.workspace')
  const copiedAgentsPath = path.join(workspacePath, 'AGENTS.md')

  fs.mkdirSync(workspaceStateDir, { recursive: true })
  fs.copyFileSync(SOURCE_AGENTS_FILE_PATH, copiedAgentsPath)
  fs.writeFileSync(path.join(workspaceStateDir, 'state.json'), JSON.stringify({
    version: 2,
    editorTabs: [],
    activeEditorFilePath: null,
    terminals: [{ id: TERMINAL_ID, name: 'Terminal 1' }],
    groups: [
      {
        id: 'group-1',
        name: 'Group 1',
        layoutTree: {
          type: 'leaf',
          panelId: TERMINAL_PANEL_ID,
          terminalIds: [TERMINAL_ID],
          browserIds: [],
          activeTerminalId: TERMINAL_ID
        },
        terminalIds: [TERMINAL_ID],
        activeTerminalId: TERMINAL_ID,
        focusedPanelId: TERMINAL_PANEL_ID,
        collapsed: false
      }
    ],
    activeGroupId: 'group-1'
  }), 'utf-8')

  return workspacePath
}

test.describe('Terminal File Open', () => {
  test('a terminal-originated file-open event reveals the viewer and opens the file', async () => {
    const { app, page } = await launchApp()
    const workspacePath = createTerminalWorkspace()

    try {
      await page.waitForSelector('.welcome', { timeout: 15000 })
      await page.evaluate(async (targetWorkspacePath) => {
        await window.workspace.openPath(targetWorkspacePath)
      }, workspacePath)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.activity-bar', { timeout: 15000 })

      await expect(page.locator('.terminal-area')).toBeVisible()
      await expect(page.locator('.xterm-screen')).toBeVisible()
      await expect(page.locator('.markdown-area')).toHaveCount(0)
      await expect(page.locator('.status-bar__filename')).toHaveCount(0)

      await page.evaluate(([terminalId, filePath]) => {
        if (!window.terminal.testOpenFile) {
          throw new Error('Missing terminal test open hook in test environment')
        }
        window.terminal.testOpenFile(terminalId, filePath)
      }, [TERMINAL_ID, path.join(workspacePath, 'AGENTS.md')] as const)

      await expect(page.locator('.markdown-area')).toBeVisible()
      await expect(page.locator('.markdown-area [role="tab"][aria-selected="true"]')).toContainText('AGENTS.md')
      await expect(page.locator('.markdown-area')).toContainText('WorkPane (PromptManager)')
      await expect(page.locator('.status-bar__filename')).toContainText('AGENTS.md')
    } finally {
      await closeApp(app)
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })
})
