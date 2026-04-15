import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  ApprovalDetectedEvent,
  SessionMonitoringClearEvent,
  SessionMonitoringTransitionEvent,
  SessionMonitoringUpsertEvent,
  LlmApprovalAnalysisPreview,
  LlmModelSummary,
  LlmProviderId,
  LlmRuntimeInput,
  LlmSettingsState,
  LlmStorageStatus
} from '../shared/types'

export interface TerminalAPI {
  create: (id: string, shell?: string, cwd?: string) => Promise<void>
  write: (id: string, data: string) => void
  resize: (id: string, cols: number, rows: number) => void
  kill: (id: string) => Promise<void>
  onData: (callback: (id: string, data: string) => void) => () => void
  onExit: (callback: (id: string, exitCode: number) => void) => () => void
  getScrollback: (id: string) => Promise<string>
  onApprovalDetected: (callback: (event: ApprovalDetectedEvent) => void) => () => void
  onMonitoringUpsert: (callback: (event: SessionMonitoringUpsertEvent) => void) => () => void
  onMonitoringClear: (callback: (event: SessionMonitoringClearEvent) => void) => () => void
  onMonitoringTransition: (callback: (event: SessionMonitoringTransitionEvent) => void) => () => void
  testOpenFile?: (terminalId: string, filePath: string) => void
  onTestOpenFile?: (terminalId: string, callback: (filePath: string) => void) => () => void
}

export interface SettingsAPI {
  get: (key?: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

export interface LlmAPI {
  getSettingsState: () => Promise<LlmSettingsState>
  getStorageStatus: () => Promise<LlmStorageStatus>
  setProviderEnabled: (providerId: LlmProviderId, enabled: boolean) => Promise<void>
  setSelectedProvider: (providerId: LlmProviderId) => Promise<void>
  setSelectedModel: (providerId: LlmProviderId, modelId: string) => Promise<void>
  setConsent: (enabled: boolean) => Promise<void>
  setFallbackOrder: (order: LlmProviderId[]) => Promise<void>
  setApiKey: (providerId: LlmProviderId, apiKey: string) => Promise<void>
  clearApiKey: (providerId: LlmProviderId) => Promise<void>
  listModels: (providerId: LlmProviderId) => Promise<LlmModelSummary[]>
  classifyPreview: (input: LlmRuntimeInput) => Promise<LlmApprovalAnalysisPreview>
}

export interface WorkspaceInfo {
  path: string
  name: string
}

export interface WorkspaceAPI {
  open: () => Promise<WorkspaceInfo | null>
  openPath: (dirPath: string) => Promise<WorkspaceInfo>
  close: () => Promise<void>
  getCurrent: () => Promise<WorkspaceInfo | null>
  getRecent: () => Promise<string[]>
  saveState: (state: Record<string, unknown>) => Promise<void>
  getState: () => Promise<Record<string, unknown> | null>
  onChanged: (callback: (workspaceInfo: WorkspaceInfo | null) => void) => () => void
}

export interface DirEntry {
  name: string
  isDirectory: boolean
  size: number
  path: string
}

export interface FsAPI {
  readFile: (path: string) => Promise<string>
  readFileStream: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  readDir: (dirPath: string) => Promise<DirEntry[]>
  mkdir: (dirPath: string) => Promise<void>
  rename: (oldPath: string, newPath: string) => Promise<void>
  delete: (targetPath: string) => Promise<void>
  stat: (filePath: string) => Promise<{ isDirectory: boolean; size: number; mtime: number }>
  getGitignorePatterns: (rootPath: string) => Promise<string[]>
}

export interface WatcherAPI {
  start: (dirPath: string, excludePaths?: string[]) => Promise<void>
  stop: () => Promise<void>
  onChanged: (callback: (data: { type: string; path: string }) => void) => () => void
}

export interface ShellAPI {
  openExternal: (url: string) => Promise<void>
}

export interface ThemeAPI {
  import: () => Promise<string | null>
}

export interface SearchMatch {
  line: string
  lineNumber: number
  matchStart: number
  matchEnd: number
}

export interface SearchResult {
  filePath: string
  fileName: string
  category: string
  matches: SearchMatch[]
}

export interface SearchOptions {
  scopes: string[]
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export interface SearchAPI {
  find: (rootDir: string, query: string, options: SearchOptions) => Promise<SearchResult[]>
  replace: (rootDir: string, query: string, replacement: string, filePaths: string[], options?: Omit<SearchOptions, 'scopes'>) => Promise<void>
}

export interface BrowserAPI {
  register: (id: string, webContentsId: number) => Promise<void>
  navigate: (id: string, url: string) => Promise<void>
  goBack: (id: string) => Promise<void>
  goForward: (id: string) => Promise<void>
  reload: (id: string) => Promise<void>
  toggleDevTools: (id: string) => Promise<void>
  close: (id: string) => Promise<void>
  onNavigated: (callback: (id: string, url: string) => void) => () => void
  onTitleUpdated: (callback: (id: string, title: string) => void) => () => void
  onLoadingChanged: (callback: (id: string, isLoading: boolean) => void) => () => void
  onNavigationStateChanged: (callback: (id: string, canGoBack: boolean, canGoForward: boolean) => void) => () => void
  onConsoleMessage: (callback: (id: string, level: string, message: string) => void) => () => void
}

export interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdaterAPI {
  onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => void
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => void
  onUpdateDownloaded: (callback: () => void) => void
  onUpdateError: (callback: (err: unknown) => void) => void
  download: () => Promise<void>
  install: () => Promise<void>
  check: () => Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    terminal: TerminalAPI
    settings: SettingsAPI
    llm: LlmAPI
    workspace: WorkspaceAPI
    fs: FsAPI
    watcher: WatcherAPI
    shell: ShellAPI
    search: SearchAPI
    theme: ThemeAPI
    updater: UpdaterAPI
    browser: BrowserAPI
    api: unknown
  }
}
