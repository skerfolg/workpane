import { detectCcVersion, type CcDetectionResult } from './cc-version-detector'
import {
  pickSupervisionPath,
  type L0PathDecision,
  type L0PathSelectorState
} from './l0-path-selector'
import { findMatchingProjectDir, resolveProjectsDir } from './session-log-locator'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

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
}

export interface ProbeCapabilitiesOptions {
  /** cwd used to locate the CC per-project jsonl directory. */
  cwd?: string
  /** Override settings path for tests. */
  settingsPathOverride?: string
  /** Override the CC detection result for tests. */
  ccResultOverride?: CcDetectionResult
}

const WORKPANE_MARKER = 'workpane-managed'

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
    if (isRecord(value) && value[WORKPANE_MARKER] === true) {
      return { installed: true, reason: 'found workpane-managed hook entry' }
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
  // hook_fires is a runtime observation (requires listener). Until the
  // wiring branch in Slice 2 Phase 2B lands, we optimistically treat
  // hook_fires as equal to hook_installed so the selector can upgrade to
  // L0-A once install succeeds. The path heartbeat (Plan v3 scenario 5)
  // will downgrade if firing stops.
  const hookFires = hookInstalled

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
    probedAt: Date.now()
  }
}

export class L0Orchestrator {
  private latest: L0PathSnapshot | null = null
  private readonly listeners = new Set<(snapshot: L0PathSnapshot) => void>()

  getSnapshot(): L0PathSnapshot | null {
    return this.latest
  }

  async refresh(options: ProbeCapabilitiesOptions = {}): Promise<L0PathSnapshot> {
    const snapshot = await probeCapabilities(options)
    this.latest = snapshot
    for (const listener of this.listeners) {
      listener(snapshot)
    }
    return snapshot
  }

  onChange(listener: (snapshot: L0PathSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.listeners.clear()
    this.latest = null
  }
}
