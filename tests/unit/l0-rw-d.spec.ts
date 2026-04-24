import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

/**
 * RW-D — cc-bridge.js integration test.
 *
 * Spawns the packaged bridge script, feeds it a JSON payload on stdin,
 * stands up two local fake HookServer listeners (one matching, one that
 * should still receive the broadcast), verifies both receive the auth
 * frame + payload. Also covers empty-registry + malformed-input no-op
 * paths.
 *
 * Skipped on win32 because the bridge uses Unix domain sockets; CI
 * will exercise the named-pipe path in a follow-up (deferred in plan
 * §9 and RW-F).
 */

const canRunSocketTests = process.platform !== 'win32'
const BRIDGE_PATH = path.join(process.cwd(), 'resources', 'hooks', 'cc-bridge.js')

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bridge-'))
}

interface FakeListener {
  server: net.Server
  socketPath: string
  tokenPath: string
  token: string
  received: Array<{ auth?: string; frame: Record<string, unknown> }>
  close: () => Promise<void>
}

async function spawnFakeListener(dir: string, suffix: string, token: string): Promise<FakeListener> {
  const socketPath = path.join(dir, `listener-${suffix}.sock`)
  const tokenPath = path.join(dir, `listener-${suffix}.token`)
  fs.writeFileSync(tokenPath, token, { mode: 0o600 })

  const received: FakeListener['received'] = []

  const server = net.createServer((socket) => {
    let buffer = ''
    let authedToken: string | undefined
    socket.setEncoding('utf8')
    socket.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
        if (line.length === 0) continue
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>
          if (authedToken === undefined && typeof parsed.auth === 'string') {
            authedToken = parsed.auth
            continue
          }
          received.push({ auth: authedToken, frame: parsed })
        } catch {
          // ignore malformed
        }
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  return {
    server,
    socketPath,
    tokenPath,
    token,
    received,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      })
  }
}

async function runBridge(options: {
  registryPath: string
  payload: unknown
}): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [BRIDGE_PATH], {
      env: { ...process.env, WORKPANE_HOOK_REGISTRY: options.registryPath },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('exit', (code) => resolve({ exitCode: code ?? 0, stderr }))
    child.stdin?.end(options.payload === null ? '' : JSON.stringify(options.payload) + '\n')
  })
}

test('cc-bridge — broadcasts payload to every registry entry (two listeners)', { skip: !canRunSocketTests }, async () => {
  const dir = scratchDir()
  try {
    const tokenA = 'a'.repeat(64)
    const tokenB = 'b'.repeat(64)
    const a = await spawnFakeListener(dir, 'a', tokenA)
    const b = await spawnFakeListener(dir, 'b', tokenB)

    const registryPath = path.join(dir, 'registry.json')
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            pid: process.pid,
            terminalId: 'a',
            socketPath: a.socketPath,
            tokenPath: a.tokenPath,
            workspacePath: '/ws/a',
            startedAt: Date.now()
          },
          {
            pid: process.pid,
            terminalId: 'b',
            socketPath: b.socketPath,
            tokenPath: b.tokenPath,
            workspacePath: '/ws/b',
            startedAt: Date.now()
          }
        ]
      }),
      { mode: 0o600 }
    )

    const payload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/a' },
      cwd: '/ws/a',
      session_id: 's1'
    }
    const result = await runBridge({ registryPath, payload })
    assert.equal(result.exitCode, 0)

    // Give async socket writes a beat to settle
    await new Promise((r) => setTimeout(r, 150))

    assert.equal(a.received.length, 1, 'listener A received the payload')
    assert.equal(b.received.length, 1, 'listener B received the payload')
    assert.equal(a.received[0].auth, tokenA)
    assert.equal(b.received[0].auth, tokenB)
    assert.equal((a.received[0].frame as { tool_name: string }).tool_name, 'Read')

    await a.close()
    await b.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('cc-bridge — empty registry no-ops without crashing (exit 0)', { skip: !canRunSocketTests }, async () => {
  const dir = scratchDir()
  try {
    const registryPath = path.join(dir, 'registry.json')
    // File does not exist
    const result = await runBridge({
      registryPath,
      payload: { hook_event_name: 'Stop', session_id: 's1' }
    })
    assert.equal(result.exitCode, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('cc-bridge — stale pid entries are skipped', { skip: !canRunSocketTests }, async () => {
  const dir = scratchDir()
  try {
    const tokenLive = 'c'.repeat(64)
    const live = await spawnFakeListener(dir, 'live', tokenLive)

    const registryPath = path.join(dir, 'registry.json')
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            // Very likely dead pid
            pid: 999_999,
            terminalId: 'dead',
            socketPath: '/tmp/never-exists.sock',
            tokenPath: '/tmp/never-exists.token',
            workspacePath: '/ws',
            startedAt: 0
          },
          {
            pid: process.pid,
            terminalId: 'live',
            socketPath: live.socketPath,
            tokenPath: live.tokenPath,
            workspacePath: '/ws',
            startedAt: Date.now()
          }
        ]
      })
    )

    const result = await runBridge({
      registryPath,
      payload: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} }
    })
    assert.equal(result.exitCode, 0)
    await new Promise((r) => setTimeout(r, 150))
    assert.equal(live.received.length, 1, 'live listener still received payload despite dead entry in registry')
    await live.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('cc-bridge — malformed JSON stdin exits 0 without dispatching', { skip: !canRunSocketTests }, async () => {
  const dir = scratchDir()
  try {
    const tokenLive = 'd'.repeat(64)
    const live = await spawnFakeListener(dir, 'live', tokenLive)

    const registryPath = path.join(dir, 'registry.json')
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            pid: process.pid,
            terminalId: 'live',
            socketPath: live.socketPath,
            tokenPath: live.tokenPath,
            workspacePath: '/ws',
            startedAt: Date.now()
          }
        ]
      })
    )

    const child = spawn('node', [BRIDGE_PATH], {
      env: { ...process.env, WORKPANE_HOOK_REGISTRY: registryPath },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child.stdin?.end('{broken json')
    const code: number = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 0)))
    assert.equal(code, 0)
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(live.received.length, 0, 'no dispatch on malformed stdin')
    await live.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
