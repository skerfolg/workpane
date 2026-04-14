import { promises as fs } from 'fs'
import { join, basename, dirname } from 'path'
import { createHash } from 'crypto'
// fs.lstat used via promises import
import { DocEntry, DocGroup, IssueStatus, Issue } from '../shared/types'

// Match: yyyy-mm-dd-{7char-hash}-{topic}-{type}.md
// Also match: yyyy-mm-dd-{7char-hash}-{topic}-{type}-{extra}.md (e.g. sprint-1-full-implementation)
const FILENAME_RE =
  /^(\d{4}-\d{2}-\d{2})-([a-f0-9]{7})-(.+)\.md$/i

function parseDocFilename(name: string): {
  date: string
  hash: string
  topicAndType: string
} | null {
  const m = FILENAME_RE.exec(name)
  if (!m) return null
  return {
    date: m[1],
    hash: m[2],
    topicAndType: m[3]
  }
}

// Known document type suffixes (checked from end of filename)
const DOC_TYPE_SUFFIXES = [
  'design', 'plan', 'report', 'result', 'issue',
  'sprint', 'resolution', 'case-report', 'full-implementation'
]

function extractTopicAndType(topicAndType: string): { topic: string; docType: string } {
  // Try to match known suffixes from the end
  for (const suffix of DOC_TYPE_SUFFIXES) {
    if (topicAndType.endsWith('-' + suffix)) {
      const topic = topicAndType.slice(0, -(suffix.length + 1))
      return { topic, docType: suffix }
    }
  }

  // Check for sprint-N patterns like "sprint-1-owner-draw-cardpanel"
  const sprintMatch = topicAndType.match(/^(.+?)-(sprint-\d+.*)$/)
  if (sprintMatch) {
    return { topic: sprintMatch[1], docType: sprintMatch[2] }
  }

  // Fallback: last segment is the type
  const lastDash = topicAndType.lastIndexOf('-')
  if (lastDash > 0) {
    return {
      topic: topicAndType.slice(0, lastDash),
      docType: topicAndType.slice(lastDash + 1)
    }
  }

  return { topic: topicAndType, docType: 'doc' }
}

function extractTitle(content: string, fallback: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) return trimmed.slice(2).trim()
  }
  return fallback
}

function topicToLabel(topic: string): string {
  return topic
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

async function scanDirectory(dirPath: string, folderName: string): Promise<DocEntry[]> {
  let files: string[]
  try {
    files = await fs.readdir(dirPath)
  } catch {
    return []
  }

  // Filter to .md files upfront, skip index/readme
  const mdFiles = files.filter(f =>
    f.endsWith('.md') && f !== 'INDEX.md' && f !== 'README.md'
  )

  // Parse all files in parallel
  const results = await Promise.allSettled(
    mdFiles.map(async (file) => {
      const parsed = parseDocFilename(file)
      if (!parsed) return null

      const filePath = join(dirPath, file)
      const { topic, docType } = extractTopicAndType(parsed.topicAndType)

      const title = topicToLabel(topic)

      return {
        filePath,
        date: parsed.date,
        hash: parsed.hash,
        topic,
        docType,
        title,
        folder: folderName,
        source: 'standard'
      } as DocEntry
    })
  )

  const entries: DocEntry[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value !== null) entries.push(r.value)
  }
  return entries
}

// Folders to scan under docs/
const SCAN_FOLDERS = ['designs', 'plans', 'reports', 'results', 'issues']

export async function scanDocs(docsPath: string): Promise<DocGroup[]> {
  const _t = performance.now()
  console.log(`[PERF][Main] scanDocs start path=${docsPath}`)

  // Scan all subfolders + root in parallel
  const foldersToScan = [...SCAN_FOLDERS.map(f => ({ dir: join(docsPath, f), name: f })), { dir: docsPath, name: 'docs' }]
  const scanResults = await Promise.allSettled(
    foldersToScan.map(({ dir, name }) => scanDirectory(dir, name))
  )

  const allEntries: DocEntry[] = []
  for (const r of scanResults) {
    if (r.status === 'fulfilled') allEntries.push(...r.value)
  }
  console.log(`[PERF][Main] scanDocs: collected ${allEntries.length} entries ${(performance.now() - _t).toFixed(1)}ms`)

  // Group by hash
  const groupMap = new Map<string, DocEntry[]>()
  for (const entry of allEntries) {
    const existing = groupMap.get(entry.hash) || []
    existing.push(entry)
    groupMap.set(entry.hash, existing)
  }

  // Build DocGroup array
  const groups: DocGroup[] = []
  for (const [hash, documents] of groupMap) {
    // Sort documents by docType for consistent ordering
    documents.sort((a, b) => a.docType.localeCompare(b.docType))

    // Use the most common topic as the group topic
    const topicCounts = new Map<string, number>()
    for (const doc of documents) {
      topicCounts.set(doc.topic, (topicCounts.get(doc.topic) || 0) + 1)
    }
    let bestTopic = documents[0].topic
    let bestCount = 0
    for (const [topic, count] of topicCounts) {
      if (count > bestCount) {
        bestTopic = topic
        bestCount = count
      }
    }

    // Latest date
    const latestDate = documents.reduce(
      (latest, d) => (d.date > latest ? d.date : latest),
      documents[0].date
    )

    // Unique doc types
    const docTypes = [...new Set(documents.map((d) => d.docType))].sort()

    groups.push({
      hash,
      topic: topicToLabel(bestTopic),
      date: latestDate,
      documents,
      docTypes,
      source: 'standard'
    })
  }

  // Sort groups by latest date descending
  groups.sort((a, b) => b.date.localeCompare(a.date))

  console.log(`[PERF][Main] scanDocs done groups=${groups.length} ${(performance.now() - _t).toFixed(1)}ms`)
  return groups
}

// Keep backward compat export name for IPC handler
export { scanDocs as scanIssues }

// --- Step 2: Project-wide markdown collection ---

// Concurrency-limited parallel execution (simple semaphore)
async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = []
  let i = 0
  async function next(): Promise<void> {
    while (i < items.length) {
      const idx = i++
      try {
        const val = await fn(items[idx])
        results[idx] = { status: 'fulfilled', value: val }
      } catch (reason) {
        results[idx] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()))
  return results
}

const IO_CONCURRENCY = 20

// Max directory depth for walkDirectory (prevents runaway recursion in huge repos)
const MAX_WALK_DEPTH = 10

async function walkDirectory(rootPath: string, excludePaths: string[]): Promise<string[]> {
  const _t = performance.now()
  console.log(`[PERF][Main] walkDirectory start root=${rootPath} (worker thread)`)

  const { Worker } = await import('worker_threads')
  const workerPath = join(__dirname, 'workers', 'scan-worker.js')

  return new Promise<string[]>((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: { rootPath, excludePaths }
    })

    worker.on('message', (msg: { type: string; files?: string[]; message?: string }) => {
      if (msg.type === 'result') {
        console.log(`[PERF][Main] walkDirectory done files=${msg.files!.length} ${(performance.now() - _t).toFixed(1)}ms (worker thread)`)
        resolve(msg.files!)
      } else {
        reject(new Error(msg.message ?? 'Worker scan failed'))
      }
      worker.terminate()
    })

    worker.on('error', (err) => {
      console.error('[Main] walkDirectory worker error:', err)
      reject(err)
    })
  })
}

function parseNonStandardDoc(filePath: string, content: string, projectRoot: string): DocEntry {
  // Extract title from first # heading or filename
  let title = basename(filePath, '.md')
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) {
      title = trimmed.slice(2).trim()
      break
    }
  }

  // Parse frontmatter if present
  let status = 'open'
  let priority = 'medium'
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3)
    if (end !== -1) {
      const block = content.slice(3, end)
      for (const line of block.split('\n')) {
        const colon = line.indexOf(':')
        if (colon === -1) continue
        const k = line.slice(0, colon).trim().toLowerCase()
        const v = line.slice(colon + 1).trim()
        if (k === 'status' && v) status = v
        if (k === 'priority' && v) priority = v
      }
    }
  }

  // Deterministic hash from relative path
  const relative = filePath.replace(projectRoot, '').replace(/\\/g, '/')
  const hash = createHash('sha1').update(relative).digest('hex').slice(0, 7)

  // Date from file or today
  const date = new Date().toISOString().slice(0, 10)

  return {
    filePath,
    date,
    hash,
    topic: title,
    docType: 'doc',
    title,
    folder: basename(dirname(filePath)),
    source: 'project'
  }
}

// Phase 1 (Lazy Scan): Create DocEntry from file path only — no fs.readFile
function createDocEntryFromPath(filePath: string, projectRoot: string): DocEntry {
  const fileName = basename(filePath, '.md')
  const parsed = parseDocFilename(basename(filePath))

  if (parsed) {
    // Standard-format filename: extract metadata from name
    const { topic, docType } = extractTopicAndType(parsed.topicAndType)
    return {
      filePath,
      date: parsed.date,
      hash: parsed.hash,
      topic,
      docType,
      title: topicToLabel(topic),
      folder: basename(dirname(filePath)),
      source: 'project'
    }
  }

  // Non-standard filename: use basename as title
  const relative = filePath.replace(projectRoot, '').replace(/\\/g, '/')
  const hash = createHash('sha1').update(relative).digest('hex').slice(0, 7)
  const date = new Date().toISOString().slice(0, 10)

  return {
    filePath,
    date,
    hash,
    topic: fileName,
    docType: 'doc',
    title: fileName,
    folder: basename(dirname(filePath)),
    source: 'project'
  }
}

// --- Scan cache for fast startup ---
interface ScanCacheEntry {
  mtime: number
  entry: DocEntry
}
interface ScanCache {
  version: number
  entries: Record<string, ScanCacheEntry>
}

const SCAN_CACHE_VERSION = 1

// In-memory scan cache to avoid re-reading JSON from disk
let inMemoryScanCache: ScanCache | null = null
let inMemoryScanCacheRoot: string | null = null

async function loadScanCache(projectRoot: string): Promise<ScanCache | null> {
  // Return in-memory cache if available for same project
  if (inMemoryScanCache && inMemoryScanCacheRoot === projectRoot) {
    return inMemoryScanCache
  }
  try {
    const cachePath = join(projectRoot, '.workspace', 'scan-cache.json')
    const data = await fs.readFile(cachePath, 'utf-8')
    const cache = JSON.parse(data) as ScanCache
    if (cache.version === SCAN_CACHE_VERSION) {
      inMemoryScanCache = cache
      inMemoryScanCacheRoot = projectRoot
      return cache
    }
  } catch {
    // No cache or invalid
  }
  return null
}

async function saveScanCache(projectRoot: string, cache: ScanCache): Promise<void> {
  // Update in-memory cache immediately
  inMemoryScanCache = cache
  inMemoryScanCacheRoot = projectRoot

  try {
    const wsDir = join(projectRoot, '.workspace')
    await fs.mkdir(wsDir, { recursive: true })
    const cachePath = join(wsDir, 'scan-cache.json')
    const newContent = JSON.stringify(cache)
    // Skip write if content unchanged
    try {
      const existing = await fs.readFile(cachePath, 'utf-8')
      if (existing === newContent) return
    } catch {
      // File doesn't exist yet, proceed with write
    }
    await fs.writeFile(cachePath, newContent, 'utf-8')
  } catch {
    // Non-critical
  }
}

// In-flight guard: prevent concurrent scanAllDocs for the same projectRoot
let scanInFlight: Promise<DocGroup[]> | null = null
let scanInFlightRoot: string | null = null

export async function scanAllDocs(projectRoot: string, excludePaths: string[]): Promise<DocGroup[]> {
  if (scanInFlight && scanInFlightRoot === projectRoot) {
    console.log(`[PERF][Main] scanAllDocs: returning in-flight promise for root=${projectRoot}`)
    return scanInFlight
  }
  scanInFlightRoot = projectRoot
  scanInFlight = _scanAllDocsImpl(projectRoot, excludePaths)
  try {
    return await scanInFlight
  } finally {
    scanInFlight = null
    scanInFlightRoot = null
  }
}

async function _scanAllDocsImpl(projectRoot: string, excludePaths: string[]): Promise<DocGroup[]> {
  const _t = performance.now()
  console.log(`[PERF][Main] scanAllDocs start root=${projectRoot}`)

  // Run standardGroups scan, cache load, and walkDirectory in parallel
  const docsPath = join(projectRoot, 'docs')
  const [standardGroupsResult, cacheResult, allFiles] = await Promise.allSettled([
    scanDocs(docsPath),
    loadScanCache(projectRoot),
    walkDirectory(projectRoot, excludePaths)
  ])

  const standardGroups: DocGroup[] = standardGroupsResult.status === 'fulfilled' ? standardGroupsResult.value : []
  const cache = cacheResult.status === 'fulfilled' ? cacheResult.value : null
  const walkedFiles: string[] = allFiles.status === 'fulfilled' ? allFiles.value : []

  console.log(`[PERF][Main] scanAllDocs: parallel phase done (standard=${standardGroups.length} files=${walkedFiles.length} cacheHits=${Object.keys(cache?.entries ?? {}).length}) ${(performance.now() - _t).toFixed(1)}ms`)

  // Collect all standard file paths for dedup
  const standardPaths = new Set<string>()
  for (const group of standardGroups) {
    for (const doc of group.documents) {
      standardPaths.add(doc.filePath.replace(/\\/g, '/'))
    }
  }

  // Phase 1 (Lazy Scan): Create DocEntries from filenames only — no fs.readFile
  const filesToInclude = walkedFiles.filter(fp => !standardPaths.has(fp.replace(/\\/g, '/')))

  const nonStandardEntries: DocEntry[] = filesToInclude.map(filePath => {
    return createDocEntryFromPath(filePath, projectRoot)
  })

  console.log(`[PERF][Main] scanAllDocs: created ${nonStandardEntries.length} non-standard entries from filenames ${(performance.now() - _t).toFixed(1)}ms`)

  // Group non-standard entries by parent directory
  const dirGroupMap = new Map<string, DocEntry[]>()
  for (const entry of nonStandardEntries) {
    const dir = entry.folder
    const existing = dirGroupMap.get(dir) || []
    existing.push(entry)
    dirGroupMap.set(dir, existing)
  }

  // Build non-standard DocGroups
  const projectGroups: DocGroup[] = []
  for (const [dir, documents] of dirGroupMap) {
    documents.sort((a, b) => a.title.localeCompare(b.title))
    const hash = createHash('sha1').update(`dir:${dir}`).digest('hex').slice(0, 7)
    const latestDate = documents.reduce(
      (latest, d) => (d.date > latest ? d.date : latest),
      documents[0].date
    )
    const docTypes = [...new Set(documents.map(d => d.docType))].sort()

    projectGroups.push({
      hash,
      topic: dir,
      date: latestDate,
      documents,
      docTypes,
      source: 'project'
    })
  }

  projectGroups.sort((a, b) => b.date.localeCompare(a.date))

  const total = [...standardGroups, ...projectGroups]
  console.log(`[PERF][Main] scanAllDocs done total=${total.length} groups (standard=${standardGroups.length} project=${projectGroups.length}) ${(performance.now() - _t).toFixed(1)}ms`)
  return total
}

// --- Phase 2: Background title enrichment ---

export interface TitleUpdate {
  filePath: string
  title: string
}

/** Update docCache with enriched titles to keep cache consistent */
export function applyTitleUpdatesToCache(updates: TitleUpdate[]): void {
  for (const u of updates) {
    const normalized = u.filePath.replace(/\\/g, '/')
    const entry = docCache.get(normalized)
    if (entry) {
      entry.title = u.title
      entry.topic = u.title
    }
  }
}

const ENRICH_BATCH_SIZE = 15

/**
 * Reads files in batches to extract real titles (# heading).
 * Uses scan cache to skip unchanged files (mtime check).
 * Calls onBatch with each batch of title updates as they complete.
 * Does NOT block the initial scan response.
 */
export async function enrichDocTitles(
  projectRoot: string,
  groups: DocGroup[],
  onBatch: (updates: TitleUpdate[]) => void
): Promise<void> {
  const _t = performance.now()
  console.log(`[PERF][Main] enrichDocTitles start`)

  // Load scan cache for mtime-based skip
  const cache = await loadScanCache(projectRoot)
  const cachedEntries = cache?.entries ?? {}
  const newCacheEntries: Record<string, ScanCacheEntry> = { ...cachedEntries }
  let cacheHits = 0

  // Collect all doc entries, separate cache hits (sync) from misses (async)
  const cachedUpdates: TitleUpdate[] = []
  const uncachedEntries: DocEntry[] = []

  for (const group of groups) {
    for (const doc of group.documents) {
      const normalized = doc.filePath.replace(/\\/g, '/')
      const cached = cachedEntries[normalized]
      if (cached) {
        cacheHits++
        if (cached.entry.title !== doc.title) {
          cachedUpdates.push({ filePath: doc.filePath, title: cached.entry.title })
        }
      } else {
        uncachedEntries.push(doc)
      }
    }
  }

  // Flush cached title updates immediately (no I/O needed)
  if (cachedUpdates.length > 0) {
    onBatch(cachedUpdates)
  }

  // Process uncached entries in batches (async I/O)
  for (let i = 0; i < uncachedEntries.length; i += ENRICH_BATCH_SIZE) {
    const batch = uncachedEntries.slice(i, i + ENRICH_BATCH_SIZE)
    const updates: TitleUpdate[] = []

    await Promise.allSettled(
      batch.map(async (entry) => {
        const normalized = entry.filePath.replace(/\\/g, '/')
        try {
          const content = await fs.readFile(entry.filePath, 'utf-8')
          const newTitle = extractTitle(content, entry.title)
          const stat = await fs.lstat(entry.filePath)
          newCacheEntries[normalized] = { mtime: stat.mtimeMs, entry: { ...entry, title: newTitle, topic: newTitle } }
          if (newTitle !== entry.title) {
            updates.push({ filePath: entry.filePath, title: newTitle })
          }
        } catch {
          // File unreadable, keep filename-based title
        }
      })
    )

    if (updates.length > 0) {
      onBatch(updates)
    }
  }

  // Save updated cache
  saveScanCache(projectRoot, { version: SCAN_CACHE_VERSION, entries: newCacheEntries })

  console.log(`[PERF][Main] enrichDocTitles done entries=${cacheHits + uncachedEntries.length} cacheHits=${cacheHits} uncached=${uncachedEntries.length} ${(performance.now() - _t).toFixed(1)}ms`)
}

// --- Phase 3: In-memory cache & incremental update ---

export type IncrementalUpdateType = 'add' | 'change' | 'unlink'

export interface IncrementalUpdate {
  type: IncrementalUpdateType
  filePath: string
  entry?: DocEntry // present for add/change, absent for unlink
}

// Module-level in-memory cache: filePath (normalized) → DocEntry
const docCache = new Map<string, DocEntry>()
let cachedProjectRoot: string | null = null

/** Populate cache from scanAllDocs results */
export function populateCache(groups: DocGroup[], projectRoot: string): void {
  docCache.clear()
  cachedProjectRoot = projectRoot
  for (const group of groups) {
    for (const doc of group.documents) {
      docCache.set(doc.filePath.replace(/\\/g, '/'), doc)
    }
  }
  console.log(`[PERF][Main] docCache populated: ${docCache.size} entries`)
}

/**
 * Handle a single file change incrementally.
 * Returns an IncrementalUpdate describing what changed, or null if the file is not relevant (.md).
 */
export async function handleFileChange(
  type: IncrementalUpdateType,
  filePath: string,
  projectRoot: string
): Promise<IncrementalUpdate | null> {
  const _t = performance.now()

  // Only handle .md files
  if (!filePath.endsWith('.md')) return null

  const normalized = filePath.replace(/\\/g, '/')

  if (type === 'unlink') {
    const existed = docCache.delete(normalized)
    if (!existed) return null
    console.log(`[PERF][Main] handleFileChange unlink ${normalized} ${(performance.now() - _t).toFixed(1)}ms`)
    return { type: 'unlink', filePath: normalized }
  }

  // add or change: create/update DocEntry
  if (type === 'add' || type === 'change') {
    let entry: DocEntry

    // Try to read the file for full title extraction
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      entry = parseNonStandardDoc(filePath, content, projectRoot)
    } catch {
      // File unreadable, use path-based entry
      entry = createDocEntryFromPath(filePath, projectRoot)
    }

    docCache.set(normalized, entry)
    console.log(`[PERF][Main] handleFileChange ${type} ${normalized} ${(performance.now() - _t).toFixed(1)}ms`)
    return { type, filePath: normalized, entry }
  }

  return null
}

/** Rebuild DocGroup[] from current cache state */
export function buildGroupsFromCache(): DocGroup[] {
  // Separate standard (docs/) and project entries
  const standardEntries: DocEntry[] = []
  const projectEntries: DocEntry[] = []

  for (const entry of docCache.values()) {
    if (entry.source === 'standard') {
      standardEntries.push(entry)
    } else {
      projectEntries.push(entry)
    }
  }

  // Group standard entries by hash
  const standardGroupMap = new Map<string, DocEntry[]>()
  for (const entry of standardEntries) {
    const existing = standardGroupMap.get(entry.hash) || []
    existing.push(entry)
    standardGroupMap.set(entry.hash, existing)
  }

  const standardGroups: DocGroup[] = []
  for (const [hash, documents] of standardGroupMap) {
    documents.sort((a, b) => a.docType.localeCompare(b.docType))
    const topicCounts = new Map<string, number>()
    for (const doc of documents) {
      topicCounts.set(doc.topic, (topicCounts.get(doc.topic) || 0) + 1)
    }
    let bestTopic = documents[0].topic
    let bestCount = 0
    for (const [topic, count] of topicCounts) {
      if (count > bestCount) { bestTopic = topic; bestCount = count }
    }
    const latestDate = documents.reduce((l, d) => (d.date > l ? d.date : l), documents[0].date)
    const docTypes = [...new Set(documents.map(d => d.docType))].sort()
    standardGroups.push({ hash, topic: topicToLabel(bestTopic), date: latestDate, documents, docTypes, source: 'standard' })
  }

  // Group project entries by parent directory
  const dirGroupMap = new Map<string, DocEntry[]>()
  for (const entry of projectEntries) {
    const dir = entry.folder
    const existing = dirGroupMap.get(dir) || []
    existing.push(entry)
    dirGroupMap.set(dir, existing)
  }

  const projectGroups: DocGroup[] = []
  for (const [dir, documents] of dirGroupMap) {
    documents.sort((a, b) => a.title.localeCompare(b.title))
    const hash = createHash('sha1').update(`dir:${dir}`).digest('hex').slice(0, 7)
    const latestDate = documents.reduce((l, d) => (d.date > l ? d.date : l), documents[0].date)
    const docTypes = [...new Set(documents.map(d => d.docType))].sort()
    projectGroups.push({ hash, topic: dir, date: latestDate, documents, docTypes, source: 'project' })
  }

  standardGroups.sort((a, b) => b.date.localeCompare(a.date))
  projectGroups.sort((a, b) => b.date.localeCompare(a.date))

  return [...standardGroups, ...projectGroups]
}

// --- Phase 4: On-demand single file parsing ---

export interface ParsedFileResult {
  filePath: string
  title: string
  content: string
  frontmatter: Record<string, string>
}

// Cache for on-demand parsed files
const parsedFileCache = new Map<string, ParsedFileResult>()

/**
 * Parse a single file on demand — returns full title, content, and frontmatter.
 * Results are cached; subsequent calls for the same file return instantly.
 */
export async function parseFileOnDemand(filePath: string): Promise<ParsedFileResult> {
  const _t = performance.now()
  const normalized = filePath.replace(/\\/g, '/')

  // Return cached result if available
  const cached = parsedFileCache.get(normalized)
  if (cached) {
    console.log(`[PERF][Main] parseFileOnDemand cache hit ${normalized}`)
    return cached
  }

  const content = await fs.readFile(filePath, 'utf-8')

  // Extract title
  const title = extractTitle(content, basename(filePath, '.md'))

  // Parse frontmatter
  const frontmatter: Record<string, string> = {}
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3)
    if (end !== -1) {
      const block = content.slice(3, end)
      for (const line of block.split('\n')) {
        const colon = line.indexOf(':')
        if (colon === -1) continue
        const k = line.slice(0, colon).trim().toLowerCase()
        const v = line.slice(colon + 1).trim()
        if (k && v) frontmatter[k] = v
      }
    }
  }

  const result: ParsedFileResult = { filePath: normalized, title, content, frontmatter }
  parsedFileCache.set(normalized, result)

  console.log(`[PERF][Main] parseFileOnDemand ${normalized} ${(performance.now() - _t).toFixed(1)}ms`)
  return result
}

/** Invalidate on-demand cache for a specific file (called on file change) */
export function invalidateParsedCache(filePath: string): void {
  parsedFileCache.delete(filePath.replace(/\\/g, '/'))
}
