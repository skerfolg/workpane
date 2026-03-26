import { ElectronAPI } from '@electron-toolkit/preload'

export interface TerminalAPI {
  create: (id: string, shell?: string, cwd?: string) => Promise<void>
  write: (id: string, data: string) => void
  resize: (id: string, cols: number, rows: number) => void
  kill: (id: string) => Promise<void>
  onData: (callback: (id: string, data: string) => void) => () => void
  onExit: (callback: (id: string, exitCode: number) => void) => () => void
}

export interface SettingsAPI {
  get: (key?: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
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
  writeFile: (path: string, content: string) => Promise<void>
  readDir: (dirPath: string) => Promise<DirEntry[]>
  mkdir: (dirPath: string) => Promise<void>
  rename: (oldPath: string, newPath: string) => Promise<void>
  delete: (targetPath: string) => Promise<void>
  stat: (filePath: string) => Promise<{ isDirectory: boolean; size: number; mtime: number }>
  getGitignorePatterns: (rootPath: string) => Promise<string[]>
}

export type IssueStatus = string

export interface Issue {
  hash: string
  title: string
  status: string
  priority: string
  category: string
  type: string
  filePath: string
  date: string
  parentHash?: string
  seq?: number
  children?: Issue[]
}

export interface IssueCreateData {
  title: string
  status?: string
  priority?: string
  category?: string
  type?: string
  docsPath: string
}

export interface IssueUpdateData {
  status?: string
  priority?: string
  category?: string
  title?: string
  content?: string
}

export interface IssuesAPI {
  scan: (docsPath: string) => Promise<Issue[]>
  scanAll: (projectRoot: string) => Promise<unknown[]>
  create: (data: IssueCreateData) => Promise<string>
  update: (filePath: string, updates: IssueUpdateData) => Promise<void>
  delete: (filePath: string) => Promise<void>
  updateStatus: (filePath: string, status: string) => Promise<void>
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

export interface KanbanIssue {
  id: string
  title: string
  description: string
  status: string
  createdAt: string
  updatedAt: string
  linkedDocuments: string[]
  promptId?: string
}

export interface KanbanPrompt {
  id: string
  issueId: string
  content: string
  template: string
  createdAt: string
}

export interface KanbanPromptTemplate {
  id: string
  name: string
  template: string
  isDefault: boolean
}

export interface KanbanColumnDef {
  id: string
  label: string
}

export interface KanbanStoreData {
  issues: KanbanIssue[]
  columns: KanbanColumnDef[]
  promptTemplates: KanbanPromptTemplate[]
}

export interface KanbanAPI {
  load: (workspacePath: string) => Promise<KanbanStoreData>
  createIssue: (workspacePath: string, data: { title: string; description?: string; status?: string }) => Promise<KanbanIssue>
  updateIssue: (workspacePath: string, issueId: string, updates: { title?: string; description?: string; status?: string; linkedDocuments?: string[]; promptId?: string }) => Promise<KanbanIssue | null>
  deleteIssue: (workspacePath: string, issueId: string) => Promise<boolean>
  updateStatus: (workspacePath: string, issueId: string, status: string) => Promise<KanbanIssue | null>
  generatePrompt: (workspacePath: string, issueId: string, templateId?: string) => Promise<KanbanPrompt | null>
  linkDoc: (workspacePath: string, issueId: string, docPath: string) => Promise<KanbanIssue | null>
  unlinkDoc: (workspacePath: string, issueId: string, docPath: string) => Promise<KanbanIssue | null>
  autoLink: (workspacePath: string, issueId: string) => Promise<KanbanIssue | null>
  getColumns: (workspacePath: string) => Promise<KanbanColumnDef[]>
  setColumns: (workspacePath: string, columns: KanbanColumnDef[]) => Promise<void>
  getTemplates: (workspacePath: string) => Promise<KanbanPromptTemplate[]>
  saveTemplate: (workspacePath: string, template: KanbanPromptTemplate) => Promise<KanbanPromptTemplate>
}

declare global {
  interface Window {
    electron: ElectronAPI
    terminal: TerminalAPI
    settings: SettingsAPI
    workspace: WorkspaceAPI
    fs: FsAPI
    issues: IssuesAPI
    watcher: WatcherAPI
    shell: ShellAPI
    search: SearchAPI
    theme: ThemeAPI
    kanban: KanbanAPI
    api: unknown
  }
}
