import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initAutoUpdater } from './auto-updater'
import { TerminalManager } from './terminal-manager'
import { SettingsManager } from './settings-manager'
import { WorkspaceManager } from './workspace-manager'
import { WatcherManager } from './file-watcher'
import { searchFiles, replaceInFiles, invalidateSearchCache } from './search-service'
import { ApiServer } from './api-server'
import { CrashRecovery } from './crash-recovery'
import { assertWithinWorkspace } from './path-validator'
import { ApprovalDetector } from './approval-detector'
import { BrowserManager } from './browser-manager'
import { McpBrowserHandler } from './mcp-browser-server'
import { HistoryStore } from './history-store'
import { CcHookAdapter } from './l0/adapters/cc-hook-adapter'
import { CcSessionLogAdapter } from './l0/adapters/cc-session-log-adapter'
import { CcStreamJsonAdapter } from './l0/adapters/cc-stream-json-adapter'
import { L0Orchestrator } from './l0/l0-orchestrator'
import { L0Pipeline } from './l0/pipeline'
import { HookServer } from './l0/hook-server'
import { registerHookListener, unregisterHookListener } from './l0/hook-registry'
import { SessionLogTailerPool } from './l0/session-log-tailer-pool'
import * as path from 'path'
import { LlmManager } from './llm/manager'
import type {
  ApprovalDetectedEvent,
  LlmExecutionLane,
  LlmLaneConnectResult,
  LlmLaneMoveDelta,
  ManualTaskRecord,
  MonitoringHistoryEvent,
  MonitoringTimelineFilter,
  LlmProviderId,
  SessionMonitoringClearEvent,
  SessionMonitoringState,
  SessionMonitoringTransitionEvent
} from '../shared/types'
import { isLlmProviderId } from '../shared/types'

if (process.env.NODE_ENV === 'test' && process.env.APPDATA) {
  app.setPath('userData', join(process.env.APPDATA, 'Electron'))
}

const terminalManager = new TerminalManager()
const browserManager = new BrowserManager()
const settingsManager = new SettingsManager()
const llmManager = new LlmManager(settingsManager)
const workspaceManager = new WorkspaceManager(settingsManager)
const historyStore = new HistoryStore()
const watcherManager = new WatcherManager()

// Keep search results coherent after watcher batches flush to the renderer.
watcherManager.onFlush((rootDir) => {
  setImmediate(() => {
    invalidateSearchCache(rootDir)
  })
})

const apiServer = new ApiServer(terminalManager, workspaceManager, settingsManager)
const mcpBrowserHandler = new McpBrowserHandler(browserManager)
apiServer.setMcpBrowserHandler(mcpBrowserHandler)
const crashRecovery = new CrashRecovery()
let mainWindow: BrowserWindow | null = null
// RW-B/E: hoisted so before-quit can reach them for explicit dispose
// (code-reviewer MEDIUM). Assigned once inside app.whenReady().
let l0OrchestratorRef: L0Orchestrator | null = null
let tailerPoolRef: SessionLogTailerPool | null = null
const monitoredTerminals = new Map<string, SessionMonitoringState>()
const monitoringTransitionSequences = new Map<string, number>()

function resetMonitoringLifecycleState(): void {
  monitoredTerminals.clear()
  monitoringTransitionSequences.clear()
}

function getBridgeCommandCwd(): string {
  const workspace = workspaceManager.getCurrentWorkspace()
  return workspace?.path || process.env.USERPROFILE || process.env.HOME || process.cwd()
}

function nextMonitoringTransitionSequence(terminalId: string): number {
  const next = (monitoringTransitionSequences.get(terminalId) ?? 0) + 1
  monitoringTransitionSequences.set(terminalId, next)
  return next
}

function buildMonitoringSemanticKey(state: SessionMonitoringState): string {
  return JSON.stringify({
    category: state.category,
    confidence: state.confidence,
    source: state.source,
    summary: state.summary,
    patternName: state.patternName,
    matchedText: state.matchedText
  })
}

function buildMonitoringTransitionFields(state: SessionMonitoringState): Pick<
  SessionMonitoringTransitionEvent,
  'workspacePath' | 'category' | 'confidence' | 'source' | 'summary' | 'patternName' | 'matchedText'
> {
  return {
    workspacePath: state.workspacePath,
    category: state.category,
    confidence: state.confidence,
    source: state.source,
    summary: state.summary,
    patternName: state.patternName,
    matchedText: state.matchedText
  }
}

function emitMonitoringTransition(
  transition: Omit<SessionMonitoringTransitionEvent, 'id' | 'sequence'> & { sequence?: number }
): void {
  const sequence = transition.sequence ?? nextMonitoringTransitionSequence(transition.terminalId)
  const event: SessionMonitoringTransitionEvent = {
    ...transition,
    id: `${transition.terminalId}:${sequence}:${transition.kind}`,
    sequence
  }

  historyStore.appendMonitoringTransition(event)

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal:monitoring-transition', event)
  }
}

const MANUAL_TASKS_STATE_KEY = 'monitoringManualTasks'

async function getManualTasksState(): Promise<ManualTaskRecord[]> {
  const state = await workspaceManager.getWorkspaceState()
  const rawTasks = state?.[MANUAL_TASKS_STATE_KEY]
  if (!Array.isArray(rawTasks)) {
    return []
  }

  return rawTasks
    .filter((task): task is ManualTaskRecord => typeof task === 'object' && task != null && typeof (task as { id?: unknown }).id === 'string')
    .sort((left, right) => left.order - right.order || right.updatedAt - left.updatedAt)
}

async function saveManualTasksState(tasks: ManualTaskRecord[]): Promise<void> {
  workspaceManager.saveWorkspaceStateSync({
    [MANUAL_TASKS_STATE_KEY]: tasks
  })
}

function buildManualTaskId(): string {
  return `manual-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function emitMonitoringUpsert(state: SessionMonitoringState): void {
  const previous = monitoredTerminals.get(state.terminalId)
  const previousKey = previous ? buildMonitoringSemanticKey(previous) : null
  const nextKey = buildMonitoringSemanticKey(state)
  monitoredTerminals.set(state.terminalId, state)

  if (!previous) {
    emitMonitoringTransition({
      terminalId: state.terminalId,
      timestamp: state.timestamp,
      kind: 'entered',
      ...buildMonitoringTransitionFields(state)
    })
  } else if (previousKey !== nextKey) {
    emitMonitoringTransition({
      terminalId: state.terminalId,
      timestamp: state.timestamp,
      kind: 'updated',
      ...buildMonitoringTransitionFields(state)
    })
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal:monitoring-upsert', state)
  }
}

function emitMonitoringClear(event: SessionMonitoringClearEvent): void {
  const previous = monitoredTerminals.get(event.terminalId)
  monitoredTerminals.delete(event.terminalId)

  if (previous) {
    emitMonitoringTransition({
      terminalId: event.terminalId,
      timestamp: event.timestamp,
      kind: 'cleared',
      reason: event.reason,
      ...buildMonitoringTransitionFields(previous)
    })
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal:monitoring-clear', event)
  }
}

function createWindow(): void {
  const _perfStart = performance.now()
  console.log(`[PERF][Main] createWindow: start`)
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })
  console.log(`[PERF][Main] createWindow: BrowserWindow constructed ${(performance.now() - _perfStart).toFixed(1)}ms`)

  // Timeout: force-show window if ready-to-show never fires
  const readyTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.error(`[DEBUG][Main] ready-to-show timeout (10s) — force-showing window`)
      mainWindow.show()
    }
  }, 10_000)

  mainWindow.on('ready-to-show', () => {
    clearTimeout(readyTimeout)
    console.log(`[PERF][Main] createWindow: ready-to-show ${(performance.now() - _perfStart).toFixed(1)}ms`)
    mainWindow!.show()
    watcherManager.setWindow(mainWindow!)
    initAutoUpdater(mainWindow!)
  })

  // --- Renderer process crash/unresponsive diagnostics ---
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[DEBUG][Main] render-process-gone — reason: ${details.reason}, exitCode: ${details.exitCode}`)
    // Attempt automatic recovery by reloading the renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log(`[DEBUG][Main] Attempting renderer reload after crash...`)
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload()
        }
      }, 1000)
    }
  })

  mainWindow.webContents.on('unresponsive', () => {
    console.error(`[DEBUG][Main] webContents became unresponsive at ${new Date().toISOString()}`)
  })

  mainWindow.webContents.on('responsive', () => {
    console.log(`[DEBUG][Main] webContents became responsive again at ${new Date().toISOString()}`)
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[DEBUG][Main] did-fail-load — code: ${errorCode}, desc: ${errorDescription}, url: ${validatedURL}`)
  })

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[DEBUG][Main] preload-error — path: ${preloadPath}, error:`, error)
  })

  mainWindow.on('close', () => {
    console.log(`[DEBUG][Main] mainWindow close event at ${new Date().toISOString()}`)
  })

  mainWindow.on('closed', () => {
    console.log(`[DEBUG][Main] mainWindow closed event at ${new Date().toISOString()}`)
  })

  // Notify renderer when maximize state changes (for titlebar icon)
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  console.log(`[PERF][Main] createWindow: done ${(performance.now() - _perfStart).toFixed(1)}ms`)
}

function ensureTerminalCreated(
  id: string,
  shellPath?: string,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
  vendorHint?: import('../shared/types').L0Vendor,
  spawnArgs?: string[]
): void {
  if (process.env.NODE_ENV === 'test') {
    return
  }

  if (terminalManager.get(id)) {
    return
  }

  terminalManager.create(id, { shell: shellPath, cwd, env, vendorHint, spawnArgs })
  const term = terminalManager.get(id)
  if (!term) return

  const onDataDisposable = term.onData((data) => {
    terminalManager.appendToBuffer(id, data)
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`terminal:data:${id}`, { id, data })
      }
    } catch {
      // Window already destroyed during shutdown — safe to ignore
    }
  })

  const onExitDisposable = term.onExit(({ exitCode }) => {
    emitMonitoringClear({
      terminalId: id,
      reason: 'exit',
      timestamp: Date.now()
    })
    monitoringTransitionSequences.delete(id)
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', { id, exitCode })
      }
    } catch {
      // Window already destroyed during shutdown — safe to ignore
    }
    terminalManager.kill(id)
  })

  terminalManager.addDisposable(id, onDataDisposable)
  terminalManager.addDisposable(id, onExitDisposable)
}

// IPC handlers for terminal
ipcMain.handle('terminal:create', (_event, params: {
  id: string
  shell?: string
  cwd?: string
  vendorHint?: import('../shared/types').L0Vendor
  spawnArgs?: string[]
}) => {
  ensureTerminalCreated(params.id, params.shell, params.cwd, undefined, params.vendorHint, params.spawnArgs)
})

ipcMain.handle('terminal:l0-status', (_event, { id }: { id: string }) => {
  return terminalManager.getL0Status(id)
})

ipcMain.on('terminal:write', (_event, { id, data }: { id: string; data: string }) => {
  if (monitoredTerminals.has(id)) {
    emitMonitoringClear({
      terminalId: id,
      reason: 'write',
      timestamp: Date.now()
    })
  }
  terminalManager.write(id, data)
})

ipcMain.on('terminal:resize', (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
  terminalManager.resize(id, cols, rows)
})

ipcMain.handle('terminal:kill', (_event, { id }: { id: string }) => {
  monitoringTransitionSequences.delete(id)
  terminalManager.kill(id)
})

ipcMain.handle('terminal:get-scrollback', (_event, { id }: { id: string }) => {
  return terminalManager.getScrollback(id)
})

if (process.env.NODE_ENV === 'test') {
  ipcMain.handle('monitoring:test-upsert', (_event, state: SessionMonitoringState) => {
    emitMonitoringUpsert(state)
  })

  ipcMain.handle('monitoring:test-clear', (_event, event: SessionMonitoringClearEvent) => {
    emitMonitoringClear(event)
  })

  ipcMain.handle('monitoring:test-transition', (_event, event: Omit<SessionMonitoringTransitionEvent, 'id' | 'sequence'>) => {
    emitMonitoringTransition(event)
  })
}

// IPC handlers for settings
ipcMain.handle('settings:get', (_event, key?: string) => {
  return settingsManager.get(key)
})

ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
  settingsManager.set(key, value)
})

// IPC handlers for LLM integration
ipcMain.handle('llm:get-settings-state', async () => {
  const state = llmManager.getSettingsState()
  const credentials = await llmManager.getCredentialPresence()
  for (const providerId of Object.keys(credentials) as LlmProviderId[]) {
    state.providers[providerId].apiKeyStored = credentials[providerId]
  }
  return state
})

ipcMain.handle('llm:get-storage-status', () => {
  return llmManager.getStorageStatus()
})

ipcMain.handle('llm:set-selected-model', (_event, providerId: LlmProviderId, modelId: string) => {
  if (!isLlmProviderId(providerId)) throw new Error('Invalid LLM provider id.')
  llmManager.setSelectedModel(providerId, modelId)
})

ipcMain.handle('llm:set-consent', (_event, enabled: boolean) => {
  llmManager.setConsentEnabled(enabled)
})

ipcMain.handle('llm:set-lane-enabled', (_event, laneId: string, enabled: boolean) => {
  llmManager.setLaneEnabled(laneId, enabled)
})

ipcMain.handle('llm:move-lane', (_event, laneId: string, delta: LlmLaneMoveDelta) => {
  if (delta !== -1 && delta !== 1) {
    throw new Error('Invalid lane move delta.')
  }
  llmManager.moveLane(laneId, delta)
})

ipcMain.handle('llm:set-api-key', async (_event, providerId: LlmProviderId, apiKey: string) => {
  if (!isLlmProviderId(providerId)) throw new Error('Invalid LLM provider id.')
  await llmManager.setApiKey(providerId, apiKey)
})

ipcMain.handle('llm:clear-api-key', async (_event, providerId: LlmProviderId) => {
  if (!isLlmProviderId(providerId)) throw new Error('Invalid LLM provider id.')
  await llmManager.clearApiKey(providerId)
})

ipcMain.handle('llm:list-models', async (_event, providerId: LlmProviderId) => {
  if (!isLlmProviderId(providerId)) throw new Error('Invalid LLM provider id.')
  return llmManager.listModels(providerId)
})

ipcMain.handle('llm:connect', async (_event, laneId: string): Promise<LlmLaneConnectResult & { guidance: string; lane: LlmExecutionLane }> => {
  const result = await llmManager.connectLane(laneId, {
    launch: async ({ laneId: connectLaneId, command, args, env }) => {
      const laneToken = connectLaneId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      const terminalId = `llm-bridge-${laneToken}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      ensureTerminalCreated(terminalId, undefined, getBridgeCommandCwd(), env)
      terminalManager.write(terminalId, [command, ...args].join(' ') + '\r')
      return { terminalId }
    }
  })
  const lane = llmManager.getSettingsState().executionLanes.find((entry) => entry.laneId === laneId)
  if (!lane) {
    throw new Error(`Unknown execution lane: ${laneId}`)
  }
  return {
    ...result,
    guidance: result.detail ?? 'Complete authentication in the dedicated terminal surface.',
    lane
  }
})

ipcMain.handle('llm:disconnect', async (_event, laneId: string) => {
  return llmManager.disconnectLane(laneId)
})

ipcMain.handle('llm:refresh-state', async (_event, laneId: string) => {
  return await llmManager.refreshLaneState(laneId)
})

ipcMain.handle('llm:validate', async (_event, laneId: string) => {
  return await llmManager.validateLane(laneId)
})

ipcMain.handle('llm:classify-preview', async (_event, input) => {
  if (!is.dev && process.env.NODE_ENV !== 'test') {
    throw new Error('llm:classify-preview is only available in development or test mode.')
  }
  return llmManager.classifyCandidate(input)
})

ipcMain.handle('history:get-status', async () => {
  return historyStore.getStatus()
})

ipcMain.handle('history:list-session-events', async (
  _event,
  terminalId: string,
  filter: MonitoringTimelineFilter = 'all',
  limit = 200
): Promise<MonitoringHistoryEvent[]> => {
  return historyStore.listSessionEvents(terminalId, filter, limit)
})

ipcMain.handle('history:list-workspace-feed', async (
  _event,
  limit = 100
): Promise<MonitoringHistoryEvent[]> => {
  return historyStore.listWorkspaceFeed(limit)
})

ipcMain.handle('history:list-manual-tasks', async () => {
  return await getManualTasksState()
})

ipcMain.handle('history:list-recent-completed', async (_event, limit = 10) => {
  const tasks = await getManualTasksState()
  return tasks
    .filter((task) => task.status === 'completed')
    .sort((left, right) => (right.completedAt ?? 0) - (left.completedAt ?? 0))
    .slice(0, limit)
})

ipcMain.handle('history:create-manual-task', async (_event, title: string, note?: string | null) => {
  const tasks = await getManualTasksState()
  const now = Date.now()
  const nextTask: ManualTaskRecord = {
    id: buildManualTaskId(),
    title: title.trim(),
    note: typeof note === 'string' && note.trim() ? note.trim() : null,
    status: 'active',
    order: tasks.filter((task) => task.status === 'active').length,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    linkedTerminalId: null,
    linkedEventId: null
  }
  const nextTasks = [...tasks, nextTask]
  await saveManualTasksState(nextTasks)
  return nextTask
})

ipcMain.handle('history:update-manual-task', async (
  _event,
  taskId: string,
  updates: Partial<Pick<ManualTaskRecord, 'title' | 'note'>>
) => {
  const tasks = await getManualTasksState()
  const now = Date.now()
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) {
      return task
    }
    return {
      ...task,
      title: typeof updates.title === 'string' && updates.title.trim() ? updates.title.trim() : task.title,
      note: typeof updates.note === 'string'
        ? (updates.note.trim() ? updates.note.trim() : null)
        : task.note,
      updatedAt: now
    }
  })
  await saveManualTasksState(nextTasks)
  return nextTasks.find((task) => task.id === taskId) ?? null
})

ipcMain.handle('history:reorder-manual-tasks', async (_event, taskIds: string[]) => {
  const tasks = await getManualTasksState()
  const taskById = new Map(tasks.map((task) => [task.id, task] as const))
  let nextOrder = 0
  const reorderedTasks: ManualTaskRecord[] = []

  for (const taskId of taskIds) {
    const task = taskById.get(taskId)
    if (!task || task.status !== 'active') {
      continue
    }
    reorderedTasks.push({
      ...task,
      order: nextOrder++,
      updatedAt: Date.now()
    })
    taskById.delete(taskId)
  }

  for (const task of tasks) {
    if (!taskById.has(task.id)) {
      continue
    }
    if (task.status === 'active') {
      reorderedTasks.push({
        ...task,
        order: nextOrder++,
        updatedAt: Date.now()
      })
      continue
    }
    reorderedTasks.push(task)
  }

  await saveManualTasksState(reorderedTasks)
  return reorderedTasks
})

ipcMain.handle('history:complete-manual-task', async (
  _event,
  taskId: string,
  link?: { terminalId?: string | null; eventId?: string | null }
) => {
  const tasks = await getManualTasksState()
  const now = Date.now()
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) {
      return task
    }
    return {
      ...task,
      status: 'completed' as const,
      completedAt: now,
      updatedAt: now,
      linkedTerminalId: link?.terminalId ?? task.linkedTerminalId ?? null,
      linkedEventId: link?.eventId ?? task.linkedEventId ?? null
    }
  })
  await saveManualTasksState(nextTasks)
  return nextTasks.find((task) => task.id === taskId) ?? null
})

// IPC handlers for workspace
ipcMain.handle('workspace:open', async () => {
  const _t = performance.now()
  console.log(`[PERF][Main] workspace:open start`)
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const dirPath = result.filePaths[0]
  console.log(`[PERF][Main] workspace:open → openWorkspace`)
  const workspaceInfo = workspaceManager.openWorkspace(dirPath)
  historyStore.openWorkspace(dirPath)
  resetMonitoringLifecycleState()
  mainWindow?.webContents.send('workspace:changed', workspaceInfo)
  console.log(`[PERF][Main] workspace:open done ${(performance.now() - _t).toFixed(1)}ms`)
  return workspaceInfo
})

ipcMain.handle('workspace:open-path', (_event, dirPath: string) => {
  const _t = performance.now()
  console.log(`[PERF][Main] workspace:open-path start path=${dirPath}`)
  const workspaceInfo = workspaceManager.openWorkspace(dirPath)
  historyStore.openWorkspace(dirPath)
  resetMonitoringLifecycleState()
  mainWindow?.webContents.send('workspace:changed', workspaceInfo)
  console.log(`[PERF][Main] workspace:open-path done ${(performance.now() - _t).toFixed(1)}ms`)
  return workspaceInfo
})

ipcMain.handle('workspace:close', () => {
  workspaceManager.closeWorkspace()
  historyStore.closeWorkspace()
  resetMonitoringLifecycleState()
  mainWindow?.webContents.send('workspace:changed', null)
})

ipcMain.handle('workspace:get-current', () => {
  return workspaceManager.getCurrentWorkspace()
})

ipcMain.handle('workspace:get-recent', () => {
  return workspaceManager.listWorkspaces()
})

ipcMain.handle('workspace:save-state', (_event, state: Record<string, unknown>) => {
  workspaceManager.saveWorkspaceState(state)
})

ipcMain.handle('workspace:get-state', () => {
  return workspaceManager.getWorkspaceState()
})

// IPC handlers for file system
function getWorkspaceRoot(): string {
  const ws = workspaceManager.getCurrentWorkspace()
  if (!ws) throw new Error('No workspace open')
  return ws.path
}

ipcMain.handle('fs:read-file', (_event, filePath: string) => {
  assertWithinWorkspace(filePath, getWorkspaceRoot())
  return fs.promises.readFile(filePath, 'utf-8')
})

ipcMain.handle('fs:read-file-stream', async (_event, filePath: string) => {
  assertWithinWorkspace(filePath, getWorkspaceRoot())
  const perfStart = performance.now()
  const chunks: string[] = []
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 })
  for await (const chunk of stream) {
    chunks.push(chunk as string)
  }
  console.log(`[PERF][Main] fs:read-file-stream ${filePath} ${(performance.now() - perfStart).toFixed(1)}ms`)
  return chunks.join('')
})

ipcMain.handle('fs:write-file', (_event, { path: filePath, content }: { path: string; content: string }) => {
  assertWithinWorkspace(filePath, getWorkspaceRoot())
  return fs.promises.writeFile(filePath, content, 'utf-8')
})

ipcMain.handle('fs:read-dir', async (_event, dirPath: string) => {
  assertWithinWorkspace(dirPath, getWorkspaceRoot())
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  return entries.map((entry) => {
    const fullPath = path.join(dirPath, entry.name)
    return {
      name: entry.name,
      isDirectory: entry.isDirectory(),
      size: 0,
      path: fullPath
    }
  })
})

ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
  assertWithinWorkspace(dirPath, getWorkspaceRoot())
  await fs.promises.mkdir(dirPath, { recursive: true })
})

ipcMain.handle('fs:rename', async (_event, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
  const root = getWorkspaceRoot()
  assertWithinWorkspace(oldPath, root)
  assertWithinWorkspace(newPath, root)
  await fs.promises.rename(oldPath, newPath)
})

ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
  assertWithinWorkspace(targetPath, getWorkspaceRoot())
  const stat = await fs.promises.stat(targetPath)
  if (stat.isDirectory()) {
    await fs.promises.rm(targetPath, { recursive: true, force: true })
  } else {
    await fs.promises.unlink(targetPath)
  }
})

ipcMain.handle('fs:stat', async (_event, filePath: string) => {
  assertWithinWorkspace(filePath, getWorkspaceRoot())
  const stat = await fs.promises.stat(filePath)
  return { isDirectory: stat.isDirectory(), size: stat.size, mtime: stat.mtimeMs }
})

ipcMain.handle('fs:gitignore', async (_event, rootPath: string) => {
  assertWithinWorkspace(rootPath, getWorkspaceRoot())
  const gitignorePath = path.join(rootPath, '.gitignore')
  try {
    const content = await fs.promises.readFile(gitignorePath, 'utf-8')
    return content.split('\n').filter(line => line.trim() && !line.startsWith('#'))
  } catch {
    return []
  }
})

// IPC handlers for file watcher
ipcMain.handle('watcher:start', (_event, dirPath: string, excludePaths?: string[]) => {
  const _t = performance.now()
  console.log(`[PERF][Main] watcher:start path=${dirPath}`)
  watcherManager.start(dirPath, excludePaths)
  console.log(`[PERF][Main] watcher:start done ${(performance.now() - _t).toFixed(1)}ms`)
})

ipcMain.handle('watcher:stop', () => {
  watcherManager.stop()
})

// IPC handlers for custom titlebar window controls
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.handle('window:close', () => {
  mainWindow?.close()
})
ipcMain.handle('window:is-maximized', () => {
  return mainWindow?.isMaximized() ?? false
})

// IPC handler for opening external URLs
ipcMain.handle('shell:open-external', async (_event, url: string) => {
  return shell.openExternal(url)
})

// IPC handler for theme import
ipcMain.handle('theme:import', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import theme file',
    filters: [
      { name: 'Theme Files', extensions: ['css', 'json'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const srcPath = result.filePaths[0]
  const themesDir = join(app.getPath('userData'), 'themes')
  if (!fs.existsSync(themesDir)) {
    fs.mkdirSync(themesDir, { recursive: true })
  }
  const fileName = srcPath.replace(/\\/g, '/').split('/').pop()!
  const destPath = join(themesDir, fileName)
  fs.copyFileSync(srcPath, destPath)
  return destPath
})

// IPC handlers for search
ipcMain.handle('search:find', async (_event, { rootDir, query, options }: { rootDir: string; query: string; options: { scopes: string[]; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean } }) => {
  const _t = performance.now()
  console.log(`[PERF][Main] search:find start query="${query}" scopes=${JSON.stringify(options.scopes)}`)
  const result = await searchFiles(rootDir, query, options)
  console.log(`[PERF][Main] search:find done results=${result.length} ${(performance.now() - _t).toFixed(1)}ms`)
  return result
})

ipcMain.handle('search:replace', (_event, { rootDir, query, replacement, filePaths, options }: { rootDir: string; query: string; replacement: string; filePaths: string[]; options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean } }) => {
  return replaceInFiles(rootDir, query, replacement, filePaths, options)
})

// IPC handlers for crash recovery
ipcMain.handle('recovery:check', (_event, workspacePath: string) => {
  return crashRecovery.checkRecovery(workspacePath)
})

ipcMain.handle('recovery:recover', (_event, workspacePath: string) => {
  return crashRecovery.recoverFiles(workspacePath)
})

ipcMain.handle('recovery:clear', (_event, workspacePath: string) => {
  crashRecovery.clearAutoSave(workspacePath)
})

// IPC handlers for browser
ipcMain.handle('browser:register', (_event, { id, webContentsId }: { id: string; webContentsId: number }) => {
  browserManager.register(id, webContentsId)
  const wc = browserManager.getWebContents(id)
  if (wc && mainWindow && !mainWindow.isDestroyed()) {
    wc.on('did-navigate', (_e, url) => {
      mainWindow!.webContents.send('browser:navigated', { id, url })
      mainWindow!.webContents.send('browser:navigation-state-changed', {
        id, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward()
      })
    })
    wc.on('did-navigate-in-page', (_e, url) => {
      mainWindow!.webContents.send('browser:navigated', { id, url })
      mainWindow!.webContents.send('browser:navigation-state-changed', {
        id, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward()
      })
    })
    wc.on('page-title-updated', (_e, title) => {
      mainWindow!.webContents.send('browser:title-updated', { id, title })
    })
    wc.on('did-start-loading', () => {
      mainWindow!.webContents.send('browser:loading-changed', { id, isLoading: true })
    })
    wc.on('did-stop-loading', () => {
      mainWindow!.webContents.send('browser:loading-changed', { id, isLoading: false })
    })
    wc.on('console-message', (_e, level, message) => {
      browserManager.appendConsoleLog(id, String(level), message)
      mainWindow!.webContents.send('browser:console-message', { id, level: String(level), message })
    })
  }
})

ipcMain.handle('browser:navigate', (_event, { id, url }: { id: string; url: string }) => browserManager.navigate(id, url))
ipcMain.handle('browser:go-back', (_event, { id }: { id: string }) => browserManager.goBack(id))
ipcMain.handle('browser:go-forward', (_event, { id }: { id: string }) => browserManager.goForward(id))
ipcMain.handle('browser:reload', (_event, { id }: { id: string }) => browserManager.reload(id))
ipcMain.handle('browser:toggle-devtools', (_event, { id }: { id: string }) => browserManager.toggleDevTools(id))
ipcMain.handle('browser:close', (_event, { id }: { id: string }) => browserManager.close(id))

app.whenReady().then(() => {
  const _appReadyStart = performance.now()
  console.log(`[PERF][Main] app:ready start`)
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  console.log(`[PERF][Main] app:ready → createWindow`)
  createWindow()

  const approvalDetector = new ApprovalDetector(async (event) => {
    const analysis = await llmManager.classifyCandidate({
      terminalId: event.terminalId,
      workspacePath: event.workspacePath,
      patternName: event.patternName,
      matchedText: event.matchedText,
      recentOutput: terminalManager.getScrollback(event.terminalId)
    })
    const approvalEvent: ApprovalDetectedEvent = {
      ...event,
      analysis: {
        category: analysis.category,
        summary: analysis.summary,
        confidence: analysis.confidence,
        source: analysis.source
      }
    }
    emitMonitoringUpsert({
      terminalId: event.terminalId,
      workspacePath: event.workspacePath,
      patternName: event.patternName,
      matchedText: event.matchedText,
      status: 'attention-needed',
      category: analysis.category,
      confidence: analysis.confidence,
      source: analysis.source,
      summary: analysis.summary,
      timestamp: event.timestamp
    })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:approval-detected', approvalEvent)
    }
  })
  terminalManager.setApprovalDetector(approvalDetector)
  const l0Pipeline = new L0Pipeline(new CcStreamJsonAdapter(), (state) => {
    emitMonitoringUpsert(state)
  })
  l0Pipeline.onStatusChanged((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:l0-status-changed', {
        terminalId: status.terminalId,
        status,
        timestamp: Date.now()
      })
    }
  })
  terminalManager.setL0Pipeline(l0Pipeline)

  // RW-B runtime wiring — per-terminal HookServer + shared tailer pool.
  // Kept in-scope so the callbacks close over these instances.
  const hookServersByTerminal = new Map<string, HookServer>()
  const tailerPool = new SessionLogTailerPool()
  tailerPoolRef = tailerPool
  const tailerHandles = new Map<string, { release: () => void }>()

  terminalManager.setL0RuntimeHooks({
    onClaudeBind: async ({ terminalId, workspacePath }) => {
      // HookServer per terminal — listens + filters by cwd/session_id.
      if (!hookServersByTerminal.has(terminalId)) {
        const server = new HookServer({ terminalId, workspacePath })
        server.on('payload', ({ terminalId: id, payload }) => {
          // Mark observed + timestamp so the stale-check tick can tell
          // whether the hook is healthy or genuinely stuck.
          l0Orchestrator.markHookObserved(id, Date.now())
          l0Pipeline.ingest(id, payload, workspacePath, 'hook')
        })
        server.on('auth-failure', (f) => {
          console.warn(`[hook-server:${terminalId}] auth-failure: ${f.reason}`)
        })
        try {
          const { socketPath, tokenFilePath } = await server.start()
          registerHookListener({
            pid: process.pid,
            terminalId,
            socketPath,
            tokenPath: tokenFilePath,
            workspacePath,
            startedAt: Date.now()
          })
          hookServersByTerminal.set(terminalId, server)
          // Install the hook adapter on the pipeline for this terminal so
          // frame payloads are parsed as hook events instead of stdout.
          l0Pipeline.setAdapterFor(terminalId, new CcHookAdapter())
        } catch (error) {
          console.warn(`[hook-server:${terminalId}] start failed:`, error)
        }
      }

      // Session-log tailer via pool (shared by cwd).
      if (!tailerHandles.has(terminalId)) {
        const handle = tailerPool.acquire({
          terminalId,
          cwd: workspacePath,
          onEnvelope: (envelope) => {
            // RW-E: record the session-log tool_use timestamp so the
            // evidence-guarded stale check can evaluate whether a
            // silent hook is genuinely stuck vs the user being idle.
            const payload = envelope.payload as Record<string, unknown>
            const message = payload.message as Record<string, unknown> | undefined
            const content = message && Array.isArray(message.content) ? message.content : []
            const hasToolUse = content.some((block) =>
              typeof block === 'object' && block !== null &&
              (block as Record<string, unknown>).type === 'tool_use'
            )
            if (hasToolUse) {
              l0Orchestrator.observeSessionLogToolUse(envelope.terminalId)
            }
            // Parse the envelope via the session-log adapter (separate
            // from the per-terminal hook adapter override) then route
            // the resulting L0Events through the pipeline's dedup +
            // upsert layer tagged as 'session-log'. This keeps both
            // sources hitting the shared dedup window without needing
            // a multi-adapter-per-terminal data structure.
            const sessionAdapter = sessionLogAdapterByTerminal.get(envelope.terminalId) ??
              sessionLogAdapterByTerminal
                .set(envelope.terminalId, new CcSessionLogAdapter())
                .get(envelope.terminalId)!
            const parsed = sessionAdapter.ingest(envelope.terminalId, envelope.payload)
            if (parsed.kind === 'event') {
              l0Pipeline.ingestEvents(envelope.terminalId, parsed.events, workspacePath, 'session-log')
            }
          }
        })
        tailerHandles.set(terminalId, handle)
      }

      // Refresh the per-terminal snapshot so Settings reflects the new
      // capability immediately.
      l0Orchestrator.bindTerminal({ terminalId, cwd: workspacePath })
      await l0Orchestrator.refresh({ terminalId })
    },
    onTerminalClose: async (terminalId) => {
      const server = hookServersByTerminal.get(terminalId)
      if (server) {
        hookServersByTerminal.delete(terminalId)
        unregisterHookListener(process.pid, terminalId)
        try {
          await server.dispose()
        } catch {
          // best effort
        }
      }
      const handle = tailerHandles.get(terminalId)
      if (handle) {
        tailerHandles.delete(terminalId)
        try {
          handle.release()
        } catch {
          // best effort
        }
      }
      const sessionAdapter = sessionLogAdapterByTerminal.get(terminalId)
      if (sessionAdapter) {
        sessionLogAdapterByTerminal.delete(terminalId)
        try {
          sessionAdapter.dispose()
        } catch {
          // best effort
        }
      }
      l0Pipeline.clearAdapterFor(terminalId)
      l0Orchestrator.unbindTerminal(terminalId)
    }
  })

  const sessionLogAdapterByTerminal = new Map<string, CcSessionLogAdapter>()

  // Slice 2E — L0 orchestrator probe + IPC surface. The orchestrator only
  // computes path-selector state; actual adapter swap at runtime is wired
  // in a follow-up Slice 2 sub-task. Surface is ready for the 3-state
  // Settings UI (Slice 2C/2D).
  const l0Orchestrator = new L0Orchestrator()
  l0OrchestratorRef = l0Orchestrator
  // RW-E: evidence-guarded stale check runs every 20s so a silent hook
  // with active session-log traffic triggers a downgrade without any
  // direct user input.
  l0Orchestrator.startStaleCheck()
  void l0Orchestrator.refresh().catch((error) => {
    // Detection is best-effort; failures fall through to L1 baseline.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('l0:path-probe-error', {
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  })
  l0Orchestrator.onChange((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('l0:path-snapshot', snapshot)
    }
  })
  ipcMain.handle('l0:get-path-snapshot', () => l0Orchestrator.getSnapshot())
  ipcMain.handle('l0:refresh-path', async () => l0Orchestrator.refresh())
  // RW-E: per-terminal snapshot list for Settings UI breakdown view.
  ipcMain.handle('l0:list-per-terminal', () => l0Orchestrator.listPerTerminalSnapshots())
  ipcMain.handle('l0:install-hooks', async () => {
    const { installHooks } = await import('./l0/hook-installer')
    const bridgePath = is.dev
      ? join(__dirname, '..', '..', 'resources', 'hooks', 'cc-bridge.js')
      : join(process.resourcesPath, 'hooks', 'cc-bridge.js')
    const result = installHooks({
      hooks: [
        { event: 'PreToolUse', command: `node "${bridgePath}"` },
        { event: 'PostToolUse', command: `node "${bridgePath}"` },
        { event: 'SessionStart', command: `node "${bridgePath}"` },
        { event: 'SessionEnd', command: `node "${bridgePath}"` }
      ]
    })
    await l0Orchestrator.refresh()
    return result
  })
  ipcMain.handle('l0:uninstall-hooks', async () => {
    const { uninstallHooks } = await import('./l0/hook-installer')
    const result = uninstallHooks({
      events: ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd']
    })
    await l0Orchestrator.refresh()
    return result
  })
  // Slice 2.7 — explicit vendor selection. The renderer calls this when
  // the user clicks "Mark as Claude Code" so onClaudeBind fires reliably
  // even when CC's TUI cell-painting prevents banner auto-detection.
  ipcMain.handle('terminal:set-vendor', (_event, terminalId: string, vendor: string) => {
    if (typeof terminalId !== 'string' || typeof vendor !== 'string') {
      return { ok: false, reason: 'invalid arguments' }
    }
    // L0Vendor is currently 'claude-code' only. When the union expands
    // (codex / gemini), accept those here too and forward verbatim.
    if (vendor !== 'claude-code') {
      return { ok: false, reason: `unsupported vendor: ${vendor}` }
    }
    const ok = terminalManager.setVendor(terminalId, vendor)
    return ok
      ? { ok: true }
      : { ok: false, reason: 'terminal not found or already has a different vendor' }
  })

  const customPatterns = (settingsManager.get('notification.customPatterns') ?? []) as Array<{ name: string; pattern: string }>
  approvalDetector.setCustomPatterns(customPatterns)

  mcpBrowserHandler.setMainWindow(mainWindow!)

  console.log(`[PERF][Main] app:ready → apiServer.start`)
  apiServer.start()
  console.log(`[PERF][Main] app:ready done ${(performance.now() - _appReadyStart).toFixed(1)}ms`)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  console.log(`[DEBUG][Main] before-quit at ${new Date().toISOString()}`)
  terminalManager.dispose()
  watcherManager.stop()
  apiServer.stop()
  // RW-B/E cleanup (code-reviewer MEDIUM): terminalManager.dispose()
  // cascades into per-terminal HookServer and tailer handle releases,
  // but the orchestrator's stale-check timer + pool module-level state
  // still need explicit teardown.
  try {
    l0OrchestratorRef?.dispose()
  } catch {
    // Best-effort cleanup on shutdown.
  }
  tailerPoolRef?.dispose().catch(() => undefined)
})

// --- Global error handlers for main process diagnostics ---
process.on('uncaughtException', (error) => {
  console.error(`[DEBUG][Main] uncaughtException:`, error)
})

process.on('unhandledRejection', (reason) => {
  console.error(`[DEBUG][Main] unhandledRejection:`, reason)
})
