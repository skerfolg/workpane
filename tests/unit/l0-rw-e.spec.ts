import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { L0Orchestrator } from '../../src/main/l0/l0-orchestrator'

/**
 * RW-E — evidence-guarded stale check. Downgrade must only happen when
 * a hook went silent AND the session log shows recent tool_use activity
 * for the same terminal. Idle users stay on L0-A.
 */

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'l0-rw-e-'))
}

function installedSettings(dir: string): string {
  const p = path.join(dir, 'settings.json')
  fs.writeFileSync(p, JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: '/wp', 'workpane-managed': true }]
        }
      ]
    }
  }))
  return p
}

const ccSupported = {
  kind: 'supported' as const,
  status: 'supported' as const,
  reason: 'ok',
  version: { major: 2, minor: 1, patch: 119, raw: '2.1.119' }
}

test('runStaleCheck — no terminals observed returns empty list', async () => {
  const orch = new L0Orchestrator()
  const demoted = await orch.runStaleCheck()
  assert.deepEqual(demoted, [])
})

test('runStaleCheck — silence without session-log evidence does NOT downgrade', async () => {
  const dir = scratchDir()
  try {
    const settings = installedSettings(dir)
    const orch = new L0Orchestrator()
    orch.bindTerminal({ terminalId: 't1', cwd: dir, settingsPathOverride: settings, ccResultOverride: ccSupported })
    orch.markHookObserved('t1', 0) // very old last-hook
    await orch.refresh({ terminalId: 't1', ccResultOverride: ccSupported })
    assert.equal(orch.getSnapshotFor('t1')?.decision.selected, 'L0-A')

    const demoted = await orch.runStaleCheck(60_001, 60_000)
    assert.deepEqual(demoted, [], 'no session-log evidence → no downgrade')
    assert.equal(orch.getSnapshotFor('t1')?.decision.selected, 'L0-A')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runStaleCheck — silence + session-log tool_use after lastHookAt → downgrade', async () => {
  const dir = scratchDir()
  try {
    const settings = installedSettings(dir)
    const orch = new L0Orchestrator()
    orch.bindTerminal({ terminalId: 't1', cwd: dir, settingsPathOverride: settings, ccResultOverride: ccSupported })
    orch.markHookObserved('t1', 0)
    await orch.refresh({ terminalId: 't1', ccResultOverride: ccSupported })
    assert.equal(orch.getSnapshotFor('t1')?.decision.selected, 'L0-A')

    // Session-log saw tool_use AFTER the hook fell silent
    orch.observeSessionLogToolUse('t1', 30_000)

    const demoted = await orch.runStaleCheck(65_000, 60_000)
    assert.deepEqual(demoted, ['t1'])
    const after = orch.getSnapshotFor('t1')
    assert.ok(after, 'snapshot refreshed after demotion')
    assert.equal(after.state.hook_fires, false)
    // With installed marker but hook_fires=false the selector picks E.
    assert.equal(after.decision.selected, 'L0-E')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runStaleCheck — session-log tool_use BEFORE last hook does not trigger downgrade', async () => {
  const dir = scratchDir()
  try {
    const settings = installedSettings(dir)
    const orch = new L0Orchestrator()
    orch.bindTerminal({ terminalId: 't1', cwd: dir, settingsPathOverride: settings, ccResultOverride: ccSupported })
    orch.observeSessionLogToolUse('t1', 10_000) // early
    orch.markHookObserved('t1', 20_000) // hook later
    await orch.refresh({ terminalId: 't1', ccResultOverride: ccSupported })

    const demoted = await orch.runStaleCheck(90_000, 60_000)
    assert.deepEqual(demoted, [], 'session-log evidence predates hook — no evidence of stale hook')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('markHookObserved — subsequent observation reverts a prior downgrade when refresh is called', async () => {
  const dir = scratchDir()
  try {
    const settings = installedSettings(dir)
    const orch = new L0Orchestrator()
    orch.bindTerminal({ terminalId: 't1', cwd: dir, settingsPathOverride: settings, ccResultOverride: ccSupported })
    orch.markHookObserved('t1', 0)
    orch.observeSessionLogToolUse('t1', 30_000)
    await orch.runStaleCheck(65_000, 60_000)
    assert.equal(orch.getSnapshotFor('t1')?.decision.selected, 'L0-E')

    // Hook fires again
    orch.markHookObserved('t1', 100_000)
    await orch.refresh({ terminalId: 't1', ccResultOverride: ccSupported })
    assert.equal(orch.getSnapshotFor('t1')?.decision.selected, 'L0-A')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('startStaleCheck / stopStaleCheck — timer lifecycle idempotent', () => {
  const orch = new L0Orchestrator()
  orch.startStaleCheck(60_000)
  orch.startStaleCheck(60_000) // idempotent
  orch.stopStaleCheck()
  orch.stopStaleCheck() // idempotent
  orch.dispose()
})

test('unbindTerminal clears both lastHookAt and lastSessionLogToolUseAt entries', async () => {
  const dir = scratchDir()
  try {
    const settings = installedSettings(dir)
    const orch = new L0Orchestrator()
    orch.bindTerminal({ terminalId: 't1', cwd: dir, settingsPathOverride: settings, ccResultOverride: ccSupported })
    orch.markHookObserved('t1', 100)
    orch.observeSessionLogToolUse('t1', 200)
    await orch.refresh({ terminalId: 't1', ccResultOverride: ccSupported })

    orch.unbindTerminal('t1')
    // Re-bind + refresh should not see the old timestamps triggering a downgrade
    orch.bindTerminal({ terminalId: 't1', cwd: dir, settingsPathOverride: settings, ccResultOverride: ccSupported })
    orch.markHookObserved('t1', 500_000)
    await orch.refresh({ terminalId: 't1', ccResultOverride: ccSupported })
    const demoted = await orch.runStaleCheck(500_001, 60_000)
    assert.deepEqual(demoted, [], 'unbind cleared prior session-log evidence that would otherwise still be newer than 0')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
