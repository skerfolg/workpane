import fs from 'node:fs'
import os from 'node:os'
import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'path'

const E2E_WORKSPACE_PATH =
  process.env.E2E_WORKSPACE_PATH ??
  path.join(process.cwd())

export const WORKSPACE_PATH = E2E_WORKSPACE_PATH

const appStoragePaths = new WeakMap<ElectronApplication, string>()
const pageToApp = new WeakMap<Page, ElectronApplication>()
const workspaceStateBackups = new WeakMap<
  ElectronApplication,
  Map<string, { existed: boolean; content: string | null }>
>()

function getWorkspaceStatePath(workspacePath: string): string {
  return path.join(workspacePath, '.workspace', 'state.json')
}

function ensureWorkspaceStateBackup(page: Page, workspacePath: string): void {
  const app = pageToApp.get(page)
  if (!app) {
    throw new Error('Missing Electron application handle for page-backed workspace mutation')
  }

  let backups = workspaceStateBackups.get(app)
  if (!backups) {
    backups = new Map()
    workspaceStateBackups.set(app, backups)
  }

  const workspaceStatePath = getWorkspaceStatePath(workspacePath)
  if (backups.has(workspaceStatePath)) {
    return
  }

  if (fs.existsSync(workspaceStatePath)) {
    backups.set(workspaceStatePath, {
      existed: true,
      content: fs.readFileSync(workspaceStatePath, 'utf-8')
    })
    return
  }

  backups.set(workspaceStatePath, {
    existed: false,
    content: null
  })
}

function writeWorkspaceStateFile(
  page: Page,
  workspacePath: string,
  state: Record<string, unknown>
): void {
  ensureWorkspaceStateBackup(page, workspacePath)
  const workspaceStatePath = getWorkspaceStatePath(workspacePath)
  fs.mkdirSync(path.dirname(workspaceStatePath), { recursive: true })
  fs.writeFileSync(workspaceStatePath, JSON.stringify(state), 'utf-8')
}

function restoreBackedUpWorkspaceStates(app: ElectronApplication): void {
  const backups = workspaceStateBackups.get(app)
  if (!backups) {
    return
  }

  for (const [workspaceStatePath, backup] of backups.entries()) {
    if (backup.existed) {
      fs.mkdirSync(path.dirname(workspaceStatePath), { recursive: true })
      fs.writeFileSync(workspaceStatePath, backup.content ?? '{}', 'utf-8')
      continue
    }

    fs.rmSync(workspaceStatePath, { force: true })
  }

  workspaceStateBackups.delete(app)
}

function isClosedTargetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Target page, context or browser has been closed') ||
    message.includes('Browser has been closed') ||
    message.includes('Application closed')
  )
}

function waitForAppClose(app: ElectronApplication, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      app.removeListener('close', handleClose)
      reject(new Error(`Timed out waiting for Electron app to close after ${timeoutMs}ms`))
    }, timeoutMs)

    const handleClose = () => {
      clearTimeout(timer)
      resolve()
    }

    app.once('close', handleClose)
  })
}

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const mainPath = path.join(__dirname, '../../../out/main/index.js')
  const isolatedAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'workpane-e2e-'))

  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APPDATA: isolatedAppData,
      LOCALAPPDATA: isolatedAppData,
      TEMP: isolatedAppData,
      TMP: isolatedAppData
    },
  })
  appStoragePaths.set(app, isolatedAppData)

  const page = await app.firstWindow()
  pageToApp.set(page, app)
  await page.waitForLoadState('domcontentloaded')

  return { app, page }
}

export async function closeApp(app: ElectronApplication): Promise<void> {
  try {
    const closeEvent = waitForAppClose(app, 5000)
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit()
    })
    await Promise.race([app.close(), closeEvent])
  } catch (error) {
    if (isClosedTargetError(error)) {
      return
    }

    try {
      const closeEvent = waitForAppClose(app, 5000)
      await app.evaluate(({ app: electronApp }) => {
        electronApp.exit(0)
      })
      await Promise.race([app.close(), closeEvent])
    } catch (fallbackError) {
      if (!isClosedTargetError(fallbackError)) {
        throw fallbackError
      }
    }
  } finally {
    restoreBackedUpWorkspaceStates(app)
    const isolatedAppData = appStoragePaths.get(app)
    if (isolatedAppData) {
      appStoragePaths.delete(app)
      fs.rmSync(isolatedAppData, { recursive: true, force: true })
    }
  }
}

export async function emitRendererMonitoringUpsert(
  app: ElectronApplication,
  event: {
    terminalId: string
    workspacePath: string
    patternName: string
    matchedText: string
    status?: 'attention-needed'
    category: 'approval' | 'input-needed' | 'error' | 'unknown'
    confidence: 'low' | 'medium' | 'high'
    source: 'llm' | 'no-api'
    summary: string
    timestamp?: number
  }
): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, payload) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.send('terminal:monitoring-upsert', {
      ...payload,
      status: payload.status ?? 'attention-needed',
      timestamp: payload.timestamp ?? Date.now()
    })
  }, event)
}

export async function emitRendererMonitoringClear(
  app: ElectronApplication,
  event: {
    terminalId: string
    reason: 'write' | 'exit'
    timestamp?: number
  }
): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, payload) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.send('terminal:monitoring-clear', {
      ...payload,
      timestamp: payload.timestamp ?? Date.now()
    })
  }, event)
}

/**
 * Opens a known workspace through the preload bridge
 * and waits for the main app layout (activity bar) to appear.
 */
export async function openRecentWorkspace(page: Page): Promise<void> {
  // Wait for welcome screen first so the renderer is ready
  await page.waitForSelector('.welcome', { timeout: 15000 })

  writeWorkspaceStateFile(page, E2E_WORKSPACE_PATH, {})

  // Avoid flaky recent-workspace UI dependence in Electron smoke runs.
  await page.evaluate(async (workspacePath) => {
    await window.workspace.openPath(workspacePath)
  }, E2E_WORKSPACE_PATH)
  await page.reload({ waitUntil: 'domcontentloaded' })

  // Wait for main layout to render
  await page.waitForSelector('.activity-bar', { timeout: 15000 })
}

export async function getWorkspaceState(page: Page): Promise<any> {
  return page.evaluate(async () => window.workspace.getState())
}

export async function invokeMonitoringTestUpsert(
  page: Page,
  event: {
    terminalId: string
    workspacePath: string
    patternName: string
    matchedText: string
    status?: 'attention-needed'
    category: 'approval' | 'input-needed' | 'error' | 'unknown'
    confidence: 'low' | 'medium' | 'high'
    source: 'llm' | 'no-api'
    summary: string
    timestamp?: number
  }
): Promise<void> {
  await page.evaluate(async (payload) => {
    await (window as any).electron.ipcRenderer.invoke('monitoring:test-upsert', {
      ...payload,
      status: payload.status ?? 'attention-needed',
      timestamp: payload.timestamp ?? Date.now()
    })
  }, event)
}

export async function invokeMonitoringTestClear(
  page: Page,
  event: {
    terminalId: string
    reason: 'write' | 'exit'
    timestamp?: number
  }
): Promise<void> {
  await page.evaluate(async (payload) => {
    await (window as any).electron.ipcRenderer.invoke('monitoring:test-clear', {
      ...payload,
      timestamp: payload.timestamp ?? Date.now()
    })
  }, event)
}

export async function resetWorkspaceStateFile(
  page: Page,
  state: Record<string, unknown>,
  workspacePath = WORKSPACE_PATH
): Promise<void> {
  writeWorkspaceStateFile(page, workspacePath, state)
}
