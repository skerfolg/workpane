import { expect, test, type Page } from '@playwright/test'
import {
  closeApp,
  getWorkspaceState,
  launchApp,
  resetWorkspaceStateFile,
  WORKSPACE_PATH
} from './helpers/electron'

const SEEDED_STATE = {
  version: 2,
  editorTabs: [],
  activeEditorFilePath: null,
  terminals: [
    { id: 'terminal-1', name: 'Terminal 1' },
    { id: 'terminal-2', name: 'Terminal 2' },
    { id: 'terminal-3', name: 'Terminal 3' },
    { id: 'terminal-4', name: 'Terminal 4' }
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
    },
    {
      id: 'group-3',
      name: 'Group 3',
      layoutTree: {
        type: 'leaf',
        panelId: 'panel-3',
        terminalIds: ['terminal-4'],
        browserIds: ['browser-1'],
        activeTerminalId: 'terminal-4'
      },
      terminalIds: ['terminal-4'],
      activeTerminalId: 'terminal-4',
      focusedPanelId: 'panel-3',
      collapsed: false
    }
  ],
  activeGroupId: 'group-1'
}

async function openWorkspaceWithSeed(page: Page): Promise<void> {
  await page.waitForSelector('.welcome', { timeout: 15000 })
  await resetWorkspaceStateFile(page, SEEDED_STATE, WORKSPACE_PATH)
  await page.evaluate(async (workspacePath) => {
    await window.workspace.openPath(workspacePath)
  }, WORKSPACE_PATH)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.activity-bar', { timeout: 15000 })
}

test.describe('F2 Mission Control layout presets', () => {
  test('applies a preset to a non-active group, keeps non-target groups unchanged, and restores after reopen', async () => {
    const { app, page } = await launchApp()

    try {
      await openWorkspaceWithSeed(page)

      const initialState = await getWorkspaceState(page)
      const group1Before = JSON.stringify(initialState.groups.find((group: any) => group.id === 'group-1')?.layoutTree)
      const group2Before = JSON.stringify(initialState.groups.find((group: any) => group.id === 'group-2')?.layoutTree)
      const group3Before = JSON.stringify(initialState.groups.find((group: any) => group.id === 'group-3')?.layoutTree)

      await page.getByTestId('activity-bar-mission-control').click()
      const dialog = page.getByRole('dialog', { name: 'Mission Control' })
      await expect(dialog).toBeVisible()

      await page.getByTestId('mission-control-preset-group-2-2x2').click()
      await expect(dialog).toBeVisible()

      await expect
        .poll(async () => {
          const state = await getWorkspaceState(page)
          return JSON.stringify(state.groups.find((group: any) => group.id === 'group-2')?.layoutTree)
        }, { timeout: 10000 })
        .not.toBe(group2Before)

      const stateAfterApply = await getWorkspaceState(page)
      expect(stateAfterApply.activeGroupId).toBe('group-1')
      const group1After = JSON.stringify(stateAfterApply.groups.find((group: any) => group.id === 'group-1')?.layoutTree)
      const group2After = JSON.stringify(stateAfterApply.groups.find((group: any) => group.id === 'group-2')?.layoutTree)
      const group3After = JSON.stringify(stateAfterApply.groups.find((group: any) => group.id === 'group-3')?.layoutTree)

      expect(group2After).not.toBe(group2Before)
      expect(group1After).toBe(group1Before)
      expect(group3After).toBe(group3Before)

      await page
        .getByTestId('mission-control-group-group-2')
        .locator('.mission-control__card')
        .first()
        .click()
      await expect(dialog).toHaveCount(0)
      await expect
        .poll(async () => {
          const state = await getWorkspaceState(page)
          return state.activeGroupId
        }, { timeout: 10000 })
        .toBe('group-2')

      await page.evaluate(async (workspacePath) => {
        await window.workspace.openPath(workspacePath)
      }, WORKSPACE_PATH)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.activity-bar', { timeout: 15000 })

      const reopenedState = await getWorkspaceState(page)
      const group2Reopened = JSON.stringify(reopenedState.groups.find((group: any) => group.id === 'group-2')?.layoutTree)
      expect(group2Reopened).toBe(group2After)
    } finally {
      await closeApp(app)
    }
  })

  test('disables preset controls for mixed-content groups in Mission Control and the toolbar', async () => {
    const { app, page } = await launchApp()

    try {
      await openWorkspaceWithSeed(page)

      await page.getByTestId('activity-bar-mission-control').click()
      await expect(page.getByTestId('mission-control-preset-group-3-2col')).toBeDisabled()
      await expect(page.getByTestId('mission-control-preset-group-3-2row')).toBeDisabled()
      await expect(page.getByTestId('mission-control-preset-group-3-2x2')).toBeDisabled()

      await page.keyboard.press('Escape')
      await page.locator('.terminal-tree__group-name', { hasText: 'Group 3' }).click()
      await expect(page.getByTestId('terminal-preset-2col')).toBeDisabled()
      await expect(page.getByTestId('terminal-preset-2row')).toBeDisabled()
      await expect(page.getByTestId('terminal-preset-2x2')).toBeDisabled()
    } finally {
      await closeApp(app)
    }
  })
})
