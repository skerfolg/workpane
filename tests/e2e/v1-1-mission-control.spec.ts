import { test, expect, type Page } from '@playwright/test'
import {
  closeApp,
  launchApp,
  openRecentWorkspace,
  getWorkspaceState,
  invokeMonitoringTestUpsert,
  resetWorkspaceStateFile,
  WORKSPACE_PATH
} from './helpers/electron'

type PresetType = '2col' | '2row' | '2x2'

type SerializedLayoutNode = {
  type: 'leaf'
  panelId?: string
  terminalIds: string[]
  browserIds: string[]
  activeTerminalId: string | null
} | {
  type: 'split'
  splitId?: string
  direction: 'horizontal' | 'vertical'
  ratio: number
  children: [SerializedLayoutNode, SerializedLayoutNode]
}

function createLeaf(panelId: string, terminalIds: string[], browserIds: string[] = []): SerializedLayoutNode {
  return {
    type: 'leaf',
    panelId,
    terminalIds,
    browserIds,
    activeTerminalId: terminalIds[0] ?? null
  }
}

function createSplit(
  splitId: string,
  direction: 'horizontal' | 'vertical',
  children: [SerializedLayoutNode, SerializedLayoutNode]
): SerializedLayoutNode {
  return {
    type: 'split',
    splitId,
    direction,
    ratio: 0.5,
    children
  }
}

function createMissionControlBaselineState() {
  return {
    version: 2,
    editorTabs: [],
    activeEditorFilePath: null,
    terminals: [
      { id: 'terminal-1', name: 'Terminal 1' },
      { id: 'terminal-2', name: 'Terminal 2' },
      { id: 'terminal-3', name: 'Terminal 3' },
      { id: 'terminal-4', name: 'Terminal 4' },
      { id: 'terminal-5', name: 'Terminal 5' },
      { id: 'terminal-6', name: 'Terminal 6' },
      { id: 'terminal-7', name: 'Terminal 7' }
    ],
    groups: [
      {
        id: 'group-1',
        name: 'Group 1',
        layoutTree: createLeaf('panel-1', ['terminal-1']),
        terminalIds: ['terminal-1'],
        activeTerminalId: 'terminal-1',
        focusedPanelId: 'panel-1',
        collapsed: false
      },
      {
        id: 'group-2',
        name: 'Group 2',
        layoutTree: {
          ...createLeaf('panel-2', ['terminal-2', 'terminal-3', 'terminal-4']),
          activeTerminalId: 'terminal-3'
        },
        terminalIds: ['terminal-2', 'terminal-3', 'terminal-4'],
        activeTerminalId: 'terminal-3',
        focusedPanelId: 'panel-2',
        collapsed: false
      },
      {
        id: 'group-3',
        name: 'Group 3',
        layoutTree: createSplit('panel-3', 'vertical', [
          createLeaf('panel-4', ['terminal-5']),
          createLeaf('panel-5', ['terminal-6'])
        ]),
        terminalIds: ['terminal-5', 'terminal-6'],
        activeTerminalId: 'terminal-5',
        focusedPanelId: 'panel-4',
        collapsed: false
      },
      {
        id: 'group-4',
        name: 'Group 4',
        layoutTree: {
          ...createLeaf('panel-6', ['terminal-7'], ['browser-1']),
          activeTerminalId: 'terminal-7'
        },
        terminalIds: ['terminal-7'],
        activeTerminalId: 'terminal-7',
        focusedPanelId: 'panel-6',
        collapsed: false
      }
    ],
    activeGroupId: 'group-1'
  }
}

function normalizeLayoutTree(node: SerializedLayoutNode): unknown {
  if (node.type === 'leaf') {
    return {
      type: 'leaf',
      terminalIds: node.terminalIds,
      browserIds: node.browserIds,
      activeTerminalId: node.activeTerminalId
    }
  }

  return {
    type: 'split',
    direction: node.direction,
    ratio: node.ratio,
    children: node.children.map((child) => normalizeLayoutTree(child))
  }
}

function expectedPresetLayout(layoutType: PresetType): unknown {
  if (layoutType === '2col') {
    return {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        { type: 'leaf', terminalIds: ['terminal-2', 'terminal-4'], browserIds: [], activeTerminalId: 'terminal-2' },
        { type: 'leaf', terminalIds: ['terminal-3'], browserIds: [], activeTerminalId: 'terminal-3' }
      ]
    }
  }

  if (layoutType === '2row') {
    return {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [
        { type: 'leaf', terminalIds: ['terminal-2', 'terminal-4'], browserIds: [], activeTerminalId: 'terminal-2' },
        { type: 'leaf', terminalIds: ['terminal-3'], browserIds: [], activeTerminalId: 'terminal-3' }
      ]
    }
  }

  return {
    type: 'split',
    direction: 'vertical',
    ratio: 0.5,
    children: [
      {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          { type: 'leaf', terminalIds: ['terminal-2'], browserIds: [], activeTerminalId: 'terminal-2' },
          { type: 'leaf', terminalIds: ['terminal-4'], browserIds: [], activeTerminalId: 'terminal-4' }
        ]
      },
      {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          { type: 'leaf', terminalIds: ['terminal-3'], browserIds: [], activeTerminalId: 'terminal-3' },
          { type: 'leaf', terminalIds: [], browserIds: [], activeTerminalId: null }
        ]
      }
    ]
  }
}

function missionControlGroup(page: Page, groupName: string) {
  return page.locator('.mission-control__group').filter({
    has: page.locator('.mission-control__group-header', { hasText: groupName })
  }).first()
}

function missionControlPresetButton(page: Page, groupId: string, preset: PresetType) {
  return page.getByTestId(`mission-control-preset-${groupId}-${preset}`)
}

async function openWorkspaceWithMissionControlBaseline(page: Page): Promise<void> {
  await page.waitForSelector('.welcome', { timeout: 15000 })
  await resetWorkspaceStateFile(page, createMissionControlBaselineState())
  await page.evaluate(async (workspacePath) => {
    await window.workspace.openPath(workspacePath)
  }, WORKSPACE_PATH)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.activity-bar', { timeout: 15000 })
}

async function readWorkspaceState(page: Page): Promise<any> {
  return getWorkspaceState(page)
}

test.describe('v1.1 Mission Control', () => {
  test('opens the overlay, prioritizes pending sessions, and closes on card click', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await invokeMonitoringTestUpsert(page, {
        terminalId: 'terminal-1',
        workspacePath: 'D:/4. Workspace/PromptManager',
        patternName: 'Approve changes?',
        matchedText: 'Approve changes?',
        category: 'approval',
        confidence: 'high',
        source: 'llm',
        summary: 'Approval needed'
      })

      await page.getByTestId('activity-bar-mission-control').click()
      const dialog = page.getByRole('dialog', { name: 'Mission Control' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('Mission Control')
      await expect(dialog.locator('.mission-control__card--attention')).toContainText('Pending')

      await dialog.locator('.mission-control__card').first().click()
      await expect(dialog).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })

  test('shows fallback backend status when sqlite is intentionally disabled', async () => {
    const { app, page } = await launchApp({
      env: {
        WORKPANE_HISTORY_BACKEND: 'json_fallback'
      }
    })

    try {
      await openRecentWorkspace(page)
      await expect.poll(async () => {
        const status = await page.evaluate(async () => window.monitoringHistory.getStatus())
        return status.backend
      }).toBe('json_fallback')

      await page.getByTestId('activity-bar-mission-control').click()

      const status = page.getByTestId('mission-control-history-status')
      await expect(status).toContainText('History backend:')
      await expect(status).toContainText('json_fallback')
      await expect(status).toContainText('WORKPANE_HISTORY_BACKEND')
    } finally {
      await closeApp(app)
    }
  })

  for (const preset of ['2col', '2row', '2x2'] as const) {
    test(`applies the ${preset} preset to a non-active Mission Control group without mutating other groups`, async () => {
      const { app, page } = await launchApp()

      try {
        const baselineState = createMissionControlBaselineState()
        await openWorkspaceWithMissionControlBaseline(page)

        await page.getByTestId('activity-bar-mission-control').click()
        await expect(page.getByRole('dialog', { name: 'Mission Control' })).toBeVisible()

        await missionControlPresetButton(page, 'group-2', preset).click()

        await expect.poll(async () => {
          const state = await readWorkspaceState(page)
          const targetGroup = state.groups.find((group: any) => group.id === 'group-2')
          return JSON.stringify(normalizeLayoutTree(targetGroup.layoutTree))
        }).toBe(JSON.stringify(expectedPresetLayout(preset)))

        const state = await readWorkspaceState(page)
        const group1 = state.groups.find((group: any) => group.id === 'group-1')
        const group2 = state.groups.find((group: any) => group.id === 'group-2')
        const group3 = state.groups.find((group: any) => group.id === 'group-3')
        const group4 = state.groups.find((group: any) => group.id === 'group-4')

        expect(state.activeGroupId).toBe('group-1')
        expect(group2.activeTerminalId).toBe('terminal-3')
        expect(normalizeLayoutTree(group1.layoutTree as SerializedLayoutNode)).toEqual(
          normalizeLayoutTree(baselineState.groups[0].layoutTree as SerializedLayoutNode)
        )
        expect(normalizeLayoutTree(group3.layoutTree as SerializedLayoutNode)).toEqual(
          normalizeLayoutTree(baselineState.groups[2].layoutTree as SerializedLayoutNode)
        )
        expect(normalizeLayoutTree(group4.layoutTree as SerializedLayoutNode)).toEqual(
          normalizeLayoutTree(baselineState.groups[3].layoutTree as SerializedLayoutNode)
        )
      } finally {
        await closeApp(app)
      }
    })
  }

  test('disables Mission Control presets for mixed-content groups with browser-backed leaves', async () => {
    const { app, page } = await launchApp()

    try {
      await openWorkspaceWithMissionControlBaseline(page)

      await page.getByTestId('activity-bar-mission-control').click()
      await expect(missionControlGroup(page, 'Group 4')).toBeVisible()

      await expect(missionControlPresetButton(page, 'group-4', '2col')).toBeDisabled()
      await expect(missionControlPresetButton(page, 'group-4', '2row')).toBeDisabled()
      await expect(missionControlPresetButton(page, 'group-4', '2x2')).toBeDisabled()
    } finally {
      await closeApp(app)
    }
  })

  test('keeps Mission Control card navigation working while switching to another group session', async () => {
    const { app, page } = await launchApp()

    try {
      await openWorkspaceWithMissionControlBaseline(page)

      await page.getByTestId('activity-bar-mission-control').click()
      const dialog = page.getByRole('dialog', { name: 'Mission Control' })
      await expect(dialog).toBeVisible()

      await missionControlGroup(page, 'Group 2')
        .locator('.mission-control__card')
        .filter({ hasText: 'Terminal 4' })
        .click()

      await expect(dialog).toHaveCount(0)
      await expect.poll(async () => {
        const state = await readWorkspaceState(page)
        return JSON.stringify({
          activeGroupId: state.activeGroupId,
          activeTerminalId: state.groups.find((group: any) => group.id === 'group-2')?.activeTerminalId
        })
      }).toBe(JSON.stringify({ activeGroupId: 'group-2', activeTerminalId: 'terminal-4' }))
    } finally {
      await closeApp(app)
    }
  })
})

