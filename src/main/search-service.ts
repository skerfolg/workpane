import * as fs from 'fs'
import * as path from 'path'

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

const SCOPE_PATHS: Record<string, string> = {
  docs: 'docs/',
  source: 'src/'
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.vite'])

// --- Search result cache ---
// Key: rootDir + query + options; invalidated when files change
interface SearchCacheEntry {
  results: SearchResult[]
  timestamp: number
}
const searchCache = new Map<string, SearchCacheEntry>()
const SEARCH_CACHE_TTL_MS = 30_000 // 30 seconds

function makeSearchCacheKey(rootDir: string, query: string, options: SearchOptions): string {
  return `${rootDir}::${query}::${options.scopes.join(',')}::${options.caseSensitive ?? false}::${options.wholeWord ?? false}::${options.regex ?? false}`
}

export function invalidateSearchCache(rootDir?: string): void {
  if (rootDir) {
    for (const key of searchCache.keys()) {
      if (key.startsWith(rootDir)) searchCache.delete(key)
    }
  } else {
    searchCache.clear()
  }
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.avi', '.mov',
  '.woff', '.woff2', '.ttf', '.eot',
  '.node'
])

const MAX_FILE_SIZE_BYTES = 1024 * 1024 // 1MB

function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

function getCategoryFromPath(filePath: string, rootDir: string): string {
  const relative = filePath.replace(/\\/g, '/').replace(rootDir.replace(/\\/g, '/') + '/', '')
  if (relative.startsWith('docs/')) return 'Docs'
  if (relative.startsWith('src/')) return 'Source'
  return 'Other'
}

async function scanDir(dirPath: string, rootDir: string, query: string, opts: SearchOptions, results: SearchResult[]): Promise<void> {
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await scanDir(fullPath, rootDir, query, opts, results)
    } else if (entry.isFile()) {
      if (isBinaryFile(fullPath)) continue
      await searchInFile(fullPath, rootDir, query, opts, results)
    }
  }
}

async function searchInFile(filePath: string, rootDir: string, query: string, opts: SearchOptions, results: SearchResult[]): Promise<void> {
  // Skip files larger than 1MB to avoid memory pressure
  try {
    const stat = await fs.promises.stat(filePath)
    if (stat.size > MAX_FILE_SIZE_BYTES) return
  } catch {
    return
  }

  let content: string
  try {
    content = await fs.promises.readFile(filePath, 'utf-8')
  } catch {
    return
  }

  const lines = content.split('\n')
  const matches: SearchMatch[] = []

  let pattern: RegExp
  try {
    if (opts.regex) {
      pattern = new RegExp(query, opts.caseSensitive ? 'g' : 'gi')
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const wordBoundary = opts.wholeWord ? '\\b' : ''
      pattern = new RegExp(`${wordBoundary}${escaped}${wordBoundary}`, opts.caseSensitive ? 'g' : 'gi')
    }
  } catch {
    return
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(line)) !== null) {
      matches.push({
        line: line.trim(),
        lineNumber: i + 1,
        matchStart: match.index,
        matchEnd: match.index + match[0].length
      })
      if (!pattern.global) break
    }
  }

  if (matches.length > 0) {
    results.push({
      filePath,
      fileName: path.basename(filePath),
      category: getCategoryFromPath(filePath, rootDir),
      matches
    })
  }
}

export async function searchFiles(rootDir: string, query: string, options: SearchOptions): Promise<SearchResult[]> {
  const _t = performance.now()
  console.log(`[PERF][Main] searchFiles start query="${query}" scopes=${JSON.stringify(options.scopes)}`)
  if (!query) return []

  // Check cache
  const cacheKey = makeSearchCacheKey(rootDir, query, options)
  const cached = searchCache.get(cacheKey)
  if (cached && (Date.now() - cached.timestamp) < SEARCH_CACHE_TTL_MS) {
    console.log(`[PERF][Main] searchFiles cache hit results=${cached.results.length} ${(performance.now() - _t).toFixed(1)}ms`)
    return cached.results
  }

  const results: SearchResult[] = []
  const normalizedRoot = rootDir.replace(/\\/g, '/')

  const scopesToSearch = options.scopes && options.scopes.length > 0 ? options.scopes : Object.keys(SCOPE_PATHS)

  for (const scope of scopesToSearch) {
    const scopeRelPath = SCOPE_PATHS[scope]
    if (!scopeRelPath) continue

    const scopeAbsPath = path.join(rootDir, scopeRelPath)
    const _st = performance.now()

    try {
      await fs.promises.access(scopeAbsPath)
    } catch {
      continue
    }

    await scanDir(scopeAbsPath, normalizedRoot, query, options, results)
    console.log(`[PERF][Main] searchFiles: scope=${scope} done ${(performance.now() - _st).toFixed(1)}ms`)
  }

  // Store in cache
  searchCache.set(cacheKey, { results, timestamp: Date.now() })
  console.log(`[PERF][Main] searchFiles done results=${results.length} ${(performance.now() - _t).toFixed(1)}ms`)
  return results
}

export async function replaceInFiles(
  rootDir: string,
  query: string,
  replacement: string,
  filePaths: string[],
  options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }
): Promise<void> {
  const opts = options ?? {}

  let pattern: RegExp
  try {
    if (opts.regex) {
      pattern = new RegExp(query, opts.caseSensitive ? 'g' : 'gi')
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const wordBoundary = opts.wholeWord ? '\\b' : ''
      pattern = new RegExp(`${wordBoundary}${escaped}${wordBoundary}`, opts.caseSensitive ? 'g' : 'gi')
    }
  } catch {
    return
  }

  for (const filePath of filePaths) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const updated = content.replace(pattern, replacement)
      if (updated !== content) {
        await fs.promises.writeFile(filePath, updated, 'utf-8')
      }
    } catch {
      // skip files that cannot be read/written
    }
  }
}
