import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectHookInstallStatus, L0Orchestrator, probeCapabilities } from '../../src/main/l0/l0-orchestrator'
import { encodeCwdToProjectDir } from '../../src/main/l0/session-log-locator'

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'l0-orch-'))
}

test('detectHookInstallStatus — missing file reports not installed', () => {
  const dir = scratchDir()
  try {
    const result = detectHookInstallStatus(path.join(dir, 'settings.json'))
    assert.equal(result.installed, false)
    assert.ok(result.reason.includes('missing'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('detectHookInstallStatus — parse error reports not installed', () => {
  const dir = scratchDir()
  try {
    const p = path.join(dir, 'settings.json')
    fs.writeFileSync(p, '{ broken')
    const result = detectHookInstallStatus(p)
    assert.equal(result.installed, false)
    assert.ok(result.reason.includes('parse failure'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('detectHookInstallStatus — no hooks field reports not installed', () => {
  const dir = scratchDir()
  try {
    const p = path.join(dir, 'settings.json')
    fs.writeFileSync(p, JSON.stringify({ other: 1 }))
    const result = detectHookInstallStatus(p)
    assert.equal(result.installed, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('detectHookInstallStatus — marker present reports installed', () => {
  const dir = scratchDir()
  try {
    const p = path.join(dir, 'settings.json')
    fs.writeFileSync(p, JSON.stringify({
      hooks: {
        PreToolUse: { 'workpane-managed': true, command: '/wp' }
      }
    }))
    const result = detectHookInstallStatus(p)
    assert.equal(result.installed, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('detectHookInstallStatus — user hooks without marker are not WorkPane', () => {
  const dir = scratchDir()
  try {
    const p = path.join(dir, 'settings.json')
    fs.writeFileSync(p, JSON.stringify({
      hooks: {
        PreToolUse: '/user',
        PostToolUse: { command: '/user-post' }
      }
    }))
    const result = detectHookInstallStatus(p)
    assert.equal(result.installed, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('probeCapabilities — unsupported CC → hook_installed=false even with marker', async () => {
  const dir = scratchDir()
  try {
    const settingsPath = path.join(dir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: { PreToolUse: { 'workpane-managed': true, command: '/wp' } }
    }))

    const snapshot = await probeCapabilities({
      cwd: dir,
      settingsPathOverride: settingsPath,
      ccResultOverride: {
        kind: 'unsupported',
        status: 'unsupported',
        reason: 'too old'
      }
    })

    assert.equal(snapshot.state.hook_installed, false)
    // With no session log accessible we drop to L1-regex
    assert.ok(['L1-regex', 'L0-E'].includes(snapshot.decision.selected))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('probeCapabilities — supported CC + marker → decision L0-A', async () => {
  const dir = scratchDir()
  try {
    const settingsPath = path.join(dir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: { PreToolUse: { 'workpane-managed': true, command: '/wp' } }
    }))

    const snapshot = await probeCapabilities({
      cwd: dir,
      settingsPathOverride: settingsPath,
      ccResultOverride: {
        kind: 'supported',
        status: 'supported',
        reason: 'ok',
        version: { major: 2, minor: 1, patch: 119, raw: '2.1.119' }
      }
    })

    assert.equal(snapshot.state.hook_installed, true)
    assert.equal(snapshot.decision.selected, 'L0-A')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('probeCapabilities — not-installed CC + no projects dir → L1-regex', async () => {
  const dir = scratchDir()
  // Point HOME to an empty scratch dir so resolveProjectsDir misses
  const origHome = process.env.HOME
  const origUserProfile = process.env.USERPROFILE
  const origAppData = process.env.APPDATA
  process.env.HOME = dir
  process.env.USERPROFILE = dir
  delete process.env.APPDATA
  try {
    const snapshot = await probeCapabilities({
      cwd: path.join(dir, 'nonexistent-cwd'),
      settingsPathOverride: path.join(dir, 'missing.json'),
      ccResultOverride: { kind: 'not-installed', reason: 'not found' }
    })
    assert.equal(snapshot.state.hook_installed, false)
    assert.equal(snapshot.state.session_log_accessible, false)
    assert.equal(snapshot.decision.selected, 'L1-regex')
  } finally {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile
    if (origAppData) process.env.APPDATA = origAppData
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('probeCapabilities — session log accessible when project dir exists', async () => {
  // Use a fake projects dir under scratch so resolveProjectsDir can find it
  const scratch = scratchDir()
  const home = path.join(scratch, 'home')
  const projectsDir = path.join(home, '.claude', 'projects')
  const testCwd = '/test/scratch/cwd'
  const encoded = encodeCwdToProjectDir(testCwd)
  fs.mkdirSync(path.join(projectsDir, encoded), { recursive: true })

  // Point HOME to our scratch so resolveProjectsDir discovers it
  const origHome = process.env.HOME
  const origUserProfile = process.env.USERPROFILE
  const origAppData = process.env.APPDATA
  process.env.HOME = home
  process.env.USERPROFILE = home
  delete process.env.APPDATA
  try {
    const snapshot = await probeCapabilities({
      cwd: testCwd,
      settingsPathOverride: path.join(scratch, 'missing-settings.json'),
      ccResultOverride: { kind: 'not-installed', reason: 'skip cc' }
    })
    assert.equal(snapshot.state.session_log_accessible, true)
    assert.ok(snapshot.sessionLogProjectDir?.endsWith(encoded))
  } finally {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome
    if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile
    if (origAppData) process.env.APPDATA = origAppData
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('L0Orchestrator — refresh persists latest snapshot and notifies listeners', async () => {
  const orch = new L0Orchestrator()
  const dir = scratchDir()
  try {
    assert.equal(orch.getSnapshot(), null)

    const updates: number[] = []
    const unsubscribe = orch.onChange((s) => updates.push(s.probedAt))

    await orch.refresh({
      cwd: dir,
      settingsPathOverride: path.join(dir, 'missing.json'),
      ccResultOverride: { kind: 'not-installed', reason: 'test' }
    })
    assert.ok(orch.getSnapshot())
    assert.equal(updates.length, 1)

    await orch.refresh({
      cwd: dir,
      settingsPathOverride: path.join(dir, 'missing.json'),
      ccResultOverride: { kind: 'not-installed', reason: 'test' }
    })
    assert.equal(updates.length, 2)

    unsubscribe()
    await orch.refresh({
      cwd: dir,
      settingsPathOverride: path.join(dir, 'missing.json'),
      ccResultOverride: { kind: 'not-installed', reason: 'test' }
    })
    assert.equal(updates.length, 2, 'unsubscribed listener should not be called')

    orch.dispose()
    assert.equal(orch.getSnapshot(), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
