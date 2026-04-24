import test from 'node:test'
import assert from 'node:assert/strict'
import { classify, type L1HookPayload } from '../../src/main/l0/l1-classifier'

/**
 * Regression tests for the Slice 0 spike Test X (L1 rule-based classifier).
 * Fixtures mirror the shapes captured at
 * spike-results/option-a/cc-hook-fixtures/win32/spike-1776986544495/
 * so future drift is caught.
 */

test('PreToolUse → approval-pending with yellow overlay', () => {
  const payload: L1HookPayload = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: 'D:/4. Workspace/PromptManager/package.json' },
    session_id: 'abc-123',
    permission_mode: 'default'
  }

  const result = classify(payload)

  assert.equal(result.category, 'approval-pending')
  assert.equal(result.severity, 'high')
  assert.equal(result.user_action_required, true)
  assert.equal(result.summary, 'Approval needed: Read')
  assert.equal(result.ui_hint.panel_border, 'yellow')
  assert.equal(result.ui_hint.overlay, true)
  assert.equal(result.detail.tool, 'Read')
  assert.equal(result.detail.input_preview, 'file_path: D:/4. Workspace/PromptManager/package.json')
})

test('PostToolUse (success) → tool-completed with green border', () => {
  const payload: L1HookPayload = {
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/x.txt' },
    tool_response: { type: 'text', file: { numLines: 42 }, is_error: false },
    session_id: 'abc-123'
  }

  const result = classify(payload)

  assert.equal(result.category, 'tool-completed')
  assert.equal(result.severity, 'info')
  assert.equal(result.user_action_required, false)
  assert.equal(result.summary, 'Read completed')
  assert.equal(result.ui_hint.panel_border, 'green')
  assert.equal(result.ui_hint.overlay, false)
  assert.equal(result.detail.response_summary, 'file read, 42 lines')
})

test('PostToolUse (error) → tool-completed with red border and error severity', () => {
  const payload: L1HookPayload = {
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'exit 1' },
    tool_response: { is_error: true, content: 'command failed with exit code 1' },
    session_id: 'abc-123'
  }

  const result = classify(payload)

  assert.equal(result.category, 'tool-completed')
  assert.equal(result.severity, 'error')
  assert.equal(result.summary, 'Bash completed with error')
  assert.equal(result.ui_hint.panel_border, 'red')
  const responseSummary = result.detail.response_summary
  assert.ok(typeof responseSummary === 'string' && responseSummary.startsWith('ERROR:'))
})

test('SessionStart → lifecycle:session-start with ready badge', () => {
  const payload: L1HookPayload = {
    hook_event_name: 'SessionStart',
    session_id: 'abc-123',
    cwd: 'D:/workspace'
  }

  const result = classify(payload)

  assert.equal(result.category, 'lifecycle:session-start')
  assert.equal(result.severity, 'info')
  assert.equal(result.user_action_required, false)
  assert.equal(result.summary, 'Session started')
  assert.equal(result.ui_hint.badge, 'L0 ready')
  assert.equal(result.detail.cwd, 'D:/workspace')
})

test('SessionEnd → lifecycle:session-end with reason in detail', () => {
  const payload: L1HookPayload = {
    hook_event_name: 'SessionEnd',
    session_id: 'abc-123',
    reason: 'clear'
  }

  const result = classify(payload)

  assert.equal(result.category, 'lifecycle:session-end')
  assert.equal(result.summary, 'Session ended')
  assert.equal(result.detail.reason, 'clear')
})

test('Stop → lifecycle:stop', () => {
  const result = classify({ hook_event_name: 'Stop', session_id: 'abc-123' })
  assert.equal(result.category, 'lifecycle:stop')
  assert.equal(result.summary, 'Assistant turn completed')
})

test('UserPromptSubmit → lifecycle:user-input with prompt preview truncated', () => {
  const longPrompt = 'x'.repeat(500)
  const result = classify({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'abc-123',
    prompt: longPrompt
  })
  assert.equal(result.category, 'lifecycle:user-input')
  assert.equal(result.detail.prompt_preview, 'x'.repeat(100))
})

test('Unknown hook event → unknown category with warn severity', () => {
  const result = classify({ hook_event_name: 'MysteryEvent' } as L1HookPayload)
  assert.equal(result.category, 'unknown')
  assert.equal(result.severity, 'warn')
  assert.equal(result.user_action_required, false)
  assert.equal(result.summary, 'Unknown hook event: MysteryEvent')
})

test('Missing hook_event_name → unknown', () => {
  const result = classify({} as L1HookPayload)
  assert.equal(result.category, 'unknown')
  assert.equal(result.summary, 'Unknown hook event: unknown')
})

test('summarizeToolInput handles Bash command truncation at 80 chars', () => {
  const longCmd = 'echo ' + 'a'.repeat(100)
  const result = classify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: longCmd },
    session_id: 'abc'
  })
  const preview = result.detail.input_preview
  assert.ok(typeof preview === 'string')
  assert.ok(preview.endsWith('...'))
  assert.ok(preview.length <= 'command: '.length + 80 + '...'.length)
})

test('summarizeToolInput default case lists up to 3 keys with ellipsis', () => {
  const result = classify({
    hook_event_name: 'PreToolUse',
    tool_name: 'CustomTool',
    tool_input: { a: 1, b: 2, c: 3, d: 4, e: 5 },
    session_id: 'abc'
  })
  assert.equal(result.detail.input_preview, 'a, b, c, ...')
})

test('Spike Test X — 6/6 categories covered without API', () => {
  // The spike captured 7 payloads spanning all 6 active categories + approval-pending.
  // This test asserts the classifier can produce every category without any
  // network / API call (L1 scoping invariant, Plan v3 R6 mitigation).
  const samples: Array<[L1HookPayload, string]> = [
    [{ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'x' } }, 'approval-pending'],
    [{ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: { type: 'text' } }, 'tool-completed'],
    [{ hook_event_name: 'SessionStart' }, 'lifecycle:session-start'],
    [{ hook_event_name: 'SessionEnd' }, 'lifecycle:session-end'],
    [{ hook_event_name: 'Stop' }, 'lifecycle:stop'],
    [{ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }, 'lifecycle:user-input']
  ]

  const categories = new Set(samples.map(([payload, _expected]) => classify(payload).category))
  assert.equal(categories.size, 6)
  for (const [payload, expected] of samples) {
    assert.equal(classify(payload).category, expected)
  }
})
