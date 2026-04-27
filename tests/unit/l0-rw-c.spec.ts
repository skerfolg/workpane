import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveEventKey, EventDedupWindow } from '../../src/main/l0/event-key'
import { CcHookAdapter } from '../../src/main/l0/adapters/cc-hook-adapter'
import { CcSessionLogAdapter } from '../../src/main/l0/adapters/cc-session-log-adapter'
import { CcStreamJsonAdapter } from '../../src/main/l0/adapters/cc-stream-json-adapter'
import { L0Pipeline } from '../../src/main/l0/pipeline'
import { l0Telemetry } from '../../src/main/l0/telemetry'
import type { L0Event } from '../../src/shared/types'

/**
 * RW-C — event dedup key derivation + cross-source invariance.
 */

function makeEvent(overrides: Partial<L0Event> & Pick<L0Event, 'rawPayload'>): L0Event {
  return {
    terminalId: 't1',
    vendor: 'claude-code',
    schemaFingerprint: 'cc:test',
    eventKind: 'tool-use-pending',
    observedAt: 1_000,
    category: 'approval',
    summary: 'Read',
    matchedText: 'Read',
    ...overrides
  }
}

test('deriveEventKey — tier id when a tool_result error envelope exposes id and content-tier is not applicable', () => {
  const result = deriveEventKey(
    makeEvent({
      eventKind: 'error',
      rawPayload: {
        type: 'user',
        message: {
          role: 'user',
          type: 'message',
          content: [{ type: 'tool_result', id: 'toolu_result_XYZ', is_error: true, content: 'boom' }]
        }
      }
    })
  )
  assert.equal(result.tier, 'id')
  assert.ok(result.key.includes('toolu_result_XYZ'))
})

test('deriveEventKey — tool-use events use content tier even when session-log supplies an id', () => {
  const hookEvent = makeEvent({
    rawPayload: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a' } }
  })
  const sessionEvent = makeEvent({
    rawPayload: {
      type: 'assistant',
      message: {
        role: 'assistant',
        type: 'message',
        content: [{ type: 'tool_use', id: 'toolu_XYZ', name: 'Read', input: { file_path: '/a' } }]
      }
    }
  })
  const hookResult = deriveEventKey(hookEvent)
  const sessionResult = deriveEventKey(sessionEvent)
  assert.equal(hookResult.tier, 'content')
  assert.equal(sessionResult.tier, 'content', 'session-log tool-use uses content tier so it collides with hook')
  assert.equal(hookResult.key, sessionResult.key)
})

test('deriveEventKey — tier content when hook payload has tool_name + input but no id', () => {
  const result = deriveEventKey(
    makeEvent({
      rawPayload: {
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/a' }
      }
    })
  )
  assert.equal(result.tier, 'content')
})

test('deriveEventKey — hook and session-log produce identical content key for same tool call', () => {
  const hookEvent = makeEvent({
    rawPayload: {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/x', old_string: 'a', new_string: 'b' }
    }
  })
  const sessionEvent = makeEvent({
    rawPayload: {
      type: 'assistant',
      message: {
        role: 'assistant',
        type: 'message',
        content: [
          { type: 'tool_use', name: 'Edit', input: { file_path: '/x', old_string: 'a', new_string: 'b' } }
        ]
      }
    }
  })
  const hookKey = deriveEventKey(hookEvent).key
  const sessionKey = deriveEventKey(sessionEvent).key
  assert.equal(
    hookKey,
    sessionKey,
    'same logical tool call yields the same key regardless of source shape'
  )
})

test('deriveEventKey — canonical-json is key-order-invariant', () => {
  const left = makeEvent({
    rawPayload: {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { a: 1, b: 2, c: 3 }
    }
  })
  const right = makeEvent({
    rawPayload: {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { c: 3, a: 1, b: 2 }
    }
  })
  assert.equal(deriveEventKey(left).key, deriveEventKey(right).key)
})

test('deriveEventKey — kind-time fallback for lifecycle / error events', () => {
  const result = deriveEventKey(
    makeEvent({
      eventKind: 'error',
      summary: 'Tool execution returned an error',
      rawPayload: { hook_event_name: 'PostToolUse', tool_response: { is_error: true } },
      observedAt: 12_345
    })
  )
  assert.equal(result.tier, 'kind-time')
})

test('deriveEventKey — distinct tool names never collide in content tier', () => {
  const a = deriveEventKey(
    makeEvent({
      rawPayload: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { x: 1 } }
    })
  )
  const b = deriveEventKey(
    makeEvent({
      rawPayload: { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { x: 1 } }
    })
  )
  assert.notEqual(a.key, b.key)
})

test('EventDedupWindow — second emit within window returns false', () => {
  const w = new EventDedupWindow(2_000)
  assert.equal(w.shouldEmit('t1', 'k1', 1_000), true)
  assert.equal(w.shouldEmit('t1', 'k1', 1_500), false)
  assert.equal(w.shouldEmit('t1', 'k1', 3_500), true)
})

test('EventDedupWindow — different terminals do not interfere', () => {
  const w = new EventDedupWindow(2_000)
  assert.equal(w.shouldEmit('t1', 'k', 1_000), true)
  assert.equal(w.shouldEmit('t2', 'k', 1_500), true)
})

test('EventDedupWindow — clearTerminal drops the map entries for that terminal', () => {
  const w = new EventDedupWindow(2_000)
  w.shouldEmit('t1', 'a', 1_000)
  w.shouldEmit('t1', 'b', 1_000)
  w.clearTerminal('t1')
  assert.equal(w.sizeForTest, 0)
  assert.equal(w.shouldEmit('t1', 'a', 1_500), true)
})

test('L0Pipeline — integration: session log then hook for same tool call emits only once', () => {
  l0Telemetry.reset()
  const upserts: Array<{ summary: string }> = []
  const stdout = new CcStreamJsonAdapter()
  const pipeline = new L0Pipeline(stdout, (state) => upserts.push({ summary: state.summary }))
  pipeline.bindVendor('t1', 'claude-code')

  const sessionAdapter = new CcSessionLogAdapter()
  const hookAdapter = new CcHookAdapter()

  // Simulate session-log arriving first (normally it lags, but the
  // dedup must be source-order agnostic)
  pipeline.setAdapterFor('t1', sessionAdapter, 'session-log')
  pipeline.ingest(
    't1',
    {
      type: 'assistant',
      timestamp: '2026-04-24T00:00:00.000Z',
      message: {
        role: 'assistant',
        type: 'message',
        content: [{ type: 'tool_use', name: 'Read', id: 'tu-1', input: { file_path: '/a' } }]
      }
    },
    '/ws',
    'session-log'
  )

  pipeline.setAdapterFor('t1', hookAdapter, 'hook')
  pipeline.ingest(
    't1',
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/a' },
      session_id: 's1'
    },
    '/ws',
    'hook'
  )

  assert.equal(upserts.length, 1, 'only one monitoring update despite two source ingests')
  const stats = l0Telemetry.getDedupStats()
  assert.ok(stats.droppedBySource.hook >= 1, 'hook duplicate counted')
})

test('L0Pipeline — two distinct tool calls emit two events', () => {
  l0Telemetry.reset()
  const upserts: string[] = []
  const stdout = new CcStreamJsonAdapter()
  const pipeline = new L0Pipeline(stdout, (state) => upserts.push(state.summary))
  pipeline.bindVendor('t1', 'claude-code')
  pipeline.setAdapterFor('t1', new CcHookAdapter(), 'hook')

  pipeline.ingest(
    't1',
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a' } },
    '/ws',
    'hook'
  )
  pipeline.ingest(
    't1',
    { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/b' } },
    '/ws',
    'hook'
  )
  assert.equal(upserts.length, 2)
})

test('L0Pipeline — same-tool same-input same-terminal within 2s collapses (accepted tradeoff)', () => {
  l0Telemetry.reset()
  const upserts: string[] = []
  const stdout = new CcStreamJsonAdapter()
  const pipeline = new L0Pipeline(stdout, (state) => upserts.push(state.summary))
  pipeline.bindVendor('t1', 'claude-code')
  pipeline.setAdapterFor('t1', new CcHookAdapter(), 'hook')

  pipeline.ingest(
    't1',
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a' } },
    '/ws',
    'hook'
  )
  pipeline.ingest(
    't1',
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a' } },
    '/ws',
    'hook'
  )
  assert.equal(upserts.length, 1, 'documented tradeoff — identical call within 2s collapses')
})

test('l0Telemetry.getDedupStats — fallback rate reflects tier distribution', () => {
  l0Telemetry.reset()
  l0Telemetry.recordDedupKeyTier('id')
  l0Telemetry.recordDedupKeyTier('id')
  l0Telemetry.recordDedupKeyTier('content')
  l0Telemetry.recordDedupKeyTier('kind-time')
  const stats = l0Telemetry.getDedupStats()
  assert.equal(stats.keyTier.id, 2)
  assert.equal(stats.keyTier.content, 1)
  assert.equal(stats.keyTier['kind-time'], 1)
  assert.ok(Math.abs(stats.fallbackRate - 0.5) < 1e-9)
})
