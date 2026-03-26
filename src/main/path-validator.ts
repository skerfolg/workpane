import * as path from 'path'
import * as fs from 'fs'

export function assertWithinWorkspace(targetPath: string, workspaceRoot: string): void {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(workspaceRoot)

  // Resolve symlinks if they exist
  let realTarget: string
  let realRoot: string
  try {
    realTarget = fs.realpathSync(resolvedTarget)
  } catch {
    // Target may not exist yet (e.g., creating a new file) — check parent
    const parent = path.dirname(resolvedTarget)
    try {
      realTarget = path.join(fs.realpathSync(parent), path.basename(resolvedTarget))
    } catch {
      realTarget = resolvedTarget
    }
  }
  try {
    realRoot = fs.realpathSync(resolvedRoot)
  } catch {
    realRoot = resolvedRoot
  }

  const normalizedTarget = realTarget.replace(/\\/g, '/').toLowerCase()
  const normalizedRoot = realRoot.replace(/\\/g, '/').toLowerCase()

  if (!normalizedTarget.startsWith(normalizedRoot + '/') && normalizedTarget !== normalizedRoot) {
    throw new Error(`Path is outside workspace: ${targetPath}`)
  }
}
