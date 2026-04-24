import test from 'node:test'
import assert from 'node:assert/strict'
import { L0Pipeline } from '../../src/main/l0/pipeline'

function buildPipeline(boundTerminals: string[] = ['terminal-1']) {
  const upserts: Array<{ source: string; summary: string; category: string }> = []
  const pipeline = new L0Pipeline((state) => {
    upserts.push({
      source: state.source,
      summary: state.summary,
      category: state.category
    })
  })
  for (const id of boundTerminals) {
    pipeline.bindVendor(id, 'claude-code')
  }
  return { pipeline, upserts }
}

test('tool_use emits vendor event and suppresses approval detector', () => {
  const { pipeline, upserts } = buildPipeline()

  const result = pipeline.ingest(
    'terminal-1',
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-22T08:00:00.000Z',
      message: {
        role: 'assistant',
        type: 'message',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'Edit',
            input: { path: 'file.ts' }
          }
        ]
      }
    }) + '\n',
    'D:/workspace/demo'
  )

  assert.equal(result.suppressApprovalDetector, true)
  assert.equal(result.emittedEvents, 1)
  assert.equal(upserts.length, 1)
  assert.equal(upserts[0].source, 'l0-vendor-event')
  assert.equal(upserts[0].category, 'approval')
})

test('plain assistant message suppresses approval detector without emitting monitoring state', () => {
  const { pipeline, upserts } = buildPipeline()

  const result = pipeline.ingest(
    'terminal-1',
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-22T08:00:00.000Z',
      message: {
        role: 'assistant',
        type: 'message',
        content: [
          {
            type: 'text',
            text: 'ACK'
          }
        ]
      }
    }) + '\n',
    'D:/workspace/demo'
  )

  assert.equal(result.suppressApprovalDetector, true)
  assert.equal(result.emittedEvents, 0)
  assert.equal(upserts.length, 0)
})

test('assistant error emits error category with vendor-event source', () => {
  const { pipeline, upserts } = buildPipeline()

  const result = pipeline.ingest(
    'terminal-1',
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-22T08:00:00.000Z',
      error: 'rate_limit',
      message: {
        role: 'assistant',
        type: 'message',
        content: [
          {
            type: 'text',
            text: "You've hit your limit · resets 6pm (Asia/Seoul)"
          }
        ]
      }
    }) + '\n',
    'D:/workspace/demo'
  )

  assert.equal(result.suppressApprovalDetector, true)
  assert.equal(result.emittedEvents, 1)
  assert.equal(upserts[0]?.category, 'error')
  assert.equal(upserts[0]?.source, 'l0-vendor-event')
})

test('multi-session state is isolated per terminal', () => {
  const { pipeline, upserts } = buildPipeline(['terminal-a', 'terminal-b'])

  const first = pipeline.ingest(
    'terminal-a',
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-22T08:00:00.000Z',
      message: {
        role: 'assistant',
        type: 'message',
        content: [{ type: 'tool_use', id: 'toolu_a', name: 'Edit' }]
      }
    }) + '\n',
    'D:/workspace/a'
  )
  const second = pipeline.ingest(
    'terminal-b',
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-22T08:00:01.000Z',
      error: 'authentication_failed',
      message: {
        role: 'assistant',
        type: 'message',
        content: [{ type: 'text', text: 'Not logged in · Please run /login' }]
      }
    }) + '\n',
    'D:/workspace/b'
  )

  assert.equal(first.emittedEvents, 1)
  assert.equal(second.emittedEvents, 1)
  assert.equal(upserts.length, 2)
  assert.notEqual(upserts[0].summary, upserts[1].summary)
})

test('getStatus reports inactive when terminal has no vendor binding', () => {
  const pipeline = new L0Pipeline(() => undefined)
  const status = pipeline.getStatus('terminal-x')
  assert.equal(status.mode, 'inactive')
  assert.equal(status.vendor, undefined)
})

test('bindVendor without ingest yields awaiting-first-event status', () => {
  const pipeline = new L0Pipeline(() => undefined)
  pipeline.bindVendor('terminal-1', 'claude-code')
  const status = pipeline.getStatus('terminal-1')
  assert.equal(status.mode, 'awaiting-first-event')
  assert.equal(status.vendor, 'claude-code')
})

test('getStatus transitions to active after a fingerprintable event', () => {
  const { pipeline } = buildPipeline()
  pipeline.ingest(
    'terminal-1',
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-22T08:00:00.000Z',
      message: {
        role: 'assistant',
        type: 'message',
        content: [{ type: 'tool_use', id: 'toolu_x', name: 'Edit' }]
      }
    }) + '\n',
    'D:/workspace/demo'
  )
  const status = pipeline.getStatus('terminal-1')
  assert.equal(status.mode, 'active')
  assert.ok(status.fingerprint)
})

test('ingest on unbound terminal is a no-op with no suppression', () => {
  const upserts: number[] = []
  const pipeline = new L0Pipeline(() => upserts.push(1))
  const result = pipeline.ingest(
    'terminal-unbound',
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', type: 'message', content: [] } }) + '\n',
    'D:/workspace/demo'
  )
  assert.equal(result.emittedEvents, 0)
  assert.equal(result.suppressApprovalDetector, false)
  assert.equal(upserts.length, 0)
  assert.equal(pipeline.getStatus('terminal-unbound').mode, 'inactive')
})

test('onStatusChanged fires on bind and on mode transitions', () => {
  const events: Array<{ id: string; mode: string }> = []
  const pipeline = new L0Pipeline(() => undefined)
  pipeline.onStatusChanged((status) => events.push({ id: status.terminalId, mode: status.mode }))
  pipeline.bindVendor('terminal-1', 'claude-code')
  pipeline.ingest(
    'terminal-1',
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-22T08:00:00.000Z',
      message: {
        role: 'assistant',
        type: 'message',
        content: [{ type: 'tool_use', id: 'toolu_y', name: 'Bash' }]
      }
    }) + '\n',
    'D:/workspace/demo'
  )
  // Expect at least: awaiting-first-event (bind) → active (first ingest)
  const modes = events.filter((e) => e.id === 'terminal-1').map((e) => e.mode)
  assert.ok(modes.includes('awaiting-first-event'))
  assert.ok(modes.includes('active'))
})
