import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Hook listener registry — RW-B + D5.
 *
 * `cc-bridge.js` does not know which socket belongs to which WorkPane
 * instance. When the CC hook fires, the bridge reads this registry,
 * tries each listed listener in parallel, and any HookServer whose
 * cwd / session_id filter passes keeps the payload.
 *
 * Writers (WorkPane main process):
 *   - On HookServer start → add { pid, terminalId, socketPath, tokenPath,
 *     workspacePath, startedAt } entry.
 *   - On HookServer dispose → remove matching entry.
 *   - On WP shutdown → remove all entries owned by our pid (best effort).
 *
 * Readers (bridge):
 *   - Read the JSON file, filter out stale pids (process.kill(pid, 0)
 *     throws ESRCH when dead), dispatch to each remaining socket.
 *
 * Atomicity: all writes go tmp → rename; rename is atomic on POSIX and
 * Windows. Concurrent writers will last-write-win; we accept the
 * inconsistency because readers always self-filter by pid liveness.
 */

export interface HookRegistryEntry {
  pid: number
  terminalId: string
  socketPath: string
  tokenPath: string
  workspacePath: string
  startedAt: number
}

export interface RegistryFile {
  version: 1
  entries: HookRegistryEntry[]
}

function defaultRegistryPath(): string {
  const runtime = process.env.XDG_RUNTIME_DIR ?? os.tmpdir()
  return path.join(runtime, 'workpane-hook-registry.json')
}

function readRegistryFile(registryPath: string): RegistryFile {
  try {
    const raw = fs.readFileSync(registryPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as RegistryFile).version === 1 &&
      Array.isArray((parsed as RegistryFile).entries)
    ) {
      return parsed as RegistryFile
    }
  } catch {
    // Missing file / corrupt JSON → start fresh
  }
  return { version: 1, entries: [] }
}

function writeRegistryFile(registryPath: string, data: RegistryFile): void {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true, mode: 0o700 })
  const tmp = `${registryPath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, registryPath)
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(registryPath, 0o600)
    } catch {
      // best effort
    }
  }
}

export interface RegistryOptions {
  registryPath?: string
}

export function registerHookListener(
  entry: HookRegistryEntry,
  options: RegistryOptions = {}
): void {
  const registryPath = options.registryPath ?? defaultRegistryPath()
  const current = readRegistryFile(registryPath)
  // Remove any stale entry with the same pid+terminalId so re-registration
  // does not leave duplicates.
  const filtered = current.entries.filter(
    (e) => !(e.pid === entry.pid && e.terminalId === entry.terminalId)
  )
  filtered.push(entry)
  // Cap at 16 entries per RW-R2; oldest first out when over cap.
  while (filtered.length > 16) {
    filtered.shift()
  }
  writeRegistryFile(registryPath, { version: 1, entries: filtered })
}

export function unregisterHookListener(
  pid: number,
  terminalId: string,
  options: RegistryOptions = {}
): void {
  const registryPath = options.registryPath ?? defaultRegistryPath()
  const current = readRegistryFile(registryPath)
  const filtered = current.entries.filter(
    (e) => !(e.pid === pid && e.terminalId === terminalId)
  )
  if (filtered.length === current.entries.length) {
    return
  }
  if (filtered.length === 0) {
    try {
      fs.unlinkSync(registryPath)
    } catch {
      // best effort
    }
    return
  }
  writeRegistryFile(registryPath, { version: 1, entries: filtered })
}

/**
 * Read the registry, filter out entries whose pid is no longer alive.
 * Does NOT mutate the registry file itself (readers stay pure). Cleanup
 * of dead entries happens lazily on the next register/unregister call.
 */
export function listActiveListeners(options: RegistryOptions = {}): HookRegistryEntry[] {
  const registryPath = options.registryPath ?? defaultRegistryPath()
  const current = readRegistryFile(registryPath)
  return current.entries.filter((entry) => isPidAlive(entry.pid))
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException
    // EPERM means the pid exists but we do not have permission to signal.
    return err.code === 'EPERM'
  }
}
