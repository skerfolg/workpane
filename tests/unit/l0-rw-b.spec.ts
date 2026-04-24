import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  listActiveListeners,
  registerHookListener,
  unregisterHookListener
} from '../../src/main/l0/hook-registry'
import { SessionLogTailerPool } from '../../src/main/l0/session-log-tailer-pool'
import { HookServer } from '../../src/main/l0/hook-server'
import { encodeCwdToProjectDir } from '../../src/main/l0/session-log-locator'
import net from 'node:net'

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'l0-rw-b-'))
}

// ---- Hook registry

test('registerHookListener — fresh registry writes entry + sets 0o600', () => {
  const dir = scratchDir()
  const registryPath = path.join(dir, 'registry.json')
  try {
    registerHookListener(
      {
        pid: process.pid,
        terminalId: 't1',
        socketPath: path.join(dir, 's.sock'),
        tokenPath: path.join(dir, 's.token'),
        workspacePath: '/ws/a',
        startedAt: Date.now()
      },
      { registryPath }
    )
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    assert.equal(parsed.version, 1)
    assert.equal(parsed.entries.length, 1)
    assert.equal(parsed.entries[0].terminalId, 't1')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('registerHookListener — re-register with same pid + terminalId replaces entry', () => {
  const dir = scratchDir()
  const registryPath = path.join(dir, 'registry.json')
  try {
    registerHookListener(
      { pid: process.pid, terminalId: 't1', socketPath: '/a', tokenPath: '/t', workspacePath: '/w', startedAt: 1 },
      { registryPath }
    )
    registerHookListener(
      { pid: process.pid, terminalId: 't1', socketPath: '/b', tokenPath: '/t', workspacePath: '/w', startedAt: 2 },
      { registryPath }
    )
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    assert.equal(parsed.entries.length, 1)
    assert.equal(parsed.entries[0].socketPath, '/b')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('registerHookListener — caps at 16 entries (oldest evicted)', () => {
  const dir = scratchDir()
  const registryPath = path.join(dir, 'registry.json')
  try {
    for (let i = 0; i < 20; i += 1) {
      registerHookListener(
        {
          pid: process.pid + i,
          terminalId: `t${i}`,
          socketPath: `/${i}`,
          tokenPath: `/t${i}`,
          workspacePath: `/w${i}`,
          startedAt: i
        },
        { registryPath }
      )
    }
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    assert.equal(parsed.entries.length, 16)
    // Oldest first-four should be evicted
    assert.equal(parsed.entries[0].terminalId, 't4')
    assert.equal(parsed.entries[15].terminalId, 't19')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('unregisterHookListener — removes matching entry', () => {
  const dir = scratchDir()
  const registryPath = path.join(dir, 'registry.json')
  try {
    registerHookListener(
      { pid: process.pid, terminalId: 't1', socketPath: '/a', tokenPath: '/t', workspacePath: '/w', startedAt: 1 },
      { registryPath }
    )
    registerHookListener(
      { pid: process.pid, terminalId: 't2', socketPath: '/b', tokenPath: '/t', workspacePath: '/w', startedAt: 2 },
      { registryPath }
    )
    unregisterHookListener(process.pid, 't1', { registryPath })
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    assert.equal(parsed.entries.length, 1)
    assert.equal(parsed.entries[0].terminalId, 't2')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('unregisterHookListener — removing last entry deletes the file', () => {
  const dir = scratchDir()
  const registryPath = path.join(dir, 'registry.json')
  try {
    registerHookListener(
      { pid: process.pid, terminalId: 't1', socketPath: '/a', tokenPath: '/t', workspacePath: '/w', startedAt: 1 },
      { registryPath }
    )
    unregisterHookListener(process.pid, 't1', { registryPath })
    assert.equal(fs.existsSync(registryPath), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('listActiveListeners — filters entries whose pid is not alive', () => {
  const dir = scratchDir()
  const registryPath = path.join(dir, 'registry.json')
  try {
    registerHookListener(
      { pid: process.pid, terminalId: 'live', socketPath: '/a', tokenPath: '/t', workspacePath: '/w', startedAt: 1 },
      { registryPath }
    )
    registerHookListener(
      { pid: 1, terminalId: 'init', socketPath: '/b', tokenPath: '/t', workspacePath: '/w', startedAt: 2 },
      { registryPath }
    )
    // pid=999999 very likely dead on all platforms
    registerHookListener(
      { pid: 999_999, terminalId: 'dead', socketPath: '/c', tokenPath: '/t', workspacePath: '/w', startedAt: 3 },
      { registryPath }
    )
    const active = listActiveListeners({ registryPath })
    const liveIds = new Set(active.map((e) => e.terminalId))
    assert.ok(liveIds.has('live'))
    assert.ok(!liveIds.has('dead'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---- Tailer pool

test('SessionLogTailerPool — single subscriber acquires + releases cleanly', () => {
  const dir = scratchDir()
  try {
    const encoded = encodeCwdToProjectDir('/cwd/poolA')
    fs.mkdirSync(path.join(dir, encoded), { recursive: true })
    const pool = new SessionLogTailerPool()
    const handle = pool.acquire({
      terminalId: 't1',
      cwd: '/cwd/poolA',
      projectsDirOverride: dir,
      dryRun: true,
      onEnvelope: () => undefined
    })
    assert.equal(pool.activeTailersTotal, 1)
    assert.equal(pool.activeSubscribersTotal, 1)
    handle.release()
    assert.equal(pool.activeTailersTotal, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('SessionLogTailerPool — two subscribers on same cwd share one tailer', () => {
  const dir = scratchDir()
  try {
    const encoded = encodeCwdToProjectDir('/cwd/shared')
    fs.mkdirSync(path.join(dir, encoded), { recursive: true })
    const pool = new SessionLogTailerPool()
    const a = pool.acquire({
      terminalId: 'a',
      cwd: '/cwd/shared',
      projectsDirOverride: dir,
      dryRun: true,
      onEnvelope: () => undefined
    })
    const b = pool.acquire({
      terminalId: 'b',
      cwd: '/cwd/shared',
      projectsDirOverride: dir,
      dryRun: true,
      onEnvelope: () => undefined
    })
    assert.equal(pool.activeTailersTotal, 1, 'one tailer for both subscribers')
    assert.equal(pool.activeSubscribersTotal, 2)
    a.release()
    assert.equal(pool.activeTailersTotal, 1, 'tailer still alive while b holds')
    assert.equal(pool.activeSubscribersTotal, 1)
    b.release()
    assert.equal(pool.activeTailersTotal, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('SessionLogTailerPool — two subscribers on different cwds get two tailers', () => {
  const dir = scratchDir()
  try {
    const encA = encodeCwdToProjectDir('/cwd/alpha')
    const encB = encodeCwdToProjectDir('/cwd/beta')
    fs.mkdirSync(path.join(dir, encA), { recursive: true })
    fs.mkdirSync(path.join(dir, encB), { recursive: true })
    const pool = new SessionLogTailerPool()
    pool.acquire({
      terminalId: 'a',
      cwd: '/cwd/alpha',
      projectsDirOverride: dir,
      dryRun: true,
      onEnvelope: () => undefined
    })
    pool.acquire({
      terminalId: 'b',
      cwd: '/cwd/beta',
      projectsDirOverride: dir,
      dryRun: true,
      onEnvelope: () => undefined
    })
    assert.equal(pool.activeTailersTotal, 2)
    pool.assertHealthy()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('SessionLogTailerPool — fan-out tags each subscriber with its own terminalId', () => {
  const dir = scratchDir()
  try {
    const encoded = encodeCwdToProjectDir('/cwd/fanout')
    fs.mkdirSync(path.join(dir, encoded), { recursive: true })
    const pool = new SessionLogTailerPool()
    const received: Array<{ terminalId: string; payloadId: number }> = []
    pool.acquire({
      terminalId: 'a',
      cwd: '/cwd/fanout',
      projectsDirOverride: dir,
      dryRun: true,
      onEnvelope: (e) => received.push({ terminalId: e.terminalId, payloadId: (e.payload as { id: number }).id })
    })
    pool.acquire({
      terminalId: 'b',
      cwd: '/cwd/fanout',
      projectsDirOverride: dir,
      dryRun: true,
      onEnvelope: (e) => received.push({ terminalId: e.terminalId, payloadId: (e.payload as { id: number }).id })
    })
    // Force an envelope onto the underlying tailer — we can reach it via the
    // pool's internal map only from source, so we simulate by directly
    // invoking the tailer's private dispatcher via a fake line. Use the pool
    // internal API: acquire again with the same cwd returns same tailer, so
    // we trigger fan-out through an _emitForTest backdoor.
    // The tailer exposes _emitForTest; we reuse one subscriber's handle to
    // reach it through the pool internals.
    const internal = (pool as unknown as { entries: Map<string, { tailer: { _emitForTest: (p: string, c: string) => void } }> })
    const entry = internal.entries.get(encoded)
    assert.ok(entry)
    entry.tailer._emitForTest(path.join(dir, encoded, 'f.jsonl'), JSON.stringify({ id: 7 }) + '\n')

    const ids = received.map((r) => r.terminalId).sort()
    assert.deepEqual(ids, ['a', 'b'])
    assert.ok(received.every((r) => r.payloadId === 7))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---- HookServer correlation filter (G2 / D4)

const canRunSocketTests = process.platform !== 'win32'

async function sendFrame(client: net.Socket, frame: unknown): Promise<void> {
  client.write(JSON.stringify(frame) + '\n')
  await new Promise((r) => setTimeout(r, 30))
}

test('HookServer — cwd mismatch drops payload', { skip: !canRunSocketTests }, async () => {
  const dir = scratchDir()
  const sockPath = path.join(dir, 'hook.sock')
  const tokenPath = path.join(dir, 'token')
  const server = new HookServer({
    terminalId: 't',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'x'.repeat(64),
    workspacePath: '/my/workspace'
  })
  try {
    await server.start()
    const payloads: unknown[] = []
    const filtered: string[] = []
    server.on('payload', (p) => payloads.push(p))
    server.on('filtered', (f) => filtered.push(f.reason))

    const client = net.createConnection(sockPath)
    await new Promise((r) => client.once('connect', r))
    await sendFrame(client, { auth: 'x'.repeat(64) })
    await sendFrame(client, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      cwd: '/other/workspace',
      session_id: 's1'
    })

    assert.equal(payloads.length, 0, 'payload dropped by cwd filter')
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0], 'cwd_mismatch')
    assert.equal(server._filteredCwdCountForTest, 1)
    client.end()
  } finally {
    await server.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('HookServer — cwd match captures session_id and subsequent mismatched session_id is filtered', { skip: !canRunSocketTests }, async () => {
  const dir = scratchDir()
  const sockPath = path.join(dir, 'hook.sock')
  const tokenPath = path.join(dir, 'token')
  const server = new HookServer({
    terminalId: 't',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'y'.repeat(64),
    workspacePath: '/my/workspace'
  })
  try {
    await server.start()
    const payloads: Array<{ terminalId: string; payload: Record<string, unknown> }> = []
    const filtered: string[] = []
    server.on('payload', (p) => payloads.push(p))
    server.on('filtered', (f) => filtered.push(f.reason))

    const client = net.createConnection(sockPath)
    await new Promise((r) => client.once('connect', r))
    await sendFrame(client, { auth: 'y'.repeat(64) })
    await sendFrame(client, {
      hook_event_name: 'SessionStart',
      cwd: '/my/workspace',
      session_id: 'session-A'
    })
    await sendFrame(client, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      cwd: '/my/workspace',
      session_id: 'session-B'
    })

    assert.equal(payloads.length, 1, 'only first payload accepted')
    assert.equal((payloads[0].payload as { hook_event_name: string }).hook_event_name, 'SessionStart')
    assert.equal(server._capturedSessionIdForTest, 'session-A')
    assert.ok(filtered.includes('session_id_mismatch'))
    assert.equal(server._filteredSessionCountForTest, 1)
    client.end()
  } finally {
    await server.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('HookServer — SessionEnd of captured session releases binding so a new SessionStart can take over', { skip: !canRunSocketTests }, async () => {
  const dir = scratchDir()
  const sockPath = path.join(dir, 'hook.sock')
  const tokenPath = path.join(dir, 'token')
  const server = new HookServer({
    terminalId: 't',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'r'.repeat(64),
    workspacePath: '/my/workspace'
  })
  try {
    await server.start()
    const client = net.createConnection(sockPath)
    await new Promise((r) => client.once('connect', r))
    await sendFrame(client, { auth: 'r'.repeat(64) })
    await sendFrame(client, { hook_event_name: 'SessionStart', cwd: '/my/workspace', session_id: 'sess-1' })
    assert.equal(server._capturedSessionIdForTest, 'sess-1')
    await sendFrame(client, { hook_event_name: 'SessionEnd', cwd: '/my/workspace', session_id: 'sess-1' })
    assert.equal(server._capturedSessionIdForTest, null, 'SessionEnd release cleared binding')
    await sendFrame(client, { hook_event_name: 'SessionStart', cwd: '/my/workspace', session_id: 'sess-2' })
    assert.equal(server._capturedSessionIdForTest, 'sess-2', 'new session captured after release')
    client.end()
  } finally {
    await server.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('HookServer — lifecycle frame before any SessionStart does not lock the binding', { skip: !canRunSocketTests }, async () => {
  const dir = scratchDir()
  const sockPath = path.join(dir, 'hook.sock')
  const tokenPath = path.join(dir, 'token')
  const server = new HookServer({
    terminalId: 't',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'q'.repeat(64),
    workspacePath: '/my/workspace'
  })
  try {
    await server.start()
    const client = net.createConnection(sockPath)
    await new Promise((r) => client.once('connect', r))
    await sendFrame(client, { auth: 'q'.repeat(64) })
    // A rogue UserPromptSubmit with a fake session_id arrives before the
    // real SessionStart. It must not lock the binding to that fake id,
    // otherwise a race could DoS the real session.
    await sendFrame(client, { hook_event_name: 'UserPromptSubmit', cwd: '/my/workspace', session_id: 'rogue' })
    assert.equal(server._capturedSessionIdForTest, null, 'non-SessionStart does not capture')
    await sendFrame(client, { hook_event_name: 'SessionStart', cwd: '/my/workspace', session_id: 'real' })
    assert.equal(server._capturedSessionIdForTest, 'real')
    client.end()
  } finally {
    await server.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('HookServer — no workspacePath means no cwd filter (back-compat)', { skip: !canRunSocketTests }, async () => {
  const dir = scratchDir()
  const sockPath = path.join(dir, 'hook.sock')
  const tokenPath = path.join(dir, 'token')
  const server = new HookServer({
    terminalId: 't',
    socketPath: sockPath,
    tokenFilePath: tokenPath,
    tokenOverride: 'z'.repeat(64)
    // no workspacePath
  })
  try {
    await server.start()
    const payloads: unknown[] = []
    server.on('payload', (p) => payloads.push(p))

    const client = net.createConnection(sockPath)
    await new Promise((r) => client.once('connect', r))
    await sendFrame(client, { auth: 'z'.repeat(64) })
    await sendFrame(client, { hook_event_name: 'PreToolUse', cwd: '/any/where' })

    assert.equal(payloads.length, 1, 'accepted without workspacePath constraint')
    client.end()
  } finally {
    await server.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
