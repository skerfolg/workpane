import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installHooks, uninstallHooks } from '../../src/main/l0/hook-installer'

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hook-installer-'))
}

function sha256(contents: string): string {
  return crypto.createHash('sha256').update(contents).digest('hex')
}

function settingsPathIn(dir: string): string {
  return path.join(dir, 'settings.json')
}

function seed(settingsPath: string, contents: string): string {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, contents)
  return sha256(contents)
}

test('installHooks — fresh install writes hooks + backup + verify', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, '{\n  "foo": 1\n}\n')

    const result = installHooks({
      settingsPath,
      hooks: [{ event: 'PreToolUse', command: '/usr/bin/wp-pre' }],
      _backupSuffix: 'test'
    })

    assert.equal(result.kind, 'installed')
    if (result.kind === 'installed') {
      assert.ok(fs.existsSync(result.backupPath))
      // Backup preserved exact original bytes
      assert.equal(fs.readFileSync(result.backupPath, 'utf8'), '{\n  "foo": 1\n}\n')
    }

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.equal(written.foo, 1)
    assert.equal(written.hooks.PreToolUse.command, '/usr/bin/wp-pre')
    assert.equal(written.hooks.PreToolUse['workpane-managed'], true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — already-installed when all hooks already carry marker', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: { 'workpane-managed': true, command: '/old' }
      }
    }, null, 2))

    const result = installHooks({
      settingsPath,
      hooks: [{ event: 'PreToolUse', command: '/new' }],
      _backupSuffix: 'test'
    })
    assert.equal(result.kind, 'already-installed')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — preserves user hooks (does not overwrite non-WorkPane entry)', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: '/user/custom-hook',
        SessionStart: { command: '/user/session' }
      }
    }, null, 2))

    installHooks({
      settingsPath,
      hooks: [
        { event: 'PreToolUse', command: '/wp-pre' },
        { event: 'PostToolUse', command: '/wp-post' }
      ],
      _backupSuffix: 'test'
    })

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    // User's PreToolUse is preserved
    assert.equal(written.hooks.PreToolUse, '/user/custom-hook')
    // User's SessionStart is preserved
    assert.equal(written.hooks.SessionStart.command, '/user/session')
    // WorkPane's PostToolUse (not in conflict) is added
    assert.equal(written.hooks.PostToolUse.command, '/wp-post')
    assert.equal(written.hooks.PostToolUse['workpane-managed'], true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — abort-parse-error when settings.json is malformed', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, '{ "broken":: ')

    const result = installHooks({
      settingsPath,
      hooks: [{ event: 'PreToolUse', command: '/x' }],
      _backupSuffix: 'test'
    })
    assert.equal(result.kind, 'abort-parse-error')
    if (result.kind === 'abort-parse-error') {
      assert.equal(result.stage, 'precheck')
    }
    // Original file untouched
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ "broken":: ')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — abort-parse-error when settings.json is not an object', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, '["array", "not object"]')

    const result = installHooks({
      settingsPath,
      hooks: [{ event: 'PreToolUse', command: '/x' }],
      _backupSuffix: 'test'
    })
    assert.equal(result.kind, 'abort-parse-error')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — fault injection at write restores from backup', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    const originalHash = seed(settingsPath, '{\n  "original": "intact"\n}\n')

    const result = installHooks({
      settingsPath,
      hooks: [{ event: 'PreToolUse', command: '/wp' }],
      _injectFaultAt: 'write',
      _backupSuffix: 'test'
    })
    assert.equal(result.kind, 'abort-io-error')
    if (result.kind === 'abort-io-error') {
      assert.equal(result.stage, 'write')
      assert.equal(result.restored, true)
    }
    // Original is intact — hash matches precheck
    const after = fs.readFileSync(settingsPath, 'utf8')
    assert.equal(sha256(after), originalHash)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — fault injection at verify restores from backup', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    const originalHash = seed(settingsPath, '{\n  "original": "intact-v"\n}\n')

    const result = installHooks({
      settingsPath,
      hooks: [{ event: 'PreToolUse', command: '/wp' }],
      _injectFaultAt: 'verify',
      _backupSuffix: 'test'
    })
    assert.equal(result.kind, 'abort-io-error')
    if (result.kind === 'abort-io-error') {
      assert.equal(result.stage, 'verify')
    }
    const after = fs.readFileSync(settingsPath, 'utf8')
    assert.equal(sha256(after), originalHash)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — fault injection at backup leaves original unchanged', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    const originalHash = seed(settingsPath, '{"pre": 1}')

    const result = installHooks({
      settingsPath,
      hooks: [{ event: 'PreToolUse', command: '/wp' }],
      _injectFaultAt: 'backup',
      _backupSuffix: 'test'
    })
    assert.equal(result.kind, 'abort-io-error')
    const after = fs.readFileSync(settingsPath, 'utf8')
    assert.equal(sha256(after), originalHash)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — missing settings.json treats content as empty object', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    // Do not seed — file does not exist
    const result = installHooks({
      settingsPath,
      hooks: [{ event: 'PreToolUse', command: '/wp' }],
      _backupSuffix: 'test'
    })
    assert.equal(result.kind, 'installed')
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.equal(written.hooks.PreToolUse.command, '/wp')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('uninstallHooks — removes WorkPane marker hooks, preserves user hooks', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: { 'workpane-managed': true, command: '/wp-pre' },
        PostToolUse: { 'workpane-managed': true, command: '/wp-post' },
        SessionStart: '/user-hook'
      }
    }, null, 2))

    const result = uninstallHooks({
      settingsPath,
      events: ['PreToolUse', 'PostToolUse'],
      _backupSuffix: 'un'
    })
    assert.equal(result.kind, 'uninstalled')

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.equal(written.hooks.SessionStart, '/user-hook')
    assert.equal(written.hooks.PreToolUse, undefined)
    assert.equal(written.hooks.PostToolUse, undefined)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('uninstallHooks — no-op when no WorkPane markers present', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({ hooks: { PreToolUse: '/user' } }))
    const result = uninstallHooks({
      settingsPath,
      events: ['PreToolUse'],
      _backupSuffix: 'un'
    })
    assert.equal(result.kind, 'no-op-not-installed')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('uninstallHooks — drops hooks key entirely when empty after strip', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      someOtherField: 'keep',
      hooks: {
        PreToolUse: { 'workpane-managed': true, command: '/wp' }
      }
    }, null, 2))

    uninstallHooks({
      settingsPath,
      events: ['PreToolUse'],
      _backupSuffix: 'un'
    })
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.equal(written.someOtherField, 'keep')
    assert.equal(written.hooks, undefined)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('uninstallHooks — missing settings.json is no-op', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    const result = uninstallHooks({
      settingsPath,
      events: ['PreToolUse'],
      _backupSuffix: 'un'
    })
    assert.equal(result.kind, 'no-op-not-installed')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('install + uninstall round-trip restores original content (byte-identical for user portion)', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      userField: 'value',
      hooks: { PreToolUse: '/user' }
    }, null, 2) + '\n')

    installHooks({
      settingsPath,
      hooks: [{ event: 'PostToolUse', command: '/wp-post' }],
      _backupSuffix: 'r1'
    })
    uninstallHooks({
      settingsPath,
      events: ['PostToolUse'],
      _backupSuffix: 'r2'
    })

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.equal(after.userField, 'value')
    assert.equal(after.hooks.PreToolUse, '/user')
    assert.equal(after.hooks.PostToolUse, undefined)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
