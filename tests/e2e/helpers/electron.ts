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
const workspaceHistoryBackups = new WeakMap<
  ElectronApplication,
  Map<string, { existed: boolean; content: Buffer | null }>
>()

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

function ensureWorkspaceHistoryBackups(page: Page, workspacePath: string): void {
  const app = pageToApp.get(page)
  if (!app) {
    throw new Error('Missing Electron application handle for page-backed history backup')
  }

  let backups = workspaceHistoryBackups.get(app)
  if (!backups) {
    backups = new Map()
    workspaceHistoryBackups.set(app, backups)
  }

  for (const historyPath of getWorkspaceHistoryPaths(workspacePath)) {
    if (backups.has(historyPath)) {
      continue
    }

    if (fs.existsSync(historyPath)) {
      backups.set(historyPath, {
        existed: true,
        content: fs.readFileSync(historyPath)
      })
      continue
    }

    backups.set(historyPath, {
      existed: false,
      content: null
    })
  }
}

function writeWorkspaceStateFile(
  page: Page,
  workspacePath: string,
  state: Record<string, unknown>
): void {
  ensureWorkspaceStateBackup(page, workspacePath)
  ensureWorkspaceHistoryBackups(page, workspacePath)
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

function restoreBackedUpWorkspaceHistory(app: ElectronApplication): void {
  const backups = workspaceHistoryBackups.get(app)
  if (!backups) {
    return
  }

  for (const [historyPath, backup] of backups.entries()) {
    if (backup.existed) {
      fs.mkdirSync(path.dirname(historyPath), { recursive: true })
      fs.writeFileSync(historyPath, backup.content ?? Buffer.alloc(0))
      continue
    }

    fs.rmSync(historyPath, { force: true })
  }

  workspaceHistoryBackups.delete(app)
}

function isClosedTargetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Target page, context or browser has been closed') ||
    message.includes('Browser has been closed') ||
    message.includes('Application closed')
  )
}

function waitForCloseOperation<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for Electron app to close after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  }) as Promise<T>
}

function forceKillAppProcess(app: ElectronApplication): void {
  const childProcess = (app as ElectronApplication & {
    process?: () => { pid?: number; kill?: (signal?: string | number) => boolean }
  }).process?.()

  if (!childProcess?.pid) {
    return
  }

  try {
    childProcess.kill?.()
  } catch {
    // Best-effort only. The cleanup path should not mask the original test result.
  }
}

function removeDirWithRetry(targetPath: string, attempts = 5): void {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true })
      return
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }
}

export async function launchApp(options: { env?: NodeJS.ProcessEnv } = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const mainPath = path.join(__dirname, '../../../out/main/index.js')
  const isolatedAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'workpane-e2e-'))

  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      ...options.env,
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

export async function closeApp(app: ElectronApplication, options: { restoreWorkspaceArtifacts?: boolean } = {}): Promise<void> {
  try {
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit()
    })
    await waitForCloseOperation(app.close(), 5000)
  } catch (error) {
    if (isClosedTargetError(error)) {
      return
    }

    try {
      await app.evaluate(({ app: electronApp }) => {
        electronApp.exit(0)
      })
      await waitForCloseOperation(app.close(), 5000)
    } catch (fallbackError) {
      if (isClosedTargetError(fallbackError)) {
        return
      }

      forceKillAppProcess(app)
      await app.close().catch(() => {})
    }
  } finally {
    if (options.restoreWorkspaceArtifacts !== false) {
      restoreBackedUpWorkspaceStates(app)
      restoreBackedUpWorkspaceHistory(app)
    }
    const isolatedAppData = appStoragePaths.get(app)
    if (isolatedAppData) {
      appStoragePaths.delete(app)
      removeDirWithRetry(isolatedAppData)
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
export async function openRecentWorkspace(
  page: Page,
  options?: { resetWorkspaceState?: boolean }
): Promise<void> {
  // Wait for welcome screen first so the renderer is ready
  await page.waitForSelector('.welcome', { timeout: 15000 })

  if (options?.resetWorkspaceState ?? true) {
    writeWorkspaceStateFile(page, E2E_WORKSPACE_PATH, {})
  }

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

export async function invokeMonitoringTestTransition(
  page: Page,
  event: {
    terminalId: string
    workspacePath: string
    timestamp?: number
    kind: 'entered' | 'updated' | 'cleared'
    reason?: 'write' | 'exit'
    category?: 'approval' | 'input-needed' | 'error' | 'unknown'
    confidence?: 'low' | 'medium' | 'high'
    source?: 'llm' | 'no-api'
    summary?: string
    patternName?: string
    matchedText?: string
  }
): Promise<void> {
  await page.evaluate(async (payload) => {
    await (window as any).electron.ipcRenderer.invoke('monitoring:test-transition', {
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
