import { contextBridge, ipcRenderer, clipboard } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const clipboardAPI = {
  readText: (): string => clipboard.readText(),
  writeText: (text: string): void => clipboard.writeText(text)
}

const terminalAPI = {
  create: (id: string, shell?: string, cwd?: string) =>
    ipcRenderer.invoke('terminal:create', { id, shell, cwd }),
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
  onApprovalDetected: (callback: (event: { terminalId: string; workspacePath: string; patternName: string; matchedText: string; timestamp: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; workspacePath: string; patternName: string; matchedText: string; timestamp: number }) => callback(data)
    ipcRenderer.on('terminal:approval-detected', handler)
    return () => ipcRenderer.removeListener('terminal:approval-detected', handler)
  }
}

const settingsAPI = {
  get: (key?: string) => ipcRenderer.invoke('settings:get', key),
  set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
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

const issuesAPI = {
  scan: (docsPath: string) => ipcRenderer.invoke('issues:scan', docsPath),
  scanAll: (projectRoot: string) => ipcRenderer.invoke('issues:scan-all', projectRoot),
  onTitlesUpdated: (callback: (updates: Array<{ filePath: string; title: string }>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, updates: Array<{ filePath: string; title: string }>) =>
      callback(updates)
    ipcRenderer.on('docs:titles-updated', handler)
    return () => ipcRenderer.removeListener('docs:titles-updated', handler)
  },
  parseFile: (filePath: string) => ipcRenderer.invoke('issues:parse-file', filePath),
  onIncrementalUpdate: (callback: (updates: Array<{ type: string; filePath: string; entry?: unknown }>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, updates: Array<{ type: string; filePath: string; entry?: unknown }>) =>
      callback(updates)
    ipcRenderer.on('docs:incremental-update', handler)
    return () => ipcRenderer.removeListener('docs:incremental-update', handler)
  },
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

const skillsAPI = {
  getAvailable: () => ipcRenderer.invoke('skills:get-available'),
  getInstalled: (projectPath: string) => ipcRenderer.invoke('skills:get-installed', projectPath),
  install: (skillName: string, projectPath: string) => ipcRenderer.invoke('skills:install', skillName, projectPath),
  uninstall: (skillName: string, projectPath: string) => ipcRenderer.invoke('skills:uninstall', skillName, projectPath),
  getUnified: () => ipcRenderer.invoke('skills:get-unified'),
  getInstalledRecords: (projectPath: string) => ipcRenderer.invoke('skills:get-installed-records', projectPath),
  installRegistry: (skillId: string, agentId: string, projectPath: string) =>
    ipcRenderer.invoke('skills:install-registry', skillId, agentId, projectPath),
  uninstallRegistry: (skillId: string, agentId: string, projectPath: string) =>
    ipcRenderer.invoke('skills:uninstall-registry', skillId, agentId, projectPath),
  refreshRegistry: () => ipcRenderer.invoke('skills:refresh-registry')
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

const kanbanAPI = {
  load: (workspacePath: string) =>
    ipcRenderer.invoke('kanban:load', workspacePath),
  createIssue: (workspacePath: string, data: { title: string; description?: string; status?: string }) =>
    ipcRenderer.invoke('kanban:create-issue', workspacePath, data),
  updateIssue: (workspacePath: string, issueId: string, updates: { title?: string; description?: string; status?: string; linkedDocuments?: string[]; promptId?: string }) =>
    ipcRenderer.invoke('kanban:update-issue', workspacePath, issueId, updates),
  deleteIssue: (workspacePath: string, issueId: string) =>
    ipcRenderer.invoke('kanban:delete-issue', workspacePath, issueId),
  updateStatus: (workspacePath: string, issueId: string, status: string) =>
    ipcRenderer.invoke('kanban:update-status', workspacePath, issueId, status),
  generatePrompt: (workspacePath: string, issueId: string, templateId?: string) =>
    ipcRenderer.invoke('kanban:generate-prompt', workspacePath, issueId, templateId),
  linkDoc: (workspacePath: string, issueId: string, docPath: string) =>
    ipcRenderer.invoke('kanban:link-doc', workspacePath, issueId, docPath),
  unlinkDoc: (workspacePath: string, issueId: string, docPath: string) =>
    ipcRenderer.invoke('kanban:unlink-doc', workspacePath, issueId, docPath),
  autoLink: (workspacePath: string, issueId: string) =>
    ipcRenderer.invoke('kanban:auto-link', workspacePath, issueId),
  getColumns: (workspacePath: string) =>
    ipcRenderer.invoke('kanban:get-columns', workspacePath),
  setColumns: (workspacePath: string, columns: Array<{ id: string; label: string }>) =>
    ipcRenderer.invoke('kanban:set-columns', workspacePath, columns),
  getTemplates: (workspacePath: string) =>
    ipcRenderer.invoke('kanban:get-templates', workspacePath),
  saveTemplate: (workspacePath: string, template: { id: string; name: string; template: string; isDefault: boolean }) =>
    ipcRenderer.invoke('kanban:save-template', workspacePath, template)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('terminal', terminalAPI)
    contextBridge.exposeInMainWorld('settings', settingsAPI)
    contextBridge.exposeInMainWorld('workspace', workspaceAPI)
    contextBridge.exposeInMainWorld('fs', fsAPI)
    contextBridge.exposeInMainWorld('issues', issuesAPI)
    contextBridge.exposeInMainWorld('watcher', watcherAPI)
    contextBridge.exposeInMainWorld('appWindow', windowAPI)
    contextBridge.exposeInMainWorld('shell', shellAPI)
    contextBridge.exposeInMainWorld('search', searchAPI)
    contextBridge.exposeInMainWorld('theme', themeAPI)
    contextBridge.exposeInMainWorld('updater', updaterAPI)
    contextBridge.exposeInMainWorld('skills', skillsAPI)
    contextBridge.exposeInMainWorld('recovery', recoveryAPI)
    contextBridge.exposeInMainWorld('kanban', kanbanAPI)
    contextBridge.exposeInMainWorld('clipboard', clipboardAPI)
    contextBridge.exposeInMainWorld('browser', browserAPI)
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
  window.workspace = workspaceAPI
  // @ts-ignore (define in dts)
  window.fs = fsAPI
  // @ts-ignore (define in dts)
  window.issues = issuesAPI
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
  window.skills = skillsAPI
  // @ts-ignore (define in dts)
  window.recovery = recoveryAPI
  // @ts-ignore (define in dts)
  window.kanban = kanbanAPI
  // @ts-ignore (define in dts)
  window.clipboard = clipboardAPI
  // @ts-ignore (define in dts)
  window.browser = browserAPI
}
