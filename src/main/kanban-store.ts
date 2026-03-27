import * as fs from 'fs'
import * as path from 'path'
import { KanbanStore, KanbanIssue, ColumnDef, PromptTemplate, Prompt } from '../shared/types'

function generateHash(): string {
  const chars = '0123456789abcdef'
  let hash = ''
  for (let i = 0; i < 7; i++) {
    hash += chars[Math.floor(Math.random() * 16)]
  }
  return hash
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { id: 'todo', label: 'TO DO' },
  { id: 'in-progress', label: 'IN PROGRESS' },
  { id: 'in-review', label: 'IN REVIEW' },
  { id: 'done', label: 'DONE' }
]

const DEFAULT_TEMPLATE: PromptTemplate = {
  id: 'default',
  name: 'Default',
  template: `## Task: {{title}}

### Context
{{description}}

### Output Requirements
- Output filename pattern: \`docs/results/YYYY-MM-DD-{hash}-{{slug}}-result.md\`
- Include the following tag at the top of the file: \`<!-- issue-id: {{issueId}} -->\`
- After completion, create the result document at the path above.

### Instructions
Based on the context above, perform the task and generate the deliverable document in the specified format.`,
  isDefault: true
}

const DEFAULT_STORE: KanbanStore = {
  issues: [],
  columns: DEFAULT_COLUMNS,
  promptTemplates: [DEFAULT_TEMPLATE]
}

function getKanbanPath(workspacePath: string): string {
  return path.join(workspacePath, '.workspace', 'kanban.json')
}

// --- In-memory cache ---
// Keyed by workspacePath; updated synchronously on every saveStore()
const storeCache = new Map<string, KanbanStore>()

// --- Write-behind: track pending write promise per workspace ---
const pendingWrite = new Map<string, Promise<void>>()

export async function loadStore(workspacePath: string): Promise<KanbanStore> {
  // Return cached copy if available
  const cached = storeCache.get(workspacePath)
  if (cached) {
    console.log(`[PERF][Main] loadStore cache hit issues=${cached.issues.length}`)
    return cached
  }

  const _t = performance.now()
  const kanbanPath = getKanbanPath(workspacePath)
  try {
    const raw = await fs.promises.readFile(kanbanPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<KanbanStore>
    const result: KanbanStore = {
      issues: parsed.issues ?? [],
      columns: parsed.columns ?? DEFAULT_COLUMNS,
      promptTemplates: parsed.promptTemplates ?? [DEFAULT_TEMPLATE]
    }
    // Migrate: ensure all issues have a hash
    let migrated = false
    for (const issue of result.issues) {
      if (!issue.hash) {
        issue.hash = generateHash()
        migrated = true
      }
    }
    if (migrated) {
      saveStore(workspacePath, result)
    }
    storeCache.set(workspacePath, result)
    console.log(`[PERF][Main] loadStore done issues=${result.issues.length} ${(performance.now() - _t).toFixed(1)}ms`)
    return result
  } catch {
    const result: KanbanStore = { ...DEFAULT_STORE, issues: [], columns: [...DEFAULT_COLUMNS], promptTemplates: [DEFAULT_TEMPLATE] }
    storeCache.set(workspacePath, result)
    console.log(`[PERF][Main] loadStore done (default) ${(performance.now() - _t).toFixed(1)}ms`)
    return result
  }
}

export function saveStore(workspacePath: string, store: KanbanStore): Promise<void> {
  // Update cache synchronously so subsequent reads see the new data immediately
  storeCache.set(workspacePath, store)

  // Write-behind: fire async write without blocking callers
  const writePromise = (async (): Promise<void> => {
    const _t = performance.now()
    const kanbanPath = getKanbanPath(workspacePath)
    const dir = path.dirname(kanbanPath)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(kanbanPath, JSON.stringify(store, null, 2), 'utf-8')
    console.log(`[PERF][Main] saveStore write-behind done ${(performance.now() - _t).toFixed(1)}ms`)
    pendingWrite.delete(workspacePath)
  })()

  pendingWrite.set(workspacePath, writePromise)
  // Return the promise so callers that need durability can await it,
  // but CRUD callers no longer need to await it
  return writePromise
}

export async function createIssue(
  workspacePath: string,
  data: { title: string; description?: string; status?: string }
): Promise<KanbanIssue> {
  const _t = performance.now()
  const store = await loadStore(workspacePath)
  const now = new Date().toISOString()
  const issue: KanbanIssue = {
    id: crypto.randomUUID(),
    hash: generateHash(),
    title: data.title,
    description: data.description ?? '',
    status: data.status ?? 'todo',
    createdAt: now,
    updatedAt: now,
    linkedDocuments: []
  }
  store.issues.push(issue)
  saveStore(workspacePath, store) // write-behind: don't await
  console.log(`[PERF][Main] createIssue done (cache updated) ${(performance.now() - _t).toFixed(1)}ms`)
  return issue
}

export async function updateIssue(
  workspacePath: string,
  issueId: string,
  updates: Partial<Pick<KanbanIssue, 'title' | 'description' | 'status' | 'linkedDocuments' | 'promptId'>>
): Promise<KanbanIssue | null> {
  const _t = performance.now()
  const store = await loadStore(workspacePath)
  const idx = store.issues.findIndex((i) => i.id === issueId)
  if (idx === -1) return null
  store.issues[idx] = { ...store.issues[idx], ...updates, updatedAt: new Date().toISOString() }
  saveStore(workspacePath, store) // write-behind: don't await
  console.log(`[PERF][Main] updateIssue done (cache updated) ${(performance.now() - _t).toFixed(1)}ms`)
  return store.issues[idx]
}

export async function deleteIssue(workspacePath: string, issueId: string): Promise<boolean> {
  const _t = performance.now()
  const store = await loadStore(workspacePath)
  const idx = store.issues.findIndex((i) => i.id === issueId)
  if (idx === -1) return false
  store.issues.splice(idx, 1)
  saveStore(workspacePath, store) // write-behind: don't await
  console.log(`[PERF][Main] deleteIssue done (cache updated) ${(performance.now() - _t).toFixed(1)}ms`)
  return true
}

export function invalidateCache(workspacePath: string): void {
  storeCache.delete(workspacePath)
}

export async function updateIssueStatus(
  workspacePath: string,
  issueId: string,
  status: string
): Promise<KanbanIssue | null> {
  return updateIssue(workspacePath, issueId, { status })
}

export function generatePrompt(issue: KanbanIssue, template: PromptTemplate): Prompt {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const content = template.template
    .replace(/\{\{title\}\}/g, issue.title)
    .replace(/\{\{description\}\}/g, issue.description)
    .replace(/\{\{issueId\}\}/g, issue.id)
    .replace(/\{\{hash\}\}/g, issue.hash ?? '')
    .replace(/\{\{slug\}\}/g, slug)

  return {
    id: crypto.randomUUID(),
    issueId: issue.id,
    content,
    template: template.id,
    createdAt: new Date().toISOString()
  }
}

export async function linkDocument(
  workspacePath: string,
  issueId: string,
  docPath: string
): Promise<KanbanIssue | null> {
  const store = await loadStore(workspacePath)
  const issue = store.issues.find((i) => i.id === issueId)
  if (!issue) return null
  if (!issue.linkedDocuments.includes(docPath)) {
    issue.linkedDocuments.push(docPath)
    issue.updatedAt = new Date().toISOString()
    await saveStore(workspacePath, store)
  }
  return issue
}

export async function unlinkDocument(
  workspacePath: string,
  issueId: string,
  docPath: string
): Promise<KanbanIssue | null> {
  const store = await loadStore(workspacePath)
  const issue = store.issues.find((i) => i.id === issueId)
  if (!issue) return null
  issue.linkedDocuments = issue.linkedDocuments.filter((p) => p !== docPath)
  issue.updatedAt = new Date().toISOString()
  await saveStore(workspacePath, store)
  return issue
}

export async function getLinkedDocuments(
  workspacePath: string,
  issueId: string
): Promise<string[]> {
  const store = await loadStore(workspacePath)
  const issue = store.issues.find((i) => i.id === issueId)
  return issue?.linkedDocuments ?? []
}

export async function autoLinkDocuments(
  workspacePath: string,
  issueId: string,
  projectRoot: string
): Promise<KanbanIssue | null> {
  const store = await loadStore(workspacePath)
  const issue = store.issues.find((i) => i.id === issueId)
  if (!issue) return null

  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  // Search for files matching the issue id or slug pattern
  const linked: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'out', 'build'].includes(entry.name)) {
          await walk(fullPath)
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (entry.name.includes(issue!.hash) || (slug && entry.name.includes(slug))) {
          linked.push(fullPath)
        }
      }
    }
  }

  await walk(projectRoot)
  if (linked.length > 0) {
    issue.linkedDocuments = [...new Set([...issue.linkedDocuments, ...linked])]
    issue.updatedAt = new Date().toISOString()
    await saveStore(workspacePath, store)
  }
  return issue
}

export async function updateColumns(workspacePath: string, columns: ColumnDef[]): Promise<void> {
  const store = await loadStore(workspacePath)
  store.columns = columns
  await saveStore(workspacePath, store)
}

export async function getPromptTemplates(workspacePath: string): Promise<PromptTemplate[]> {
  const store = await loadStore(workspacePath)
  return store.promptTemplates
}

export async function savePromptTemplate(
  workspacePath: string,
  template: PromptTemplate
): Promise<PromptTemplate> {
  const store = await loadStore(workspacePath)
  const idx = store.promptTemplates.findIndex((t) => t.id === template.id)
  if (idx === -1) {
    store.promptTemplates.push(template)
  } else {
    store.promptTemplates[idx] = template
  }
  await saveStore(workspacePath, store)
  return template
}
