import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import {
  launchApp,
  closeApp,
  openRecentWorkspace,
  WORKSPACE_PATH
} from './helpers/electron'

const AGENTS_FILE_PATH = path.join(WORKSPACE_PATH, 'AGENTS.md')

function createRestoredEditorWorkspace(): string {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'workpane-restored-editor-'))
  const workspaceStateDir = path.join(workspacePath, '.workspace')
  const copiedAgentsPath = path.join(workspacePath, 'AGENTS.md')

  fs.mkdirSync(workspaceStateDir, { recursive: true })
  fs.copyFileSync(AGENTS_FILE_PATH, copiedAgentsPath)
  fs.writeFileSync(path.join(workspaceStateDir, 'state.json'), JSON.stringify({
    version: 2,
    editorTabs: [{ filePath: copiedAgentsPath, title: 'AGENTS.md' }],
    activeEditorFilePath: copiedAgentsPath,
    terminals: [{ id: 'terminal-startup-1', name: 'Terminal 1' }],
    groups: [
      {
        id: 'group-1',
        name: 'Group 1',
        layoutTree: {
          type: 'leaf',
          panelId: 'panel-startup-1',
          terminalIds: ['terminal-startup-1'],
          browserIds: [],
          activeTerminalId: 'terminal-startup-1'
        },
        terminalIds: ['terminal-startup-1'],
        activeTerminalId: 'terminal-startup-1',
        focusedPanelId: 'panel-startup-1',
        collapsed: false
      }
    ],
    activeGroupId: 'group-1'
  }), 'utf-8')

  return workspacePath
}

test.describe('App Launch', () => {
  test('shows welcome screen on startup', async () => {
    const { app, page } = await launchApp()

    try {
      // Welcome screen should be visible before opening a workspace
      await expect(page.locator('.welcome')).toBeVisible({ timeout: 15000 })
      await expect(page.locator('.welcome__title')).toBeVisible()
      await expect(page.locator('.welcome__btn--primary')).toBeVisible()

      await page.screenshot({ path: 'artifacts/01-welcome-screen.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('opens workspace with terminal-first shell defaults', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await expect(page.locator('.activity-bar')).toBeVisible()
      await expect(page.locator('.activity-bar__item')).toHaveCount(3)
      await expect(page.locator('[data-testid="activity-bar-explorer"]')).toBeVisible()
      await expect(page.locator('[data-testid="activity-bar-search"]')).toBeVisible()
      await expect(page.locator('[data-testid="activity-bar-settings"]')).toBeVisible()
      await expect(page.locator('[data-testid="activity-bar-skills"]')).toHaveCount(0)
      await expect(page.locator('.sidebar')).toBeVisible()
      await expect(page.locator('.sidebar')).toContainText('Terminal')
      await expect(page.locator('.sidebar')).toContainText('File Explorer')
      await expect(page.locator('.sidebar__explorer > .sidebar__section')).toHaveCount(2)
      await expect(page.locator('.terminal-area')).toBeVisible()
      await expect(page.locator('.markdown-area')).toHaveCount(0)
      await expect(
        page.locator('.main-area__edge-toggle--left .main-area__pane-toggle[title="Show Editor"]')
      ).toBeVisible()
      await expect(page.locator('.status-bar')).toBeVisible()
      await expect(page.locator('.status-bar__filename')).toHaveCount(0)

      await page.screenshot({ path: 'artifacts/02-main-app.png' })
    } finally {
      await closeApp(app)
    }
  })

  test('keeps restored editor tabs hidden until an explicit reveal event occurs', async () => {
    const { app, page } = await launchApp()
    const workspacePath = createRestoredEditorWorkspace()

    try {
      await page.waitForSelector('.welcome', { timeout: 15000 })
      await page.evaluate(async (targetWorkspacePath) => {
        await window.workspace.openPath(targetWorkspacePath)
      }, workspacePath)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.activity-bar', { timeout: 15000 })

      await expect(page.locator('.terminal-area')).toBeVisible()
      await expect(page.locator('.markdown-area')).toHaveCount(0)
      await expect(
        page.locator('.main-area__edge-toggle--left .main-area__pane-toggle[title="Show Editor"]')
      ).toBeVisible()
      await expect(page.locator('.status-bar__filename')).toHaveCount(0)
      await expect(page.locator('[data-testid="titlebar-toggle-editor"]')).toHaveAttribute('data-has-editor-tabs', 'true')
    } finally {
      await closeApp(app)
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  test('welcome screen keeps workspace-first copy only', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForSelector('.welcome', { timeout: 15000 })
      await expect(page.locator('.welcome__subtitle')).toBeVisible()
      await expect(page.locator('.welcome__btn--primary')).toBeVisible()
      await expect(page.locator('.welcome__skills-info')).toHaveCount(0)

      await page.screenshot({ path: 'artifacts/03-welcome-skills-info.png' })
    } finally {
      await closeApp(app)
    }
  })
})
