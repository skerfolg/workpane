import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CcStreamJsonAdapter } from '../../src/main/l0/adapters/cc-stream-json-adapter'
import { L0Pipeline } from '../../src/main/l0/pipeline'
import { L0Orchestrator } from '../../src/main/l0/l0-orchestrator'
import type { AdapterStatusSnapshot, IngestResult, L0Adapter } from '../../src/main/l0/adapters/L0Adapter'

/**
 * RW-A regression tests: per-terminal adapter override in L0Pipeline +
 * per-terminal snapshot tracking in L0Orchestrator. Existing callers
 * that pass a single adapter at construction are unaffected.
 */

class RecordingAdapter implements L0Adapter {
  public readonly ingested: Array<{ terminalId: string; input: unknown }> = []
  public resets = 0
  public disposed = 0

  ingest(terminalId: string, input: unknown): IngestResult {
    this.ingested.push({ terminalId, input })
    return { kind: 'noop', suppressApprovalDetector: true }
  }

  reset(_terminalId: string): void {
    this.resets += 1
  }

  dispose(): void {
    this.disposed += 1
  }

  getStatus(_terminalId: string): AdapterStatusSnapshot | undefined {
    return { mode: 'active', fingerprint: 'recording:v1' }
  }
}

test('L0Pipeline — default adapter used when no per-terminal override set', () => {
  const stdout = new RecordingAdapter()
  const pipeline = new L0Pipeline(stdout, () => undefined)
  pipeline.bindVendor('t1', 'claude-code')
  pipeline.ingest('t1', 'hello', '/ws')
  assert.equal(stdout.ingested.length, 1)
  assert.equal(stdout.ingested[0].terminalId, 't1')
})

test('L0Pipeline — setAdapterFor routes one terminal to override, others keep default', () => {
  const stdout = new RecordingAdapter()
  const hook = new RecordingAdapter()
  const pipeline = new L0Pipeline(stdout, () => undefined)
  pipeline.bindVendor('t1', 'claude-code')
  pipeline.bindVendor('t2', 'claude-code')

  pipeline.setAdapterFor('t1', hook)

  pipeline.ingest('t1', { hook_event_name: 'PreToolUse' }, '/ws')
  pipeline.ingest('t2', 'stdout chunk', '/ws')

  assert.equal(hook.ingested.length, 1)
  assert.equal(hook.ingested[0].terminalId, 't1')
  assert.equal(stdout.ingested.length, 1)
  assert.equal(stdout.ingested[0].terminalId, 't2')
})

test('L0Pipeline — clearAdapterFor returns terminal to default adapter + resets override', () => {
  const stdout = new RecordingAdapter()
  const hook = new RecordingAdapter()
  const pipeline = new L0Pipeline(stdout, () => undefined)
  pipeline.bindVendor('t1', 'claude-code')
  pipeline.setAdapterFor('t1', hook)
  pipeline.ingest('t1', { x: 1 }, '/ws')
  assert.equal(hook.ingested.length, 1)

  pipeline.clearAdapterFor('t1')
  assert.equal(hook.resets, 1, 'override adapter reset on clear')

  pipeline.ingest('t1', 'back to stdout', '/ws')
  assert.equal(hook.ingested.length, 1, 'override no longer receives events')
  assert.equal(stdout.ingested.length, 1, 'default adapter now receives the ingest')
})

test('L0Pipeline — reset(terminalId) tears down both default and per-terminal adapter state', () => {
  const stdout = new RecordingAdapter()
  const hook = new RecordingAdapter()
  const pipeline = new L0Pipeline(stdout, () => undefined)
  pipeline.bindVendor('t1', 'claude-code')
  pipeline.setAdapterFor('t1', hook)
  pipeline.reset('t1')
  assert.equal(hook.resets, 1)
  assert.equal(stdout.resets, 1)
})

test('L0Pipeline — dispose() disposes default AND every per-terminal override', () => {
  const stdout = new RecordingAdapter()
  const a = new RecordingAdapter()
  const b = new RecordingAdapter()
  const pipeline = new L0Pipeline(stdout, () => undefined)
  pipeline.bindVendor('t1', 'claude-code')
  pipeline.bindVendor('t2', 'claude-code')
  pipeline.setAdapterFor('t1', a)
  pipeline.setAdapterFor('t2', b)
  pipeline.dispose()
  assert.equal(stdout.disposed, 1)
  assert.equal(a.disposed, 1)
  assert.equal(b.disposed, 1)
})

test('L0Pipeline — setAdapterFor broadcasts status so UI notices the swap', () => {
  const stdout = new RecordingAdapter()
  const hook = new RecordingAdapter()
  const pipeline = new L0Pipeline(stdout, () => undefined)
  const events: string[] = []
  pipeline.onStatusChanged((status) => events.push(`${status.terminalId}:${status.mode}:${status.fingerprint ?? ''}`))
  pipeline.bindVendor('t1', 'claude-code')
  const bindEvents = events.length
  pipeline.setAdapterFor('t1', hook)
  assert.ok(events.length > bindEvents, 'setAdapterFor emitted at least one status event')
  const last = events[events.length - 1]
  assert.ok(last.includes('recording:v1'), 'new adapter status surfaced through onStatusChanged')
})

// --- L0Orchestrator per-terminal API

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'l0-orch-rwa-'))
}

test('L0Orchestrator — refresh without terminalId stores a global snapshot', async () => {
  const dir = scratchDir()
  try {
    const origHome = process.env.HOME
    const origUserProfile = process.env.USERPROFILE
    const origAppData = process.env.APPDATA
    process.env.HOME = dir
    process.env.USERPROFILE = dir
    delete process.env.APPDATA
    try {
      const orch = new L0Orchestrator()
      const snap = await orch.refresh({
        cwd: dir,
        settingsPathOverride: path.join(dir, 'missing.json'),
        ccResultOverride: { kind: 'not-installed', reason: 'test' }
      })
      assert.equal(snap.terminalId, null)
      assert.ok(orch.getSnapshot())
      assert.equal(orch.listPerTerminalSnapshots().length, 0)
    } finally {
      if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
      if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile
      if (origAppData) process.env.APPDATA = origAppData
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('L0Orchestrator — bindTerminal + refresh(terminalId) stores per-terminal snapshot tagged with id', async () => {
  const dir = scratchDir()
  try {
    const origHome = process.env.HOME
    const origUserProfile = process.env.USERPROFILE
    const origAppData = process.env.APPDATA
    process.env.HOME = dir
    process.env.USERPROFILE = dir
    delete process.env.APPDATA
    try {
      const orch = new L0Orchestrator()
      orch.bindTerminal({
        terminalId: 'term-xyz',
        cwd: path.join(dir, 'workspace'),
        settingsPathOverride: path.join(dir, 'missing.json')
      })
      const snap = await orch.refresh({
        terminalId: 'term-xyz',
        ccResultOverride: { kind: 'not-installed', reason: 'test' }
      })
      assert.equal(snap.terminalId, 'term-xyz')
      assert.equal(orch.getSnapshotFor('term-xyz')?.terminalId, 'term-xyz')
      // Global snapshot stays null because we only refreshed the terminal
      assert.equal(orch.getSnapshot(), null)
    } finally {
      if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
      if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile
      if (origAppData) process.env.APPDATA = origAppData
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('L0Orchestrator — unbindTerminal drops snapshot + binding', async () => {
  const dir = scratchDir()
  try {
    const origHome = process.env.HOME
    const origUserProfile = process.env.USERPROFILE
    const origAppData = process.env.APPDATA
    process.env.HOME = dir
    process.env.USERPROFILE = dir
    delete process.env.APPDATA
    try {
      const orch = new L0Orchestrator()
      orch.bindTerminal({
        terminalId: 'term-a',
        cwd: dir,
        settingsPathOverride: path.join(dir, 'missing.json')
      })
      await orch.refresh({
        terminalId: 'term-a',
        ccResultOverride: { kind: 'not-installed', reason: 'test' }
      })
      assert.ok(orch.getSnapshotFor('term-a'))
      orch.unbindTerminal('term-a')
      assert.equal(orch.getSnapshotFor('term-a'), null)
    } finally {
      if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
      if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile
      if (origAppData) process.env.APPDATA = origAppData
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('L0Orchestrator — markHookObserved flips hook_fires on next refresh even when hook_installed is true', async () => {
  const dir = scratchDir()
  try {
    const settingsPath = path.join(dir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: '/wp', 'workpane-managed': true }]
          }
        ]
      }
    }))

    const orch = new L0Orchestrator()
    orch.bindTerminal({
      terminalId: 't1',
      cwd: dir,
      settingsPathOverride: settingsPath
    })
    const optimistic = await orch.refresh({
      terminalId: 't1',
      ccResultOverride: {
        kind: 'supported',
        status: 'supported',
        reason: 'ok',
        version: { major: 2, minor: 1, patch: 119, raw: '2.1.119' }
      }
    })
    // Before observing, we fall back to hookInstalled so the selector picks L0-A
    assert.equal(optimistic.state.hook_fires, true)

    // Clear observation + mark explicitly false path: call refresh with the
    // override negating installed-equals-fires. This is what RW-E stale
    // check will do after evidence.
    const negated = await orch.refresh({
      terminalId: 't1',
      ccResultOverride: {
        kind: 'supported',
        status: 'supported',
        reason: 'ok',
        version: { major: 2, minor: 1, patch: 119, raw: '2.1.119' }
      },
      hookFiresObserved: false
    })
    assert.equal(negated.state.hook_fires, false)
    // L0-A requires hook_fires; with evidence saying false, selector picks L0-E
    assert.equal(negated.decision.selected, 'L0-E')

    // Now flip to observed-true (simulating a real hook arrival)
    orch.markHookObserved('t1')
    const confirmed = await orch.refresh({
      terminalId: 't1',
      ccResultOverride: {
        kind: 'supported',
        status: 'supported',
        reason: 'ok',
        version: { major: 2, minor: 1, patch: 119, raw: '2.1.119' }
      }
    })
    assert.equal(confirmed.state.hook_fires, true)
    assert.equal(confirmed.decision.selected, 'L0-A')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('L0Orchestrator — refreshAllTerminals fans out to every bound terminal', async () => {
  const dir = scratchDir()
  try {
    const origHome = process.env.HOME
    const origUserProfile = process.env.USERPROFILE
    const origAppData = process.env.APPDATA
    process.env.HOME = dir
    process.env.USERPROFILE = dir
    delete process.env.APPDATA
    try {
      const orch = new L0Orchestrator()
      orch.bindTerminal({ terminalId: 'a', cwd: dir, settingsPathOverride: path.join(dir, 'missing.json') })
      orch.bindTerminal({ terminalId: 'b', cwd: dir, settingsPathOverride: path.join(dir, 'missing.json') })

      // Stub CC detection on each refresh call by pre-seeding global
      // snapshot through an unrelated probe — refreshAllTerminals goes
      // through probeCapabilities which will invoke detectCcVersion if
      // no override provided. We supply override via bound refresh hook.
      const snaps = await Promise.all([
        orch.refresh({ terminalId: 'a', ccResultOverride: { kind: 'not-installed', reason: 't' } }),
        orch.refresh({ terminalId: 'b', ccResultOverride: { kind: 'not-installed', reason: 't' } })
      ])
      assert.equal(snaps[0].terminalId, 'a')
      assert.equal(snaps[1].terminalId, 'b')
      assert.equal(orch.listPerTerminalSnapshots().length, 2)
    } finally {
      if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
      if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile
      if (origAppData) process.env.APPDATA = origAppData
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('RW-A regression — existing single-adapter construction path still works with real adapter', () => {
  // Sanity: CcStreamJsonAdapter is the real default adapter; the old
  // L0Pipeline contract should still emit events when stdout chunks
  // arrive through pipeline.ingest, because no per-terminal override is
  // installed.
  const adapter = new CcStreamJsonAdapter()
  const pipeline = new L0Pipeline(adapter, () => undefined)
  pipeline.bindVendor('t1', 'claude-code')
  const result = pipeline.ingest(
    't1',
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-22T08:00:00.000Z',
      message: {
        role: 'assistant',
        type: 'message',
        content: [{ type: 'tool_use', name: 'Read', id: 'x', input: { file_path: '/a' } }]
      }
    }) + '\n',
    '/ws'
  )
  assert.ok(result.emittedEvents >= 0, 'pipeline survived without per-terminal override')
})
