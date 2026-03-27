import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initAutoUpdater } from './auto-updater'
import { TerminalManager } from './terminal-manager'
import { SettingsManager } from './settings-manager'
import { WorkspaceManager } from './workspace-manager'
import { scanIssues, scanAllDocs, enrichDocTitles, applyTitleUpdatesToCache, populateCache, handleFileChange, buildGroupsFromCache, parseFileOnDemand, invalidateParsedCache } from './issue-parser'
import type { IncrementalUpdate } from './issue-parser'
import * as kanbanStore from './kanban-store'
import { WatcherManager } from './file-watcher'
import { searchFiles, replaceInFiles, invalidateSearchCache } from './search-service'
import { ApiServer } from './api-server'
import { SkillsManager } from './skills-manager'
import { CrashRecovery } from './crash-recovery'
import { assertWithinWorkspace } from './path-validator'
import { ApprovalDetector } from './approval-detector'
import { BrowserManager } from './browser-manager'
import { McpBrowserHandler } from './mcp-browser-server'
import * as path from 'path'

const terminalManager = new TerminalManager()
const browserManager = new BrowserManager()
const settingsManager = new SettingsManager()
const workspaceManager = new WorkspaceManager(settingsManager)
const watcherManager = new WatcherManager()

// Invalidate caches when file changes are flushed to renderer
watcherManager.onFlush((rootDir, changes) => {
  invalidateSearchCache(rootDir)
  kanbanStore.invalidateCache(rootDir)

  // Phase 3: Incremental update — process each file change
  if (!mainWindow || mainWindow.isDestroyed()) return
  const mdChanges = changes.filter(c =>
    c.path.endsWith('.md') && (c.type === 'add' || c.type === 'change' || c.type === 'unlink')
  )
  if (mdChanges.length === 0) return

  // Invalidate on-demand parse cache for changed files
  for (const c of mdChanges) invalidateParsedCache(c.path)

  Promise.all(
    mdChanges.map(c => handleFileChange(c.type as 'add' | 'change' | 'unlink', c.path, rootDir))
  ).then((results) => {
    const updates = results.filter((r): r is IncrementalUpdate => r !== null)
    if (updates.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('docs:incremental-update', updates)
    }
  })
})

const apiServer = new ApiServer(terminalManager, workspaceManager, settingsManager)
const mcpBrowserHandler = new McpBrowserHandler(browserManager)
apiServer.setMcpBrowserHandler(mcpBrowserHandler)
const skillsManager = new SkillsManager()
const crashRecovery = new CrashRecovery()
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const _perfStart = performance.now()
  console.log(`[PERF][Main] createWindow: start`)
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })
  console.log(`[PERF][Main] createWindow: BrowserWindow constructed ${(performance.now() - _perfStart).toFixed(1)}ms`)

  mainWindow.on('ready-to-show', () => {
    console.log(`[PERF][Main] createWindow: ready-to-show ${(performance.now() - _perfStart).toFixed(1)}ms`)
    mainWindow!.show()
    watcherManager.setWindow(mainWindow!)
    initAutoUpdater(mainWindow!)
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

// IPC handlers for terminal
ipcMain.handle('terminal:create', (_event, { id, shell, cwd }: { id: string; shell?: string; cwd?: string }) => {
  terminalManager.create(id, shell, cwd)
  const term = terminalManager.get(id)
  if (!term) return

  term.onData((data) => {
    terminalManager.appendToBuffer(id, data)
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:data', { id, data })
      }
    } catch {
      // Window already destroyed during shutdown — safe to ignore
    }
  })

  term.onExit(({ exitCode }) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', { id, exitCode })
      }
    } catch {
      // Window already destroyed during shutdown — safe to ignore
    }
    terminalManager.kill(id)
  })
})

ipcMain.on('terminal:write', (_event, { id, data }: { id: string; data: string }) => {
  terminalManager.write(id, data)
})

ipcMain.on('terminal:resize', (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
  terminalManager.resize(id, cols, rows)
})

ipcMain.handle('terminal:kill', (_event, { id }: { id: string }) => {
  terminalManager.kill(id)
})

ipcMain.handle('terminal:get-scrollback', (_event, { id }: { id: string }) => {
  return terminalManager.getScrollback(id)
})

// IPC handlers for settings
ipcMain.handle('settings:get', (_event, key?: string) => {
  return settingsManager.get(key)
})

ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
  settingsManager.set(key, value)
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
  mainWindow?.webContents.send('workspace:changed', workspaceInfo)
  console.log(`[PERF][Main] workspace:open done ${(performance.now() - _t).toFixed(1)}ms`)
  return workspaceInfo
})

ipcMain.handle('workspace:open-path', (_event, dirPath: string) => {
  const _t = performance.now()
  console.log(`[PERF][Main] workspace:open-path start path=${dirPath}`)
  const workspaceInfo = workspaceManager.openWorkspace(dirPath)
  mainWindow?.webContents.send('workspace:changed', workspaceInfo)
  console.log(`[PERF][Main] workspace:open-path done ${(performance.now() - _t).toFixed(1)}ms`)
  return workspaceInfo
})

ipcMain.handle('workspace:close', () => {
  workspaceManager.closeWorkspace()
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

// IPC handlers for issues
ipcMain.handle('issues:scan', async (_event, docsPath: string) => {
  const _t = performance.now()
  console.log(`[PERF][Main] issues:scan start path=${docsPath}`)
  const result = await scanIssues(docsPath)
  console.log(`[PERF][Main] issues:scan done groups=${result.length} ${(performance.now() - _t).toFixed(1)}ms`)
  return result
})

ipcMain.handle('issues:scan-all', async (_event, projectRoot: string) => {
  const _t = performance.now()
  console.log(`[PERF][Main] issues:scan-all start root=${projectRoot}`)
  const excludePaths = settingsManager.get('scanning.excludePaths') as string[] || ['node_modules', '.git', '.workspace', 'dist', 'out', 'build', 'obj', 'bin', '.vs', '.idea', 'coverage', '__pycache__', '.next', '.nuxt', 'target']
  const result = await scanAllDocs(projectRoot, excludePaths)
  console.log(`[PERF][Main] issues:scan-all done groups=${result.length} ${(performance.now() - _t).toFixed(1)}ms`)

  // Phase 3: Populate in-memory cache for incremental updates
  populateCache(result, projectRoot)

  // Phase 2: Background title enrichment — fire-and-forget after returning initial results
  if (mainWindow && !mainWindow.isDestroyed()) {
    enrichDocTitles(projectRoot, result, (updates) => {
      applyTitleUpdatesToCache(updates)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('docs:titles-updated', updates)
      }
    })
  }

  return result
})

// Phase 4: On-demand single file parsing
ipcMain.handle('issues:parse-file', async (_event, filePath: string) => {
  return parseFileOnDemand(filePath)
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

// IPC handlers for skills
ipcMain.handle('skills:get-available', () => {
  return skillsManager.getAvailableSkills()
})

ipcMain.handle('skills:get-installed', (_event, projectPath: string) => {
  return skillsManager.getInstalledSkills(projectPath)
})

ipcMain.handle('skills:install', (_event, skillName: string, projectPath: string) => {
  skillsManager.installSkill(skillName, projectPath)
})

ipcMain.handle('skills:uninstall', (_event, skillName: string, projectPath: string) => {
  skillsManager.uninstallSkill(skillName, projectPath)
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

// IPC handlers for kanban
ipcMain.handle('kanban:load', async (_event, workspacePath: string) => {
  const _t = performance.now()
  console.log(`[PERF][Main] kanban:load start`)
  const result = await kanbanStore.loadStore(workspacePath)
  console.log(`[PERF][Main] kanban:load done issues=${result.issues.length} ${(performance.now() - _t).toFixed(1)}ms`)
  return result
})

ipcMain.handle('kanban:create-issue', (_event, workspacePath: string, data: { title: string; description?: string; status?: string }) => {
  return kanbanStore.createIssue(workspacePath, data)
})

ipcMain.handle('kanban:update-issue', (_event, workspacePath: string, issueId: string, updates: Parameters<typeof kanbanStore.updateIssue>[2]) => {
  return kanbanStore.updateIssue(workspacePath, issueId, updates)
})

ipcMain.handle('kanban:delete-issue', (_event, workspacePath: string, issueId: string) => {
  return kanbanStore.deleteIssue(workspacePath, issueId)
})

ipcMain.handle('kanban:update-status', (_event, workspacePath: string, issueId: string, status: string) => {
  return kanbanStore.updateIssueStatus(workspacePath, issueId, status)
})

ipcMain.handle('kanban:generate-prompt', async (_event, workspacePath: string, issueId: string, templateId?: string) => {
  const store = await kanbanStore.loadStore(workspacePath)
  const issue = store.issues.find((i) => i.id === issueId)
  if (!issue) return null
  const template = templateId
    ? store.promptTemplates.find((t) => t.id === templateId)
    : store.promptTemplates.find((t) => t.isDefault) ?? store.promptTemplates[0]
  if (!template) return null
  return kanbanStore.generatePrompt(issue, template)
})

ipcMain.handle('kanban:link-doc', (_event, workspacePath: string, issueId: string, docPath: string) => {
  return kanbanStore.linkDocument(workspacePath, issueId, docPath)
})

ipcMain.handle('kanban:unlink-doc', (_event, workspacePath: string, issueId: string, docPath: string) => {
  return kanbanStore.unlinkDocument(workspacePath, issueId, docPath)
})

ipcMain.handle('kanban:auto-link', (_event, workspacePath: string, issueId: string) => {
  return kanbanStore.autoLinkDocuments(workspacePath, issueId, workspacePath)
})

ipcMain.handle('kanban:get-columns', async (_event, workspacePath: string) => {
  const store = await kanbanStore.loadStore(workspacePath)
  return store.columns
})

ipcMain.handle('kanban:set-columns', (_event, workspacePath: string, columns: Parameters<typeof kanbanStore.updateColumns>[1]) => {
  return kanbanStore.updateColumns(workspacePath, columns)
})

ipcMain.handle('kanban:get-templates', (_event, workspacePath: string) => {
  return kanbanStore.getPromptTemplates(workspacePath)
})

ipcMain.handle('kanban:save-template', (_event, workspacePath: string, template: Parameters<typeof kanbanStore.savePromptTemplate>[1]) => {
  return kanbanStore.savePromptTemplate(workspacePath, template)
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

  const approvalDetector = new ApprovalDetector((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:approval-detected', event)
    }
  })
  terminalManager.setApprovalDetector(approvalDetector)
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
  terminalManager.dispose()
  watcherManager.stop()
  apiServer.stop()
})
