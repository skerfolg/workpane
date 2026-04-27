import test from 'node:test'
import assert from 'node:assert/strict'
import { TerminalManager } from '../../src/main/terminal-manager'
import type { L0Pipeline } from '../../src/main/l0/pipeline'

/**
 * Slice 2.6 — vendor auto-detect from stdout banner.
 *
 * Why these tests exist
 * --------------------
 * The renderer doesn't pass `vendorHint='claude-code'` when creating
 * terminals (no UI surfaces explicit vendor selection). Slice 1+2 wired
 * the L0 runtime to fire onClaudeBind when vendor === 'claude-code',
 * so without auto-detection HookServer never starts and cc-bridge
 * dispatches all hook payloads to "no active listeners".
 *
 * The auto-detect runs on appendToBuffer, watches the first ~4KB of
 * stdout, and matches the CC boot banner. On hit it backfills the
 * vendor hint + fires onClaudeBind exactly as if the renderer had
 * passed it at spawn time.
 */

interface BindCall {
  terminalId: string
  workspacePath: string
}

function makeManagerWithRecorder(): {
  manager: TerminalManager
  bindCalls: BindCall[]
  closeCalls: string[]
  pipelineBindVendor: Array<{ id: string; vendor: string | undefined }>
} {
  const manager = new TerminalManager()
  const bindCalls: BindCall[] = []
  const closeCalls: string[] = []
  const pipelineBindVendor: Array<{ id: string; vendor: string | undefined }> = []

  // Minimal pipeline mock — only bindVendor + ingest are touched on the
  // appendToBuffer path that auto-detect runs through.
  const pipeline = {
    bindVendor: (id: string, vendor: string | undefined): void => {
      pipelineBindVendor.push({ id, vendor })
    },
    ingest: (): { suppressApprovalDetector: boolean } => ({ suppressApprovalDetector: false }),
    reset: (): void => {}
  } as unknown as L0Pipeline

  manager.setL0Pipeline(pipeline)
  manager.setL0RuntimeHooks({
    onClaudeBind: ({ terminalId, workspacePath }) => {
      bindCalls.push({ terminalId, workspacePath })
    },
    onTerminalClose: (terminalId) => {
      closeCalls.push(terminalId)
    }
  })

  return { manager, bindCalls, closeCalls, pipelineBindVendor }
}

// Inject a workspace path so the auto-detector has something to forward
// as workspacePath to onClaudeBind. TerminalManager exposes `getWorkspace`
// publicly; we set the private map via type assertion to avoid having to
// run a real spawn() in unit tests.
function seedWorkspace(manager: TerminalManager, id: string, cwd: string): void {
  ;(manager as unknown as { terminalWorkspaces: Map<string, string> }).terminalWorkspaces.set(id, cwd)
}

test('vendor auto-detect — CC banner triggers onClaudeBind once', () => {
  const { manager, bindCalls, pipelineBindVendor } = makeManagerWithRecorder()
  const id = 't1'
  seedWorkspace(manager, id, 'D:\\projects\\demo')

  manager.appendToBuffer(
    id,
    'Claude Code v2.1.119\nOpus 4.7 (1M context) · Claude Max\nD:\\projects\\demo\n'
  )

  assert.equal(bindCalls.length, 1)
  assert.equal(bindCalls[0].terminalId, id)
  assert.equal(bindCalls[0].workspacePath, 'D:\\projects\\demo')
  assert.equal(manager.getVendorHint(id), 'claude-code')
  assert.deepEqual(pipelineBindVendor, [{ id, vendor: 'claude-code' }])
})

test('vendor auto-detect — banner with ANSI escape codes still matches', () => {
  const { manager, bindCalls } = makeManagerWithRecorder()
  const id = 't2'
  seedWorkspace(manager, id, '/home/u/proj')

  // CC actually sends bold + color CSI codes around its banner.
  // eslint-disable-next-line no-control-regex
  const ansiBanner = '\x1b[1mClaude Code\x1b[0m \x1b[36mv2.1.119\x1b[0m\nOpus 4.7\n'
  manager.appendToBuffer(id, ansiBanner)

  assert.equal(bindCalls.length, 1)
  assert.equal(manager.getVendorHint(id), 'claude-code')
})

test('vendor auto-detect — banner split across multiple appends still matches', () => {
  const { manager, bindCalls } = makeManagerWithRecorder()
  const id = 't3'
  seedWorkspace(manager, id, '.')

  manager.appendToBuffer(id, 'Claude Code')
  assert.equal(bindCalls.length, 0, 'partial match must not fire yet')
  manager.appendToBuffer(id, ' v2.1.119\nOpus 4.7\n')
  assert.equal(bindCalls.length, 1)
  assert.equal(manager.getVendorHint(id), 'claude-code')
})

test('vendor auto-detect — fires only once even if banner appears multiple times', () => {
  const { manager, bindCalls } = makeManagerWithRecorder()
  const id = 't4'
  seedWorkspace(manager, id, '.')

  manager.appendToBuffer(id, 'Claude Code v2.1.119\nfoo\n')
  manager.appendToBuffer(id, 'Claude Code v2.2.0\nbar\n')

  assert.equal(bindCalls.length, 1, 'second banner must not refire onClaudeBind')
})

test('vendor auto-detect — non-CC stdout never sets the vendor', () => {
  const { manager, bindCalls } = makeManagerWithRecorder()
  const id = 't5'
  seedWorkspace(manager, id, '.')

  manager.appendToBuffer(id, '$ npm run build\n> tsc -p .\n  done\n')
  manager.appendToBuffer(id, '$ ls\nREADME.md\nsrc\ntests\n')

  assert.equal(bindCalls.length, 0)
  assert.equal(manager.getVendorHint(id), undefined)
})

test('vendor auto-detect — gives up after the buffer cap (no banner in first ~4KB)', () => {
  const { manager, bindCalls } = makeManagerWithRecorder()
  const id = 't6'
  seedWorkspace(manager, id, '.')

  // Push past the 4KB cap with non-banner output.
  const chunk = 'a'.repeat(2048)
  manager.appendToBuffer(id, chunk)
  manager.appendToBuffer(id, chunk)
  // One more byte to overflow the cap.
  manager.appendToBuffer(id, '!')

  // Even if a banner now appears, auto-detect has been disabled for this id.
  manager.appendToBuffer(id, 'Claude Code v2.1.119\n')

  assert.equal(bindCalls.length, 0)
  assert.equal(manager.getVendorHint(id), undefined)
})

test('vendor auto-detect — skipped when vendor was already set explicitly', () => {
  const { manager, bindCalls } = makeManagerWithRecorder()
  const id = 't7'
  // Simulate an explicit hint having been set before any output arrives.
  ;(manager as unknown as { terminalVendorHints: Map<string, string> }).terminalVendorHints.set(
    id,
    'codex'
  )
  seedWorkspace(manager, id, '.')

  manager.appendToBuffer(id, 'Claude Code v2.1.119\n')

  // Already non-claude vendor, auto-detect must not silently overwrite it.
  assert.equal(manager.getVendorHint(id), 'codex')
  assert.equal(bindCalls.length, 0)
})

test('vendor auto-detect — uses workspace path captured at first chunk', () => {
  const { manager, bindCalls } = makeManagerWithRecorder()
  const id = 't8'
  seedWorkspace(manager, id, 'C:\\Users\\me\\repo')

  manager.appendToBuffer(id, 'Claude Code v2.1.119\n')

  assert.equal(bindCalls.length, 1)
  assert.equal(bindCalls[0].workspacePath, 'C:\\Users\\me\\repo')
})

// Slice 2.7 — explicit vendor selection via setVendor(). This is the
// reliable primary path because CC TUI uses cell-positioning that the
// banner-regex auto-detect cannot recover from a raw stream.

function injectFakeTerminal(manager: TerminalManager, id: string): void {
  // setVendor returns false if `terminals.has(id)` is false, so seed a
  // sentinel object — only its presence in the map is checked.
  ;(manager as unknown as { terminals: Map<string, unknown> }).terminals.set(id, {
    write: () => {},
    resize: () => {},
    kill: () => {},
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} })
  })
}

test('setVendor — claude-code on a known terminal fires onClaudeBind once', () => {
  const { manager, bindCalls, pipelineBindVendor } = makeManagerWithRecorder()
  const id = 's1'
  injectFakeTerminal(manager, id)
  seedWorkspace(manager, id, 'D:\\proj')

  const ok = manager.setVendor(id, 'claude-code')

  assert.equal(ok, true)
  assert.equal(manager.getVendorHint(id), 'claude-code')
  assert.deepEqual(pipelineBindVendor, [{ id, vendor: 'claude-code' }])
  assert.equal(bindCalls.length, 1)
  assert.equal(bindCalls[0].terminalId, id)
  assert.equal(bindCalls[0].workspacePath, 'D:\\proj')
})

test('setVendor — unknown terminal returns false, fires nothing', () => {
  const { manager, bindCalls, pipelineBindVendor } = makeManagerWithRecorder()
  const ok = manager.setVendor('does-not-exist', 'claude-code')
  assert.equal(ok, false)
  assert.equal(bindCalls.length, 0)
  assert.equal(pipelineBindVendor.length, 0)
})

test('setVendor — same vendor twice is idempotent (no second onClaudeBind)', () => {
  const { manager, bindCalls } = makeManagerWithRecorder()
  const id = 's3'
  injectFakeTerminal(manager, id)
  seedWorkspace(manager, id, '.')

  assert.equal(manager.setVendor(id, 'claude-code'), true)
  assert.equal(manager.setVendor(id, 'claude-code'), true)

  assert.equal(bindCalls.length, 1, 'second call must not refire')
})

test('setVendor — refuses to overwrite a different prior vendor', () => {
  const { manager, bindCalls } = makeManagerWithRecorder()
  const id = 's4'
  injectFakeTerminal(manager, id)
  seedWorkspace(manager, id, '.')

  // L0Vendor is currently union of one ('claude-code'). To simulate a
  // pre-existing different vendor, seed the internal map directly with a
  // sentinel string. setVendor must refuse to overwrite it.
  ;(manager as unknown as { terminalVendorHints: Map<string, string> }).terminalVendorHints.set(
    id,
    'sentinel-other'
  )
  assert.equal(manager.setVendor(id, 'claude-code'), false)
  assert.equal(
    (manager as unknown as { terminalVendorHints: Map<string, string> }).terminalVendorHints.get(id),
    'sentinel-other'
  )
  assert.equal(bindCalls.length, 0, 'must not fire onClaudeBind on refused overwrite')
})

test('setVendor — short-circuits subsequent banner auto-detect probing', () => {
  const { manager, bindCalls } = makeManagerWithRecorder()
  const id = 's5'
  injectFakeTerminal(manager, id)
  seedWorkspace(manager, id, '.')

  manager.setVendor(id, 'claude-code')
  assert.equal(bindCalls.length, 1)

  // After explicit mark, subsequent stdout (even with a banner) must NOT
  // refire onClaudeBind via auto-detect — the per-id flag is set.
  manager.appendToBuffer(id, 'Claude Code v2.1.119\nfoo\n')
  assert.equal(bindCalls.length, 1)
})
