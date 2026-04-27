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

test('installHooks — fresh install writes CC-canonical array form', () => {
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
      assert.equal(fs.readFileSync(result.backupPath, 'utf8'), '{\n  "foo": 1\n}\n')
    }

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.equal(written.foo, 1)
    // CC schema: PreToolUse must be an ARRAY of {matcher, hooks: [{type, command}]}
    assert.ok(Array.isArray(written.hooks.PreToolUse), 'PreToolUse must be an array')
    assert.equal(written.hooks.PreToolUse.length, 1)
    const entry = written.hooks.PreToolUse[0]
    assert.equal(entry.matcher, '.*')
    assert.ok(Array.isArray(entry.hooks))
    assert.equal(entry.hooks[0].type, 'command')
    assert.equal(entry.hooks[0].command, '/usr/bin/wp-pre')
    assert.equal(entry.hooks[0]['workpane-managed'], true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — already-installed when canonical entry with matching command present', () => {
  // Re-installing with the IDENTICAL command path is a no-op (already-installed).
  // A different command path would trigger a refresh — see the "appends/refreshes" test.
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: '/same', 'workpane-managed': true }]
          }
        ]
      }
    }, null, 2))

    const result = installHooks({
      settingsPath,
      hooks: [{ event: 'PreToolUse', command: '/same' }],
      _backupSuffix: 'test'
    })
    assert.equal(result.kind, 'already-installed')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — migrates legacy buggy object form to canonical array', () => {
  // Reproduces the bug seen in the wild: pre-fix installer wrote
  // { workpane-managed: true, command: '...' } which CC rejected.
  // Re-running install must self-heal to the array form.
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: { 'workpane-managed': true, command: '/old-buggy' },
        PostToolUse: { 'workpane-managed': true, command: '/old-buggy-post' }
      }
    }, null, 2))

    const result = installHooks({
      settingsPath,
      hooks: [
        { event: 'PreToolUse', command: '/wp-new' },
        { event: 'PostToolUse', command: '/wp-new-post' }
      ],
      _backupSuffix: 'mig'
    })
    assert.equal(result.kind, 'installed')

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.ok(Array.isArray(written.hooks.PreToolUse))
    assert.equal(written.hooks.PreToolUse.length, 1)
    assert.equal(written.hooks.PreToolUse[0].hooks[0].command, '/wp-new')
    assert.equal(written.hooks.PreToolUse[0].hooks[0]['workpane-managed'], true)
    assert.ok(Array.isArray(written.hooks.PostToolUse))
    assert.equal(written.hooks.PostToolUse[0].hooks[0].command, '/wp-new-post')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — appends to user array entries, refreshes our entry on re-install', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: '/user/bash-pre' }] }
        ],
        SessionStart: [
          { matcher: '.*', hooks: [{ type: 'command', command: '/user/sess' }] }
        ]
      }
    }, null, 2))

    installHooks({
      settingsPath,
      hooks: [
        { event: 'PreToolUse', command: '/wp-pre-v1' },
        { event: 'PostToolUse', command: '/wp-post' }
      ],
      _backupSuffix: 'append1'
    })

    let written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    // User Bash entry preserved
    assert.equal(written.hooks.PreToolUse[0].matcher, 'Bash')
    assert.equal(written.hooks.PreToolUse[0].hooks[0].command, '/user/bash-pre')
    // WP entry appended
    assert.equal(written.hooks.PreToolUse.length, 2)
    assert.equal(written.hooks.PreToolUse[1].hooks[0].command, '/wp-pre-v1')
    assert.equal(written.hooks.PreToolUse[1].hooks[0]['workpane-managed'], true)
    // User SessionStart preserved (we don't touch it — not in additions list)
    assert.equal(written.hooks.SessionStart[0].hooks[0].command, '/user/sess')
    // PostToolUse newly added (was absent)
    assert.ok(Array.isArray(written.hooks.PostToolUse))
    assert.equal(written.hooks.PostToolUse[0].hooks[0].command, '/wp-post')

    // Re-install with new command path — must refresh our entry, not append a duplicate
    installHooks({
      settingsPath,
      hooks: [{ event: 'PreToolUse', command: '/wp-pre-v2' }],
      _backupSuffix: 'append2'
    })
    written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.equal(written.hooks.PreToolUse.length, 2, 'must not duplicate WP entry')
    // User entry still first
    assert.equal(written.hooks.PreToolUse[0].matcher, 'Bash')
    // WP entry refreshed
    assert.equal(written.hooks.PreToolUse[1].hooks[0].command, '/wp-pre-v2')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installHooks — preserves user hooks in non-array forms (skip without overwriting)', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      hooks: {
        // User has a string-form value — installer must not destroy it.
        PreToolUse: '/user/custom-hook',
        // User has a non-WP object — installer must not destroy it.
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
    // User's PreToolUse is preserved as-is (skipped)
    assert.equal(written.hooks.PreToolUse, '/user/custom-hook')
    // User's SessionStart is preserved (we didn't request it)
    assert.equal(written.hooks.SessionStart.command, '/user/session')
    // WorkPane's PostToolUse (no conflict) is added in canonical array form
    assert.ok(Array.isArray(written.hooks.PostToolUse))
    assert.equal(written.hooks.PostToolUse[0].hooks[0].command, '/wp-post')
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
    assert.ok(Array.isArray(written.hooks.PreToolUse))
    assert.equal(written.hooks.PreToolUse[0].hooks[0].command, '/wp')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('uninstallHooks — removes canonical WP entry from array, preserves user entries', () => {
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: '/user/bash-pre' }] },
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: '/wp-pre', 'workpane-managed': true }]
          }
        ],
        PostToolUse: [
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: '/wp-post', 'workpane-managed': true }]
          }
        ],
        SessionStart: '/user-hook'
      }
    }, null, 2))

    const result = uninstallHooks({
      settingsPath,
      events: ['PreToolUse', 'PostToolUse', 'SessionStart'],
      _backupSuffix: 'un'
    })
    assert.equal(result.kind, 'uninstalled')

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    // User string entry untouched
    assert.equal(written.hooks.SessionStart, '/user-hook')
    // PreToolUse array kept the user Bash entry, dropped only WP
    assert.ok(Array.isArray(written.hooks.PreToolUse))
    assert.equal(written.hooks.PreToolUse.length, 1)
    assert.equal(written.hooks.PreToolUse[0].hooks[0].command, '/user/bash-pre')
    // PostToolUse had only WP — entire key dropped
    assert.equal(written.hooks.PostToolUse, undefined)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('uninstallHooks — heals legacy buggy object form (drops WP-marked legacy entries)', () => {
  // The pre-fix installer wrote {workpane-managed:true, command:...} which
  // CC rejects. uninstall must remove these so users can recover.
  const dir = scratchDir()
  try {
    const settingsPath = settingsPathIn(dir)
    seed(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: { 'workpane-managed': true, command: '/wp-pre' },
        PostToolUse: { 'workpane-managed': true, command: '/wp-post' },
        SessionStart: { 'workpane-managed': true, command: '/wp-start' },
        SessionEnd: { 'workpane-managed': true, command: '/wp-end' },
        UserHook: '/user-string-stays'
      }
    }, null, 2))

    const result = uninstallHooks({
      settingsPath,
      events: ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd'],
      _backupSuffix: 'heal'
    })
    assert.equal(result.kind, 'uninstalled')

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.equal(written.hooks.PreToolUse, undefined)
    assert.equal(written.hooks.PostToolUse, undefined)
    assert.equal(written.hooks.SessionStart, undefined)
    assert.equal(written.hooks.SessionEnd, undefined)
    // Non-WP user entry under a different key is untouched
    assert.equal(written.hooks.UserHook, '/user-string-stays')
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
        PreToolUse: [
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: '/wp', 'workpane-managed': true }]
          }
        ]
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

test('install + uninstall round-trip preserves user portion', () => {
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
    // After install: PreToolUse is still '/user' (string, skipped because non-array non-WP).
    let mid = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    assert.equal(mid.hooks.PreToolUse, '/user')
    assert.ok(Array.isArray(mid.hooks.PostToolUse))

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
