import { contextBridge, ipcRenderer, clipboard } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ApprovalDetectedEvent,
  L0Status,
  L0StatusChangedEvent,
  L0Vendor,
  ManualTaskRecord,
  MonitoringHistoryEvent,
  MonitoringHistoryStoreStatus,
  MonitoringTimelineFilter,
  SessionMonitoringClearEvent,
  SessionMonitoringTransitionEvent,
  SessionMonitoringUpsertEvent
} from '../shared/types'

const clipboardAPI = {
  readText: (): string => clipboard.readText(),
  writeText: (text: string): void => clipboard.writeText(text)
}

const isTestEnv = process.env.NODE_ENV === 'test'
const terminalTestOpenListeners = new Map<string, Set<(filePath: string) => void>>()

const terminalAPI = {
  create: (
    id: string,
    shell?: string,
    cwd?: string,
    options?: { vendorHint?: L0Vendor; spawnArgs?: string[] }
  ) =>
    ipcRenderer.invoke('terminal:create', {
      id,
      shell,
      cwd,
      vendorHint: options?.vendorHint,
      spawnArgs: options?.spawnArgs
    }),
  getL0Status: (id: string): Promise<L0Status> =>
    ipcRenderer.invoke('terminal:l0-status', { id }),
  onL0StatusChanged: (callback: (event: L0StatusChangedEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: L0StatusChangedEvent) => callback(data)
    ipcRenderer.on('terminal:l0-status-changed', handler)
    return () => ipcRenderer.removeListener('terminal:l0-status-changed', handler)
  },
  write: (id: string, data: string) =>
    ipcRenderer.send('terminal:write', { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', { id, cols, rows }),
  kill: (id: string) =>
    ipcRenderer.invoke('terminal:kill', { id }),
  onData: (callback: (id: string, data: string) => void, terminalId?: string) => {
    const channel = terminalId ? `terminal:data:${terminalId}` : 'terminal:data'
    const handler = (_event: Electron.IpcRendererEvent, { id, data }: { id: string; data: string }) =>
      callback(id, data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onExit: (callback: (id: string, exitCode: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, { id, exitCode }: { id: string; exitCode: number }) =>
      callback(id, exitCode)
    ipcRenderer.on('terminal:exit', handler)
    return () => ipcRenderer.removeListener('terminal:exit', handler)
  },
  getScrollback: (id: string) => ipcRenderer.invoke('terminal:get-scrollback', { id }),
  onApprovalDetected: (callback: (event: ApprovalDetectedEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ApprovalDetectedEvent) => callback(data)
    ipcRenderer.on('terminal:approval-detected', handler)
    return () => ipcRenderer.removeListener('terminal:approval-detected', handler)
  },
  onMonitoringUpsert: (callback: (event: SessionMonitoringUpsertEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: SessionMonitoringUpsertEvent) => callback(data)
    ipcRenderer.on('terminal:monitoring-upsert', handler)
    return () => ipcRenderer.removeListener('terminal:monitoring-upsert', handler)
  },
  onMonitoringClear: (callback: (event: SessionMonitoringClearEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: SessionMonitoringClearEvent) => callback(data)
    ipcRenderer.on('terminal:monitoring-clear', handler)
    return () => ipcRenderer.removeListener('terminal:monitoring-clear', handler)
  },
  onMonitoringTransition: (callback: (event: SessionMonitoringTransitionEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: SessionMonitoringTransitionEvent) => callback(data)
    ipcRenderer.on('terminal:monitoring-transition', handler)
    return () => ipcRenderer.removeListener('terminal:monitoring-transition', handler)
  },
  ...(isTestEnv
    ? {
        testOpenFile: (terminalId: string, filePath: string) => {
          terminalTestOpenListeners.get(terminalId)?.forEach((listener) => listener(filePath))
        },
        onTestOpenFile: (terminalId: string, callback: (filePath: string) => void) => {
          const listeners = terminalTestOpenListeners.get(terminalId) ?? new Set<(filePath: string) => void>()
          listeners.add(callback)
          terminalTestOpenListeners.set(terminalId, listeners)
          return () => {
            const currentListeners = terminalTestOpenListeners.get(terminalId)
            currentListeners?.delete(callback)
            if (currentListeners && currentListeners.size === 0) {
              terminalTestOpenListeners.delete(terminalId)
            }
          }
        }
      }
    : {})
}

const settingsAPI = {
  get: (key?: string) => ipcRenderer.invoke('settings:get', key),
  set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
}

const llmAPI = {
  getSettingsState: () => ipcRenderer.invoke('llm:get-settings-state'),
  getStorageStatus: () => ipcRenderer.invoke('llm:get-storage-status'),
  setSelectedModel: (providerId: string, modelId: string) => ipcRenderer.invoke('llm:set-selected-model', providerId, modelId),
  setConsent: (enabled: boolean) => ipcRenderer.invoke('llm:set-consent', enabled),
  setLaneEnabled: (laneId: string, enabled: boolean) => ipcRenderer.invoke('llm:set-lane-enabled', laneId, enabled),
  moveLane: (laneId: string, delta: -1 | 1) => ipcRenderer.invoke('llm:move-lane', laneId, delta),
  setApiKey: (providerId: string, apiKey: string) => ipcRenderer.invoke('llm:set-api-key', providerId, apiKey),
  clearApiKey: (providerId: string) => ipcRenderer.invoke('llm:clear-api-key', providerId),
  listModels: (providerId: string) => ipcRenderer.invoke('llm:list-models', providerId),
  connect: (laneId: string) => ipcRenderer.invoke('llm:connect', laneId),
  disconnect: (laneId: string) => ipcRenderer.invoke('llm:disconnect', laneId),
  validate: (laneId: string) => ipcRenderer.invoke('llm:validate', laneId),
  refreshState: (laneId: string) => ipcRenderer.invoke('llm:refresh-state', laneId),
  'refresh-state': (laneId: string) => ipcRenderer.invoke('llm:refresh-state', laneId),
  classifyPreview: (input: unknown) => ipcRenderer.invoke('llm:classify-preview', input)
}

const workspaceAPI = {
  open: () => ipcRenderer.invoke('workspace:open'),
  openPath: (dirPath: string) => ipcRenderer.invoke('workspace:open-path', dirPath),
  close: () => ipcRenderer.invoke('workspace:close'),
  getCurrent: () => ipcRenderer.invoke('workspace:get-current'),
  getRecent: () => ipcRenderer.invoke('workspace:get-recent'),
  saveState: (state: Record<string, unknown>) => ipcRenderer.invoke('workspace:save-state', state),
  getState: () => ipcRenderer.invoke('workspace:get-state'),
  onChanged: (callback: (workspaceInfo: { path: string; name: string } | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, workspaceInfo: { path: string; name: string } | null) =>
      callback(workspaceInfo)
    ipcRenderer.on('workspace:changed', handler)
    return () => ipcRenderer.removeListener('workspace:changed', handler)
  }
}

const fsAPI = {
  readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
  readFileStream: (path: string) => ipcRenderer.invoke('fs:read-file-stream', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:write-file', { path, content }),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:read-dir', dirPath),
  mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
  rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', { oldPath, newPath }),
  delete: (targetPath: string) => ipcRenderer.invoke('fs:delete', targetPath),
  stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),
  getGitignorePatterns: (rootPath: string) => ipcRenderer.invoke('fs:gitignore', rootPath)
}

const watcherAPI = {
  start: (dirPath: string, excludePaths?: string[]) => ipcRenderer.invoke('watcher:start', dirPath, excludePaths),
  stop: () => ipcRenderer.invoke('watcher:stop'),
  onChanged: (callback: (data: { type: string; path: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { type: string; path: string }) =>
      callback(data)
    ipcRenderer.on('files:changed', handler)
    return () => ipcRenderer.removeListener('files:changed', handler)
  }
}

const windowAPI = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => callback(isMaximized)
    ipcRenderer.on('window:maximized-changed', handler)
    return () => ipcRenderer.removeListener('window:maximized-changed', handler)
  }
}

const shellAPI = {
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
}

const themeAPI = {
  import: () => ipcRenderer.invoke('theme:import')
}

const searchAPI = {
  find: (rootDir: string, query: string, options: { scopes: string[]; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) =>
    ipcRenderer.invoke('search:find', { rootDir, query, options }),
  replace: (rootDir: string, query: string, replacement: string, filePaths: string[], options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) =>
    ipcRenderer.invoke('search:replace', { rootDir, query, replacement, filePaths, options })
}

const updaterAPI = {
  onUpdateAvailable: (callback: (info: unknown) => void) =>
    ipcRenderer.on('updater:update-available', (_e, info) => callback(info)),
  onDownloadProgress: (callback: (progress: unknown) => void) =>
    ipcRenderer.on('updater:download-progress', (_e, progress) => callback(progress)),
  onUpdateDownloaded: (callback: () => void) =>
    ipcRenderer.on('updater:update-downloaded', () => callback()),
  onUpdateError: (callback: (err: unknown) => void) =>
    ipcRenderer.on('updater:error', (_e, err) => callback(err)),
  download: () => ipcRenderer.invoke('updater:download'),
  install: () => ipcRenderer.invoke('updater:install'),
  check: () => ipcRenderer.invoke('updater:check')
}

const recoveryAPI = {
  check: (workspacePath: string) => ipcRenderer.invoke('recovery:check', workspacePath),
  recover: (workspacePath: string) => ipcRenderer.invoke('recovery:recover', workspacePath),
  clear: (workspacePath: string) => ipcRenderer.invoke('recovery:clear', workspacePath)
}

const browserAPI = {
  register: (id: string, webContentsId: number) =>
    ipcRenderer.invoke('browser:register', { id, webContentsId }),
  navigate: (id: string, url: string) =>
    ipcRenderer.invoke('browser:navigate', { id, url }),
  goBack: (id: string) => ipcRenderer.invoke('browser:go-back', { id }),
  goForward: (id: string) => ipcRenderer.invoke('browser:go-forward', { id }),
  reload: (id: string) => ipcRenderer.invoke('browser:reload', { id }),
  toggleDevTools: (id: string) => ipcRenderer.invoke('browser:toggle-devtools', { id }),
  close: (id: string) => ipcRenderer.invoke('browser:close', { id }),
  onNavigated: (callback: (id: string, url: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, { id, url }: { id: string; url: string }) =>
      callback(id, url)
    ipcRenderer.on('browser:navigated', handler)
    return () => ipcRenderer.removeListener('browser:navigated', handler)
  },
  onTitleUpdated: (callback: (id: string, title: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, { id, title }: { id: string; title: string }) =>
      callback(id, title)
    ipcRenderer.on('browser:title-updated', handler)
    return () => ipcRenderer.removeListener('browser:title-updated', handler)
  },
  onLoadingChanged: (callback: (id: string, isLoading: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, { id, isLoading }: { id: string; isLoading: boolean }) =>
      callback(id, isLoading)
    ipcRenderer.on('browser:loading-changed', handler)
    return () => ipcRenderer.removeListener('browser:loading-changed', handler)
  },
  onNavigationStateChanged: (callback: (id: string, canGoBack: boolean, canGoForward: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { id: string; canGoBack: boolean; canGoForward: boolean }) =>
      callback(data.id, data.canGoBack, data.canGoForward)
    ipcRenderer.on('browser:navigation-state-changed', handler)
    return () => ipcRenderer.removeListener('browser:navigation-state-changed', handler)
  },
  onConsoleMessage: (callback: (id: string, level: string, message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { id: string; level: string; message: string }) =>
      callback(data.id, data.level, data.message)
    ipcRenderer.on('browser:console-message', handler)
    return () => ipcRenderer.removeListener('browser:console-message', handler)
  }
}

const monitoringHistoryAPI = {
  getStatus: () => ipcRenderer.invoke('history:get-status'),
  listSessionEvents: (terminalId: string, filter: MonitoringTimelineFilter = 'all', limit?: number) =>
    ipcRenderer.invoke('history:list-session-events', terminalId, filter, limit),
  listWorkspaceFeed: (limit?: number) =>
    ipcRenderer.invoke('history:list-workspace-feed', limit),
  listManualTasks: () => ipcRenderer.invoke('history:list-manual-tasks') as Promise<ManualTaskRecord[]>,
  listRecentCompleted: (limit?: number) =>
    ipcRenderer.invoke('history:list-recent-completed', limit) as Promise<ManualTaskRecord[]>,
  createManualTask: (title: string, note?: string | null) =>
    ipcRenderer.invoke('history:create-manual-task', title, note) as Promise<ManualTaskRecord>,
  updateManualTask: (taskId: string, updates: Partial<Pick<ManualTaskRecord, 'title' | 'note'>>) =>
    ipcRenderer.invoke('history:update-manual-task', taskId, updates) as Promise<ManualTaskRecord | null>,
  reorderManualTasks: (taskIds: string[]) =>
    ipcRenderer.invoke('history:reorder-manual-tasks', taskIds) as Promise<ManualTaskRecord[]>,
  completeManualTask: (taskId: string, link?: { terminalId?: string | null; eventId?: string | null }) =>
    ipcRenderer.invoke('history:complete-manual-task', taskId, link) as Promise<ManualTaskRecord | null>
}

// Slice 2E/2D — L0 path snapshot / subscription + hook install surface
const l0API = {
  getPathSnapshot: () => ipcRenderer.invoke('l0:get-path-snapshot'),
  refreshPath: () => ipcRenderer.invoke('l0:refresh-path'),
  installHooks: () => ipcRenderer.invoke('l0:install-hooks'),
  uninstallHooks: () => ipcRenderer.invoke('l0:uninstall-hooks'),
  onPathSnapshot: (callback: (snapshot: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('l0:path-snapshot', handler)
    return () => ipcRenderer.removeListener('l0:path-snapshot', handler)
  },
  onPathProbeError: (callback: (data: { reason: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { reason: string }): void => callback(data)
    ipcRenderer.on('l0:path-probe-error', handler)
    return () => ipcRenderer.removeListener('l0:path-probe-error', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('terminal', terminalAPI)
    contextBridge.exposeInMainWorld('settings', settingsAPI)
    contextBridge.exposeInMainWorld('llm', llmAPI)
    contextBridge.exposeInMainWorld('workspace', workspaceAPI)
    contextBridge.exposeInMainWorld('monitoringHistory', monitoringHistoryAPI)
    contextBridge.exposeInMainWorld('fs', fsAPI)
    contextBridge.exposeInMainWorld('watcher', watcherAPI)
    contextBridge.exposeInMainWorld('appWindow', windowAPI)
    contextBridge.exposeInMainWorld('shell', shellAPI)
    contextBridge.exposeInMainWorld('search', searchAPI)
    contextBridge.exposeInMainWorld('theme', themeAPI)
    contextBridge.exposeInMainWorld('updater', updaterAPI)
    contextBridge.exposeInMainWorld('recovery', recoveryAPI)
    contextBridge.exposeInMainWorld('clipboard', clipboardAPI)
    contextBridge.exposeInMainWorld('browser', browserAPI)
    contextBridge.exposeInMainWorld('l0', l0API)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.terminal = terminalAPI
  // @ts-ignore (define in dts)
  window.settings = settingsAPI
  // @ts-ignore (define in dts)
  window.llm = llmAPI
  // @ts-ignore (define in dts)
  window.workspace = workspaceAPI
  // @ts-ignore (define in dts)
  window.monitoringHistory = monitoringHistoryAPI
  // @ts-ignore (define in dts)
  window.fs = fsAPI
  // @ts-ignore (define in dts)
  window.watcher = watcherAPI
  // @ts-ignore (define in dts)
  window.appWindow = windowAPI
  // @ts-ignore (define in dts)
  window.shell = shellAPI
  // @ts-ignore (define in dts)
  window.search = searchAPI
  // @ts-ignore (define in dts)
  window.theme = themeAPI
  // @ts-ignore (define in dts)
  window.updater = updaterAPI
  // @ts-ignore (define in dts)
  window.recovery = recoveryAPI
  // @ts-ignore (define in dts)
  window.clipboard = clipboardAPI
  // @ts-ignore (define in dts)
  window.browser = browserAPI
}
