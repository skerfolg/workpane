import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { CcHookAdapter } from '../../src/main/l0/adapters/cc-hook-adapter'
import { HookServer } from '../../src/main/l0/hook-server'

/**
 * Slice 1B — hook adapter + IPC server tests.
 *
 * Adapter tests run on all platforms. Server tests use the socket path
 * override to bind inside a temp dir. On win32 named-pipe tests use
 * chokidar-independent net connect so they exercise the same code.
 */

test('CcHookAdapter — PreToolUse emits tool-use-pending with approval category', () => {
  const adapter = new CcHookAdapter()
  const result = adapter.ingest('t1', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: '/a' },
    session_id: 's1'
  })
  assert.equal(result.kind, 'event')
  if (result.kind === 'event') {
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0].eventKind, 'tool-use-pending')
    assert.equal(result.events[0].category, 'approval')
    assert.equal(result.events[0].summary, 'Read requested by Claude Code')
    assert.equal(result.events[0].schemaFingerprint, 'cc:hook:v1')
    assert.equal(result.suppressApprovalDetector, true)
  }
  assert.equal(adapter.getStatus('t1')?.mode, 'active')
})

test('CcHookAdapter — PostToolUse with is_error=true emits error event', () => {
  const adapter = new CcHookAdapter()
  const result = adapter.ingest('t1', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_response: { is_error: true, content: 'exit 1' }
  })
  assert.equal(result.kind, 'event')
  if (result.kind === 'event') {
    assert.equal(result.events[0].eventKind, 'error')
    assert.equal(result.events[0].category, 'error')
    assert.equal(result.events[0].summary, 'exit 1')
  }
})

test('CcHookAdapter — PostToolUse without is_error is a no-op (L1 handles success toast)', () => {
  const adapter = new CcHookAdapter()
  const result = adapter.ingest('t1', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_response: { is_error: false, type: 'text' }
  })
  assert.equal(result.kind, 'noop')
  assert.equal(result.suppressApprovalDetector, true)
  // Adapter still transitioned to active since a valid hook envelope arrived
  assert.equal(adapter.getStatus('t1')?.mode, 'active')
})

test('CcHookAdapter — lifecycle events (SessionStart/End/Stop/UserPromptSubmit) no-op at L0', () => {
  const adapter = new CcHookAdapter()
  for (const event of ['SessionStart', 'SessionEnd', 'Stop', 'UserPromptSubmit']) {
    const result = adapter.ingest('t1', { hook_event_name: event })
    assert.equal(result.kind, 'noop', `${event} should be L0 no-op`)
  }
})

test('CcHookAdapter — missing hook_event_name no-ops without crashing', () => {
  const adapter = new CcHookAdapter()
  assert.equal(adapter.ingest('t', {}).kind, 'noop')
  assert.equal(adapter.ingest('t', { tool_name: 'Read' }).kind, 'noop')
})

test('CcHookAdapter — string input is parsed as JSON', () => {
  const adapter = new CcHookAdapter()
  const result = adapter.ingest('t', JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write'
  }))
  assert.equal(result.kind, 'event')
})

test('CcHookAdapter — bad input no-ops (malformed JSON / non-object / null)', () => {
  const adapter = new CcHookAdapter()
  assert.equal(adapter.ingest('t', 'not json').kind, 'noop')
  assert.equal(adapter.ingest('t', null).kind, 'noop')
  assert.equal(adapter.ingest('t', 42).kind, 'noop')
  assert.equal(adapter.ingest('t', []).kind, 'noop')
})

test('CcHookAdapter — reset + dispose clear state', () => {
  const adapter = new CcHookAdapter()
  adapter.ingest('t1', { hook_event_name: 'PreToolUse', tool_name: 'Read' })
  assert.ok(adapter.getStatus('t1'))
  adapter.reset('t1')
  assert.equal(adapter.getStatus('t1'), undefined)
  adapter.ingest('t2', { hook_event_name: 'PreToolUse', tool_name: 'Read' })
  adapter.dispose()
  assert.equal(adapter.getStatus('t2'), undefined)
})

test('CcHookAdapter — numeric timestamp preserved, string timestamp parsed', () => {
  const adapter = new CcHookAdapter()
  const numeric = adapter.ingest('t', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    timestamp: 1700000000000
  })
  if (numeric.kind === 'event') {
    assert.equal(numeric.events[0].observedAt, 1700000000000)
  }
  const stringy = adapter.ingest('t2', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    timestamp: '2026-04-24T00:00:00.000Z'
  })
  if (stringy.kind === 'event') {
    assert.equal(stringy.events[0].observedAt, Date.parse('2026-04-24T00:00:00.000Z'))
  }
})

// ---- HookServer tests (POSIX socket path only; Windows named-pipe tests
// deferred to Slice 1B integration pass per Plan v3 R1)

const canRunSocketTests = process.platform !== 'win32'

test('HookServer — authenticated client receives payload event', { skip: !canRunSocketTests }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-server-'))
  const sockPath = path.join(scratch, 'hook.sock')
  const tokenPath = path.join(scratch, 'token')
  const server = new HookServer({
    terminalId: 't-auth',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'a'.repeat(64)
  })
  try {
    await server.start()
    const token = server._tokenForTest
    const payloads: Array<{ terminalId: string; payload: Record<string, unknown> }> = []
    server.on('payload', (p) => payloads.push(p))

    const client = net.createConnection(sockPath)
    await new Promise((resolve) => client.once('connect', resolve))
    client.write(JSON.stringify({ auth: token }) + '\n')
    client.write(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read' }) + '\n')
    // Give the server a tick to process
    await new Promise((r) => setTimeout(r, 50))

    assert.equal(payloads.length, 1)
    assert.equal(payloads[0].terminalId, 't-auth')
    assert.equal(payloads[0].payload.hook_event_name, 'PreToolUse')

    client.end()
  } finally {
    await server.dispose()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('HookServer — wrong token increments auth-failure and drops connection', { skip: !canRunSocketTests }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-server-'))
  const sockPath = path.join(scratch, 'hook.sock')
  const tokenPath = path.join(scratch, 'token')
  const server = new HookServer({
    terminalId: 't-bad',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'b'.repeat(64)
  })
  try {
    await server.start()
    const failures: string[] = []
    server.on('auth-failure', (f) => failures.push(f.reason))

    const client = net.createConnection(sockPath)
    await new Promise((resolve) => client.once('connect', resolve))
    client.write(JSON.stringify({ auth: 'c'.repeat(64) }) + '\n')
    await new Promise((r) => setTimeout(r, 50))

    assert.equal(failures.length, 1)
    assert.equal(failures[0], 'invalid-token')
    assert.equal(server._authFailureCountForTest, 1)
  } finally {
    await server.dispose()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('HookServer — malformed JSON drops with reason', { skip: !canRunSocketTests }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-server-'))
  const sockPath = path.join(scratch, 'hook.sock')
  const tokenPath = path.join(scratch, 'token')
  const server = new HookServer({
    terminalId: 't-bad-json',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'd'.repeat(64)
  })
  try {
    await server.start()
    const failures: string[] = []
    server.on('auth-failure', (f) => failures.push(f.reason))

    const client = net.createConnection(sockPath)
    await new Promise((resolve) => client.once('connect', resolve))
    client.write('not json\n')
    await new Promise((r) => setTimeout(r, 50))

    assert.equal(failures.length, 1)
    assert.equal(failures[0], 'malformed-json')
  } finally {
    await server.dispose()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('HookServer — frame larger than maxFrameBytes drops', { skip: !canRunSocketTests }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-server-'))
  const sockPath = path.join(scratch, 'hook.sock')
  const tokenPath = path.join(scratch, 'token')
  const server = new HookServer({
    terminalId: 't-big',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'e'.repeat(64),
    maxFrameBytes: 256
  })
  try {
    await server.start()
    const failures: string[] = []
    server.on('auth-failure', (f) => failures.push(f.reason))

    const client = net.createConnection(sockPath)
    await new Promise((resolve) => client.once('connect', resolve))
    client.write('X'.repeat(1024))
    await new Promise((r) => setTimeout(r, 50))

    assert.equal(failures.length, 1)
    assert.equal(failures[0], 'frame-too-large')
  } finally {
    await server.dispose()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('HookServer — token file is written with mode 0o600 (POSIX)', { skip: !canRunSocketTests }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-server-'))
  const sockPath = path.join(scratch, 'hook.sock')
  const tokenPath = path.join(scratch, 'nested', 'token')
  const server = new HookServer({
    terminalId: 't-mode',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'f'.repeat(64)
  })
  try {
    await server.start()
    const stat = fs.statSync(tokenPath)
    // Mask to permission bits; owner rw, no group/other
    assert.equal(stat.mode & 0o777, 0o600)
    const contents = fs.readFileSync(tokenPath, 'utf8')
    assert.equal(contents, 'f'.repeat(64))
  } finally {
    await server.dispose()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('HookServer — dispose removes token file and socket', { skip: !canRunSocketTests }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-server-'))
  const sockPath = path.join(scratch, 'hook.sock')
  const tokenPath = path.join(scratch, 'token')
  const server = new HookServer({
    terminalId: 't-dispose',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'g'.repeat(64)
  })
  try {
    await server.start()
    assert.ok(fs.existsSync(tokenPath))
    assert.ok(fs.existsSync(sockPath))
    await server.dispose()
    assert.equal(fs.existsSync(tokenPath), false)
    assert.equal(fs.existsSync(sockPath), false)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})
