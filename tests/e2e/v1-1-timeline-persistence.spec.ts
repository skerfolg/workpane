import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { closeApp, launchApp, openRecentWorkspace, invokeMonitoringTestTransition, WORKSPACE_PATH } from './helpers/electron'

interface FileSnapshot {
  existed: boolean
  content: Buffer | null
}

function getWorkspaceArtifactPaths(workspacePath: string): string[] {
  const workspaceDir = path.join(workspacePath, '.workspace')
  return [
    path.join(workspaceDir, 'state.json'),
    path.join(workspaceDir, 'workpane-history.json'),
    path.join(workspaceDir, 'workpane-history.sqlite'),
    path.join(workspaceDir, 'workpane-history.sqlite-shm'),
    path.join(workspaceDir, 'workpane-history.sqlite-wal')
  ]
}

function snapshotWorkspaceArtifacts(workspacePath: string): Map<string, FileSnapshot> {
  return new Map(
    getWorkspaceArtifactPaths(workspacePath).map((artifactPath) => [
      artifactPath,
      fs.existsSync(artifactPath)
        ? { existed: true, content: fs.readFileSync(artifactPath) }
        : { existed: false, content: null }
    ])
  )
}

function restoreWorkspaceArtifacts(snapshot: Map<string, FileSnapshot>): void {
  for (const [artifactPath, file] of snapshot.entries()) {
    if (file.existed) {
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
      fs.writeFileSync(artifactPath, file.content ?? Buffer.alloc(0))
      continue
    }

    fs.rmSync(artifactPath, { force: true })
  }
}

async function expectPersistedTimelineEntry(page: Page): Promise<void> {
  const storedEvents = await page.evaluate(async () => {
    return window.monitoringHistory.listSessionEvents('terminal-1', 'all', 10)
  })
  expect(storedEvents.length).toBeGreaterThan(0)

  await page.getByText('Terminal 1').first().click()
  await page.getByTestId('terminal-persisted-timeline-toggle').first().click({ force: true })
  await expect(page.getByText(/Entered · Approval needed/i)).toBeVisible()
  await expect(page.getByText(/entered · llm classification · high confidence/i)).toBeVisible()
}

async function seedPersistedTimeline(page: Page): Promise<void> {
  await invokeMonitoringTestTransition(page, {
    terminalId: 'terminal-1',
    workspacePath: WORKSPACE_PATH,
    kind: 'entered',
    category: 'approval',
    confidence: 'high',
    source: 'llm',
    summary: 'Approval needed',
    patternName: 'Approve changes?',
    matchedText: 'Approve changes?'
  })
}

test.describe('v1.1 Timeline Persistence', () => {
  test('shows persisted timeline events after renderer reload', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)
      await seedPersistedTimeline(page)

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.activity-bar', { timeout: 15000 })

      await expectPersistedTimelineEntry(page)
    } finally {
      await closeApp(app)
    }
  })

  test('keeps persisted timeline history after same-workspace reopen while live attention resets', async () => {
    const { app, page } = await launchApp()

    try {
      await openRecentWorkspace(page)
      await seedPersistedTimeline(page)

      await expect(page.locator('[data-testid="monitoring-global-feed-trigger"]').first()).toContainText('Recent')

      await page.evaluate(async (workspacePath) => {
        await window.workspace.openPath(workspacePath)
      }, WORKSPACE_PATH)
      await page.waitForSelector('.activity-bar', { timeout: 15000 })

      await expect(page.locator('[data-testid="monitoring-global-feed-trigger"]').first()).toHaveCount(0)
      await expectPersistedTimelineEntry(page)
    } finally {
      await closeApp(app)
    }
  })

  test('restores persisted timeline history after a fresh app relaunch on the same workspace', async () => {
    const artifactSnapshot = snapshotWorkspaceArtifacts(WORKSPACE_PATH)
    const firstRun = await launchApp()

    try {
      await openRecentWorkspace(firstRun.page)
      await seedPersistedTimeline(firstRun.page)
    } finally {
      await closeApp(firstRun.app, { restoreWorkspaceArtifacts: false })
    }

    const secondRun = await launchApp()

    try {
      await openRecentWorkspace(secondRun.page)
      await expectPersistedTimelineEntry(secondRun.page)
    } finally {
      await closeApp(secondRun.app, { restoreWorkspaceArtifacts: false })
      restoreWorkspaceArtifacts(artifactSnapshot)
    }
  })
})
