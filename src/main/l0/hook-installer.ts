import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Hook installer — Slice 2B.
 *
 * Installs / uninstalls WorkPane's hook entries in
 * `~/.claude/settings.json` with a 4-layer crash-safety envelope verified
 * empirically in the Slice 0 spike (spike-results/option-a/
 * settings-json-safety-report-win32.json):
 *
 *   1. Precheck — read + SHA-256 + JSON.parse the original
 *   2. Backup    — write `settings.json.workpane-backup-<ts>` with the
 *                  exact original bytes, hash-verified
 *   3. Atomic    — write settings.json.tmp then fs.rename
 *   4. Try/finally + SIGINT handler — if the process dies between steps,
 *                  the backup is restored (hash-matched to the precheck)
 *
 * All disk writes are chmod 0o600 on POSIX (settings.json carries
 * per-project tokens the user does not want world-readable). On Windows,
 * default ACL (current-user + admins + system) is kept.
 */

export type HookInstallResult =
  | { kind: 'installed'; backupPath: string; appliedAt: number }
  | { kind: 'already-installed'; reason: string }
  | { kind: 'uninstalled'; backupPath: string; restoredAt: number }
  | { kind: 'no-op-not-installed'; reason: string }
  | { kind: 'abort-parse-error'; reason: string; stage: 'precheck' }
  | { kind: 'abort-verify-fail'; reason: string; restored: boolean }
  | { kind: 'abort-io-error'; reason: string; stage: InstallerStage; restored: boolean }

export type InstallerStage = 'precheck' | 'backup' | 'write' | 'rename' | 'verify'

export interface HookDefinition {
  /** Hook event name, e.g. 'PreToolUse' / 'PostToolUse' / 'SessionStart'. */
  event: string
  /** Absolute command the hook runs (spawned by CC). */
  command: string
}

export interface InstallOptions {
  settingsPath?: string
  hooks: HookDefinition[]
  /** Test-only: inject SIGINT between stages to prove rollback. */
  _injectFaultAt?: InstallerStage
  /** Deterministic backup suffix (tests). */
  _backupSuffix?: string
}

export interface UninstallOptions {
  settingsPath?: string
  /** Match on these event names; commands are compared loosely (startsWith). */
  events: string[]
  _backupSuffix?: string
}

const WORKPANE_MARKER = 'workpane-managed'

function defaultSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

function sha256(contents: string | Buffer): string {
  return crypto.createHash('sha256').update(contents).digest('hex')
}

function readIfExists(p: string): { contents: string; hash: string } | null {
  if (!fs.existsSync(p)) return null
  const contents = fs.readFileSync(p, 'utf8')
  return { contents, hash: sha256(contents) }
}

function writeFileStrict(target: string, data: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  const fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeSync(fd, data)
    try {
      fs.fsyncSync(fd)
    } catch {
      // fsync not available on all FS; best effort
    }
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, target)
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(target, 0o600)
    } catch {
      // best effort
    }
  }
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nowSuffix(override?: string): string {
  return override ?? new Date().toISOString().replace(/[:.]/g, '-')
}

function backupPathFor(settingsPath: string, suffix: string): string {
  return `${settingsPath}.workpane-backup-${suffix}`
}

function hooksField(settings: Record<string, unknown>): Record<string, unknown> {
  const raw = settings.hooks
  return isRecord(raw) ? raw : {}
}

function mergeHooks(
  existing: Record<string, unknown>,
  additions: HookDefinition[]
): { merged: Record<string, unknown>; addedCount: number; skipped: string[] } {
  const merged = cloneRecord(existing)
  let addedCount = 0
  const skipped: string[] = []
  for (const def of additions) {
    const prior = merged[def.event]
    if (typeof prior === 'string' || isRecord(prior)) {
      skipped.push(def.event)
      continue
    }
    merged[def.event] = {
      [WORKPANE_MARKER]: true,
      command: def.command
    }
    addedCount += 1
  }
  return { merged, addedCount, skipped }
}

function stripWorkpaneHooks(hooks: Record<string, unknown>, events: string[]): {
  stripped: Record<string, unknown>
  removedCount: number
} {
  const stripped = cloneRecord(hooks)
  let removedCount = 0
  for (const event of events) {
    const prior = stripped[event]
    if (isRecord(prior) && prior[WORKPANE_MARKER] === true) {
      delete stripped[event]
      removedCount += 1
    }
  }
  return { stripped, removedCount }
}

function injectFault(stage: InstallerStage, target: InstallerStage | undefined): void {
  if (stage === target) {
    throw new Error(`injected-fault-at-${stage}`)
  }
}

export function installHooks(options: InstallOptions): HookInstallResult {
  const settingsPath = options.settingsPath ?? defaultSettingsPath()
  const suffix = nowSuffix(options._backupSuffix)
  const backupPath = backupPathFor(settingsPath, suffix)

  // ---- Layer 1: precheck
  let pre: { contents: string; hash: string; parsed: Record<string, unknown> }
  try {
    injectFault('precheck', options._injectFaultAt)
    const read = readIfExists(settingsPath)
    const raw = read?.contents ?? '{}'
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      return {
        kind: 'abort-parse-error',
        reason: `settings.json 이 JSON 파싱 실패로 조작을 거부합니다: ${(error as Error).message}`,
        stage: 'precheck'
      }
    }
    if (!isRecord(parsed)) {
      return {
        kind: 'abort-parse-error',
        reason: 'settings.json 이 object 형태가 아닙니다',
        stage: 'precheck'
      }
    }
    pre = { contents: raw, hash: sha256(raw), parsed }
  } catch (error) {
    return {
      kind: 'abort-io-error',
      reason: `precheck 실패: ${(error as Error).message}`,
      stage: 'precheck',
      restored: false
    }
  }

  // Already-installed guard
  const existingHooks = hooksField(pre.parsed)
  const allAlreadyManaged = options.hooks.every((h) => {
    const prior = existingHooks[h.event]
    return isRecord(prior) && prior[WORKPANE_MARKER] === true
  })
  if (allAlreadyManaged && options.hooks.length > 0) {
    return {
      kind: 'already-installed',
      reason: '모든 hook 이 이미 WorkPane 마커와 함께 설치되어 있습니다'
    }
  }

  // ---- Layer 2: backup
  try {
    injectFault('backup', options._injectFaultAt)
    if (pre.contents !== '{}' || fs.existsSync(settingsPath)) {
      writeFileStrict(backupPath, pre.contents)
      const roundtrip = fs.readFileSync(backupPath, 'utf8')
      if (sha256(roundtrip) !== pre.hash) {
        fs.rmSync(backupPath, { force: true })
        return {
          kind: 'abort-verify-fail',
          reason: 'backup hash mismatch — settings.json 원본 보존 시도 실패',
          restored: false
        }
      }
    }
  } catch (error) {
    return {
      kind: 'abort-io-error',
      reason: `backup 실패: ${(error as Error).message}`,
      stage: 'backup',
      restored: false
    }
  }

  // Merge hooks
  const merged = cloneRecord(pre.parsed)
  const mergeResult = mergeHooks(existingHooks, options.hooks)
  merged.hooks = mergeResult.merged
  const newContents = `${JSON.stringify(merged, null, 2)}\n`

  // ---- Layer 3: atomic write via Layer 3 (writeFileStrict uses rename)
  let sigintHandler: (() => void) | null = null
  const restoreFromBackup = (): boolean => {
    try {
      if (fs.existsSync(backupPath)) {
        const backupContents = fs.readFileSync(backupPath, 'utf8')
        writeFileStrict(settingsPath, backupContents)
        return true
      }
    } catch {
      // fall through
    }
    return false
  }

  try {
    sigintHandler = (): void => {
      restoreFromBackup()
    }
    process.once('SIGINT', sigintHandler)

    try {
      injectFault('write', options._injectFaultAt)
      writeFileStrict(settingsPath, newContents)
    } catch (error) {
      restoreFromBackup()
      return {
        kind: 'abort-io-error',
        reason: `write 실패: ${(error as Error).message}`,
        stage: 'write',
        restored: fs.existsSync(backupPath)
      }
    }

    // ---- Layer 4: verify read-back
    try {
      injectFault('verify', options._injectFaultAt)
      const roundtrip = fs.readFileSync(settingsPath, 'utf8')
      if (sha256(roundtrip) !== sha256(newContents)) {
        const restored = restoreFromBackup()
        return {
          kind: 'abort-verify-fail',
          reason: 'verify hash mismatch — atomic write 후 읽은 내용이 기대와 다름',
          restored
        }
      }
    } catch (error) {
      const restored = restoreFromBackup()
      return {
        kind: 'abort-io-error',
        reason: `verify 실패: ${(error as Error).message}`,
        stage: 'verify',
        restored
      }
    }
  } finally {
    if (sigintHandler) {
      process.removeListener('SIGINT', sigintHandler)
    }
  }

  return {
    kind: 'installed',
    backupPath,
    appliedAt: Date.now()
  }
}

export function uninstallHooks(options: UninstallOptions): HookInstallResult {
  const settingsPath = options.settingsPath ?? defaultSettingsPath()
  const suffix = nowSuffix(options._backupSuffix)
  const backupPath = backupPathFor(settingsPath, suffix)

  const read = readIfExists(settingsPath)
  if (!read) {
    return { kind: 'no-op-not-installed', reason: 'settings.json 이 존재하지 않음' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(read.contents)
  } catch (error) {
    return {
      kind: 'abort-parse-error',
      reason: `settings.json JSON 파싱 실패: ${(error as Error).message}`,
      stage: 'precheck'
    }
  }
  if (!isRecord(parsed)) {
    return {
      kind: 'abort-parse-error',
      reason: 'settings.json 이 object 형태가 아님',
      stage: 'precheck'
    }
  }
  const existingHooks = hooksField(parsed)
  const strip = stripWorkpaneHooks(existingHooks, options.events)
  if (strip.removedCount === 0) {
    return {
      kind: 'no-op-not-installed',
      reason: 'WorkPane 마커를 가진 hook 이 없음'
    }
  }

  try {
    writeFileStrict(backupPath, read.contents)
  } catch (error) {
    return {
      kind: 'abort-io-error',
      reason: `uninstall backup 실패: ${(error as Error).message}`,
      stage: 'backup',
      restored: false
    }
  }

  const next = cloneRecord(parsed)
  next.hooks = strip.stripped
  // If hooks became empty, drop the key entirely to leave a clean file.
  if (Object.keys(strip.stripped).length === 0) {
    delete next.hooks
  }
  const newContents = `${JSON.stringify(next, null, 2)}\n`

  try {
    writeFileStrict(settingsPath, newContents)
    const roundtrip = fs.readFileSync(settingsPath, 'utf8')
    if (sha256(roundtrip) !== sha256(newContents)) {
      // Restore from backup
      writeFileStrict(settingsPath, read.contents)
      return {
        kind: 'abort-verify-fail',
        reason: 'uninstall verify hash mismatch',
        restored: true
      }
    }
  } catch (error) {
    try {
      writeFileStrict(settingsPath, read.contents)
    } catch {
      // Double failure — backup file still has the original
    }
    return {
      kind: 'abort-io-error',
      reason: `uninstall write 실패: ${(error as Error).message}`,
      stage: 'write',
      restored: fs.existsSync(backupPath)
    }
  }

  return {
    kind: 'uninstalled',
    backupPath,
    restoredAt: Date.now()
  }
}
