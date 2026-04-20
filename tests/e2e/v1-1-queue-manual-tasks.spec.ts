import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { closeApp, launchApp, openRecentWorkspace, WORKSPACE_PATH } from './helpers/electron'

interface FileSnapshot {
  existed: boolean
  content: Buffer | null
}

function getWorkspaceStatePath(workspacePath: string): string {
  return path.join(workspacePath, '.workspace', 'state.json')
}

function getWorkspaceHistoryPaths(workspacePath: string): string[] {
  const workspaceDir = path.join(workspacePath, '.workspace')
  return [
    path.join(workspaceDir, 'workpane-history.json'),
    path.join(workspaceDir, 'workpane-history.sqlite'),
    path.join(workspaceDir, 'workpane-history.sqlite-shm'),
    path.join(workspaceDir, 'workpane-history.sqlite-wal')
  ]
}

function snapshotWorkspaceState(workspacePath: string): FileSnapshot {
  const statePath = getWorkspaceStatePath(workspacePath)
  if (!fs.existsSync(statePath)) {
    return {
      existed: false,
      content: null
    }
  }

  return {
    existed: true,
    content: fs.readFileSync(statePath)
  }
}

function restoreWorkspaceState(workspacePath: string, snapshot: FileSnapshot): void {
  const statePath = getWorkspaceStatePath(workspacePath)
  if (snapshot.existed) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, snapshot.content ?? Buffer.alloc(0))
    return
  }

  fs.rmSync(statePath, { force: true })
}

function snapshotWorkspaceHistory(workspacePath: string): Map<string, FileSnapshot> {
  const snapshots = new Map<string, FileSnapshot>()
  for (const historyPath of getWorkspaceHistoryPaths(workspacePath)) {
    if (fs.existsSync(historyPath)) {
      snapshots.set(historyPath, {
        existed: true,
        content: fs.readFileSync(historyPath)
      })
      continue
    }

    snapshots.set(historyPath, {
      existed: false,
      content: null
    })
  }
  return snapshots
}

function restoreWorkspaceHistory(snapshots: Map<string, FileSnapshot>): void {
  for (const [historyPath, snapshot] of snapshots.entries()) {
    if (snapshot.existed) {
      fs.mkdirSync(path.dirname(historyPath), { recursive: true })
      fs.writeFileSync(historyPath, snapshot.content ?? Buffer.alloc(0))
      continue
    }

    fs.rmSync(historyPath, { force: true })
  }
}


async function reopenExistingWorkspace(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('.welcome', { timeout: 15000 })
  await page.evaluate(async (workspacePath) => {
    await window.workspace.openPath(workspacePath)
  }, WORKSPACE_PATH)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.activity-bar', { timeout: 15000 })
}

test.describe('v1.1 Queue Manual Tasks', () => {
  test('adds and completes a manual task from the sidebar queue', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)

      await page.evaluate(async () => {
        await window.monitoringHistory.createManualTask(
          'Follow up review',
          'Check the persistent timeline output'
        )
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.activity-bar', { timeout: 15000 })

      const queue = page.getByTestId('monitoring-queue')
      await expect(queue).toContainText('Follow up review')
      await expect(queue).toContainText('manual task')

      await page.evaluate(async () => {
        const tasks = await window.monitoringHistory.listManualTasks()
        const target = tasks.find((task) => task.title === 'Follow up review')
        if (target) {
          await window.monitoringHistory.completeManualTask(target.id)
        }
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.activity-bar', { timeout: 15000 })

      await expect(queue).toContainText('Recent completed')
      await expect(queue).toContainText('Follow up review')
    } finally {
      await closeApp(app)
    }
  })

  test('restores manual tasks after a fresh app relaunch through workspace state persistence', async () => {
    const workspaceStateSnapshot = snapshotWorkspaceState(WORKSPACE_PATH)
    const workspaceHistorySnapshots = snapshotWorkspaceHistory(WORKSPACE_PATH)
    const firstRun = await launchApp()

    try {
      await openRecentWorkspace(firstRun.page)
      await firstRun.page.evaluate(async () => {
        await window.monitoringHistory.createManualTask(
          'Relaunch persistence task',
          'Stored through workspace state'
        )
      })
    } finally {
      await closeApp(firstRun.app, { restoreWorkspaceArtifacts: false })
    }

    const secondRun = await launchApp()

    try {
      await reopenExistingWorkspace(secondRun.page)

      const queue = secondRun.page.getByTestId('monitoring-queue')
      await expect(queue).toContainText('Relaunch persistence task')
      await expect(queue).toContainText('manual task')
    } finally {
      await closeApp(secondRun.app, { restoreWorkspaceArtifacts: false })
      restoreWorkspaceState(WORKSPACE_PATH, workspaceStateSnapshot)
      restoreWorkspaceHistory(workspaceHistorySnapshots)
    }
  })
})
