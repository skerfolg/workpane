/**
 * Worker Thread for file system scanning.
 * Runs walkDirectory off the main thread to prevent UI blocking.
 */
import { parentPort, workerData } from 'worker_threads'
import { readdir, type Dirent } from 'fs/promises'
import { join } from 'path'

const MAX_WALK_DEPTH = 10

interface WorkerInput {
  rootPath: string
  excludePaths: string[]
}

async function walkDirectory(rootPath: string, excludePaths: string[]): Promise<string[]> {
  const excludeSet = new Set([...excludePaths, '.workspace'].map(p => p.toLowerCase()))

  async function walk(dir: string, depth: number): Promise<string[]> {
    if (depth > MAX_WALK_DEPTH) return []

    let dirents: Dirent[]
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }

    const validDirents = dirents.filter(d => !excludeSet.has(d.name.toLowerCase()))

    const subdirs: string[] = []
    const mdFiles: string[] = []

    for (const d of validDirents) {
      if (d.isSymbolicLink()) continue
      if (d.isDirectory()) {
        subdirs.push(join(dir, d.name))
      } else if (d.isFile() && d.name.endsWith('.md')) {
        if (d.name !== 'INDEX.md' && d.name !== 'README.md') {
          mdFiles.push(join(dir, d.name))
        }
      }
    }

    if (subdirs.length === 0) return mdFiles

    // Process subdirectories with bounded concurrency
    const IO_CONCURRENCY = 20
    const results = [...mdFiles]
    for (let i = 0; i < subdirs.length; i += IO_CONCURRENCY) {
      const batch = subdirs.slice(i, i + IO_CONCURRENCY)
      const batchResults = await Promise.all(batch.map(s => walk(s, depth + 1)))
      for (const r of batchResults) results.push(...r)
    }
    return results
  }

  return walk(rootPath, 0)
}

const { rootPath, excludePaths } = workerData as WorkerInput
walkDirectory(rootPath, excludePaths)
  .then(files => parentPort?.postMessage({ type: 'result', files }))
  .catch(err => parentPort?.postMessage({ type: 'error', message: String(err) }))
