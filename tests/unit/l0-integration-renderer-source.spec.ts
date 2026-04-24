import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatMonitoringDisplay,
  selectTerminalMonitoringIndicator,
  createMonitoringState,
  monitoringStateReducer
} from '../../src/renderer/src/contexts/monitoring-state'

test('renderer copy treats l0 vendor events as direct high-precision signals', () => {
  const entry = {
    terminalId: 'terminal-1',
    workspacePath: 'D:/workspace/demo',
    patternName: 'claude-code:tool-use-pending',
    matchedText: 'Edit',
    status: 'attention-needed' as const,
    cause: 'approval' as const,
    confidence: 'high' as const,
    source: 'l0-vendor-event' as const,
    summary: 'Edit requested by Claude Code',
    updatedAt: Date.now()
  }

  const display = formatMonitoringDisplay(entry)
  assert.equal(display.headline, 'Approval needed')
  assert.equal(display.meta, 'vendor event · high precision')

  const state = monitoringStateReducer(createMonitoringState(), {
    type: 'upsert',
    entry
  })
  const indicator = selectTerminalMonitoringIndicator(state, entry.terminalId)
  assert.ok(indicator)
  assert.equal(indicator?.tone, 'direct')
  assert.match(indicator?.title ?? '', /vendor event · high precision/)
})
