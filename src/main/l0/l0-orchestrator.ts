import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { detectCcVersion, type CcDetectionResult } from './cc-version-detector'
import { WORKPANE_MARKER } from './hook-installer'
import {
  pickSupervisionPath,
  type L0PathDecision,
  type L0PathSelectorState
} from './l0-path-selector'
import { findMatchingProjectDir, resolveProjectsDir } from './session-log-locator'

/**
 * L0 orchestrator — Slice 2E.
 *
 * Single source of truth for "which L0 supervision path is active right
 * now". Collects the capability signals that path selector needs and
 * re-computes the decision on demand.
 *
 * Scope for Slice 2E: capability probe + decision + snapshot exposure.
 * Actual adapter swap at runtime (HookServer listen / SessionLogTailer
 * watch / pipeline adapter replace) is wired in a follow-up because it
 * touches terminal-manager's ingest loop and has higher regression risk.
 * The current L1 + stdout baseline keeps running untouched.
 */

export interface L0PathSnapshot {
  decision: L0PathDecision
  state: L0PathSelectorState
  cc: CcDetectionResult
  /**
   * Present when Option E could at least locate the CC projects dir.
   * Absent when CC is not installed or projects dir is missing.
   */
  sessionLogProjectDir?: string
  probedAt: number
  /**
   * RW-A: non-null when this snapshot describes a single terminal's
   * decision. `null` for the "global default" snapshot produced by
   * unbound refresh() calls that consult process.cwd() instead of a
   * real terminal binding.
   */
  terminalId: string | null
}

export interface ProbeCapabilitiesOptions {
  /** cwd used to locate the CC per-project jsonl directory. */
  cwd?: string
  /** Override settings path for tests. */
  settingsPathOverride?: string
  /** Override the CC detection result for tests. */
  ccResultOverride?: CcDetectionResult
  /** RW-A: when set, the returned snapshot is tagged with this terminalId. */
  terminalId?: string | null
  /** RW-E forward-compat: whether hook has observed a payload for this terminal. */
  hookFiresObserved?: boolean
}

function defaultSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Inspect ~/.claude/settings.json to see if any hook entry carries the
 * WorkPane marker. This is the "hook_installed" signal; whether it fires
 * is a runtime concern (not covered here, handled in Slice 2 Phase 2B).
 */
export function detectHookInstallStatus(settingsPath: string): {
  installed: boolean
  reason: string
} {
  if (!fs.existsSync(settingsPath)) {
    return { installed: false, reason: 'settings.json missing' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch (error) {
    return {
      installed: false,
      reason: `settings.json parse failure: ${(error as Error).message}`
    }
  }
  if (!isRecord(parsed)) {
    return { installed: false, reason: 'settings.json is not an object' }
  }
  const hooks = parsed.hooks
  if (!isRecord(hooks)) {
    return { installed: false, reason: 'no hooks field' }
  }
  for (const value of Object.values(hooks)) {
    // Canonical CC array form: [{matcher, hooks: [{type,command,workpane-managed}]}]
    if (Array.isArray(value)) {
      const hit = value.some((entry) => {
        if (!isRecord(entry)) return false
        const inner = entry.hooks
        if (!Array.isArray(inner)) return false
        return inner.some(
          (h) => isRecord(h) && h[WORKPANE_MARKER] === true
        )
      })
      if (hit) {
        return { installed: true, reason: 'found workpane-managed hook entry (array form)' }
      }
    }
    // Legacy buggy form: {workpane-managed: true, command: ...} — pre-fix install.
    if (isRecord(value) && value[WORKPANE_MARKER] === true) {
      return {
        installed: true,
        reason: 'found legacy workpane-managed hook entry — re-install will migrate'
      }
    }
  }
  return { installed: false, reason: 'no workpane-managed hook entry' }
}

/**
 * Capability probe — asynchronous because CC version detection spawns a
 * subprocess. All other signals are synchronous file lookups.
 */
export async function probeCapabilities(
  options: ProbeCapabilitiesOptions = {}
): Promise<L0PathSnapshot> {
  const cwd = options.cwd ?? process.cwd()
  const settingsPath = options.settingsPathOverride ?? defaultSettingsPath()
  const cc = options.ccResultOverride ?? (await detectCcVersion({ timeoutMs: 5_000 }))

  const hook = detectHookInstallStatus(settingsPath)
  const hookInstalled = cc.kind === 'supported' && hook.installed
  // RW-E: prefer the observed-from-payload flag when the orchestrator
  // has already seen a real hook fire for this terminal. Falls back to
  // `hookInstalled` only when no runtime observation exists yet, at
  // which point the stale-check tick will flip it once a payload
  // actually arrives.
  const hookFires = options.hookFiresObserved ?? hookInstalled

  const projectsDir = resolveProjectsDir()
  const match = projectsDir ? findMatchingProjectDir(projectsDir, cwd) : null
  const sessionLogAccessible = match !== null

  const state: L0PathSelectorState = {
    hook_installed: hookInstalled,
    hook_fires: hookFires,
    session_log_accessible: sessionLogAccessible,
    // We do not measure latency at probe time; leave null so the selector
    // reports "medium (latency null ms)" which downstream UI can annotate.
    session_log_latency_p95_ms: null,
    regex_pipeline_available: true
  }

  return {
    decision: pickSupervisionPath(state),
    state,
    cc,
    sessionLogProjectDir: match?.path,
    probedAt: Date.now(),
    terminalId: options.terminalId ?? null
  }
}

export interface TerminalBinding {
  terminalId: string
  cwd: string
  /** Settings path override (tests). */
  settingsPathOverride?: string
  /** Test-only: pin CC detection so internal refreshes skip the spawn. */
  ccResultOverride?: CcDetectionResult
}

export class L0Orchestrator {
  /** Global snapshot (no terminal binding). Used by Settings summary. */
  private latest: L0PathSnapshot | null = null
  /** RW-A: per-terminal snapshots keyed by terminalId. */
  private readonly perTerminal = new Map<string, L0PathSnapshot>()
  /** RW-A: binding metadata so bindTerminal-refresh does not require caller state. */
  private readonly bindings = new Map<string, TerminalBinding>()
  /** RW-E forward: terminals that observed at least one real hook payload. */
  private readonly hookObservedTerminals = new Set<string>()
  /**
   * RW-E: explicit hook_fires override per terminal. Set to false after
   * an evidence-guarded stale downgrade so subsequent refreshes keep the
   * terminal on L0-E even though settings.json still shows the hook
   * marker. Cleared when markHookObserved fires again.
   */
  private readonly hookFiresOverride = new Map<string, boolean>()
  /** RW-E: timestamp of last hook payload per terminal. */
  private readonly lastHookAt = new Map<string, number>()
  /** RW-E: timestamp of last session-log tool_use observed per terminal. */
  private readonly lastSessionLogToolUseAt = new Map<string, number>()
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null
  private readonly listeners = new Set<(snapshot: L0PathSnapshot) => void>()

  getSnapshot(): L0PathSnapshot | null {
    return this.latest
  }

  /** RW-A: expose the per-terminal snapshot without triggering a refresh. */
  getSnapshotFor(terminalId: string): L0PathSnapshot | null {
    return this.perTerminal.get(terminalId) ?? null
  }

  /** RW-A: iterate all active per-terminal snapshots. */
  listPerTerminalSnapshots(): L0PathSnapshot[] {
    return Array.from(this.perTerminal.values())
  }

  /** RW-A: register a terminal so future refresh(terminalId) picks up its cwd. */
  bindTerminal(binding: TerminalBinding): void {
    this.bindings.set(binding.terminalId, binding)
  }

  /** RW-A: drop a terminal binding and its cached snapshot. */
  unbindTerminal(terminalId: string): void {
    this.bindings.delete(terminalId)
    this.perTerminal.delete(terminalId)
    this.hookObservedTerminals.delete(terminalId)
    this.hookFiresOverride.delete(terminalId)
    this.lastHookAt.delete(terminalId)
    this.lastSessionLogToolUseAt.delete(terminalId)
  }

  /** RW-E: mark a terminal's hook as having fired + timestamp for stale check. */
  markHookObserved(terminalId: string, at: number = Date.now()): void {
    this.hookObservedTerminals.add(terminalId)
    this.lastHookAt.set(terminalId, at)
    // Clear any prior stale-downgrade override so the next refresh
    // recognizes the hook as healthy again.
    this.hookFiresOverride.delete(terminalId)
  }

  /** RW-E: clear the observed flag — selector re-evaluates on next refresh. */
  clearHookObserved(terminalId: string): void {
    this.hookObservedTerminals.delete(terminalId)
  }

  /** RW-E: session-log tool_use arrived. Used to evidence-guard the stale downgrade. */
  observeSessionLogToolUse(terminalId: string, at: number = Date.now()): void {
    this.lastSessionLogToolUseAt.set(terminalId, at)
  }

  /**
   * RW-E: evaluate every bound terminal for stale-hook downgrades.
   *
   * A downgrade fires only when BOTH conditions hold:
   *   - last hook payload was > thresholdMs ago (default 60s), AND
   *   - a session-log tool_use was observed AFTER the last hook payload
   *     (i.e. there is positive evidence of activity the hook missed).
   *
   * Pure silence keeps the selector stable; this avoids the naive
   * "60s of no hook = downgrade" trap where an idle user would get
   * demoted to L0-E even though the hook is healthy.
   */
  async runStaleCheck(now: number = Date.now(), thresholdMs: number = 60_000): Promise<string[]> {
    const demoted: string[] = []
    for (const terminalId of this.hookObservedTerminals) {
      const lastHook = this.lastHookAt.get(terminalId) ?? 0
      if (now - lastHook <= thresholdMs) {
        continue
      }
      const lastSessionToolUse = this.lastSessionLogToolUseAt.get(terminalId) ?? 0
      if (lastSessionToolUse <= lastHook) {
        continue
      }
      this.hookObservedTerminals.delete(terminalId)
      // Pin the negative signal so subsequent refresh() calls do not
      // optimistically reassert hook_fires from the hookInstalled
      // fallback. The override clears on the next markHookObserved.
      this.hookFiresOverride.set(terminalId, false)
      demoted.push(terminalId)
    }
    if (demoted.length === 0) {
      return []
    }
    await Promise.all(demoted.map((id) => this.refresh({ terminalId: id })))
    return demoted
  }

  /** RW-E: start a periodic stale-check tick. Idempotent. */
  startStaleCheck(intervalMs: number = 20_000): void {
    if (this.staleCheckTimer) return
    this.staleCheckTimer = setInterval(() => {
      void this.runStaleCheck().catch(() => undefined)
    }, intervalMs)
    // Let the process exit even if the timer is still scheduled.
    if (typeof this.staleCheckTimer.unref === 'function') {
      this.staleCheckTimer.unref()
    }
  }

  /** RW-E: stop the periodic stale-check tick. */
  stopStaleCheck(): void {
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer)
      this.staleCheckTimer = null
    }
  }

  /**
   * Refresh either the global snapshot (no terminalId in options or
   * binding) or the per-terminal snapshot for the given terminalId.
   * Listeners always receive the produced snapshot so UI can react to
   * either kind.
   */
  async refresh(options: ProbeCapabilitiesOptions = {}): Promise<L0PathSnapshot> {
    const terminalId = options.terminalId ?? null
    let mergedOptions: ProbeCapabilitiesOptions = options

    if (terminalId) {
      const binding = this.bindings.get(terminalId)
      const merged: ProbeCapabilitiesOptions = {
        ...options,
        cwd: options.cwd ?? binding?.cwd,
        settingsPathOverride: options.settingsPathOverride ?? binding?.settingsPathOverride,
        ccResultOverride: options.ccResultOverride ?? binding?.ccResultOverride
      }
      // Only set hookFiresObserved when the caller explicitly provided
      // it or when we have positive evidence. Leaving the field
      // undefined lets probeCapabilities fall back to `hookInstalled`
      // so a freshly bound terminal does not flip to false before any
      // evidence exists (RW-A regression: test expected optimistic
      // upgrade when marker is present and no observation yet).
      if (options.hookFiresObserved !== undefined) {
        merged.hookFiresObserved = options.hookFiresObserved
      } else if (this.hookFiresOverride.has(terminalId)) {
        // Map values are always boolean by construction; the `?? false`
        // keeps the type narrow without a non-null assertion.
        merged.hookFiresObserved = this.hookFiresOverride.get(terminalId) ?? false
      } else if (this.hookObservedTerminals.has(terminalId)) {
        merged.hookFiresObserved = true
      }
      mergedOptions = merged
    }

    const snapshot = await probeCapabilities(mergedOptions)
    if (terminalId) {
      this.perTerminal.set(terminalId, snapshot)
    } else {
      this.latest = snapshot
    }
    for (const listener of this.listeners) {
      listener(snapshot)
    }
    return snapshot
  }

  /**
   * RW-A: refresh every bound terminal in parallel. Useful after
   * global-scope state changes (CC install/uninstall, settings.json edits).
   */
  async refreshAllTerminals(): Promise<L0PathSnapshot[]> {
    const ids = Array.from(this.bindings.keys())
    return Promise.all(ids.map((id) => this.refresh({ terminalId: id })))
  }

  onChange(listener: (snapshot: L0PathSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.stopStaleCheck()
    this.listeners.clear()
    this.latest = null
    this.perTerminal.clear()
    this.bindings.clear()
    this.hookObservedTerminals.clear()
    this.hookFiresOverride.clear()
    this.lastHookAt.clear()
    this.lastSessionLogToolUseAt.clear()
  }
}
