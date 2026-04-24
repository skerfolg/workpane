import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  hasAssistantErrorShape,
  hasToolResultShape,
  hasToolUseShape,
  isIngestibleAssistantEnvelope,
  matchClaudeCodeFingerprint
} from '../../src/main/l0/fingerprint'

function loadFixturePayloads(name: string): unknown[] {
  const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'cc-stream-json', name)
  return fs.readFileSync(fixturePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { payload: string })
    .map((entry) => JSON.parse(entry.payload))
}

test('assistant-success fixture contains fingerprintable assistant message', () => {
  const payload = loadFixturePayloads('assistant-success.jsonl')
    .find((entry) => isIngestibleAssistantEnvelope(entry))
  assert.ok(payload)
  const match = matchClaudeCodeFingerprint(payload)
  assert.ok(match)
  assert.equal(match.fingerprint.length, 12)
})

test('error-rate-limit fixture preserves assistant error shape', () => {
  const payload = loadFixturePayloads('error-rate-limit.jsonl')
    .find((entry) => hasAssistantErrorShape(entry))
  assert.ok(payload)
  assert.equal(hasAssistantErrorShape(payload), true)
  assert.ok(matchClaudeCodeFingerprint(payload))
})

test('tool-use fixture preserves tool_use and tool_result families', () => {
  const payloads = loadFixturePayloads('tool-use-edit.jsonl')
  const toolUse = payloads.find((entry) => hasToolUseShape(entry))
  const toolResult = payloads.find((entry) => hasToolResultShape(entry))
  assert.ok(toolUse)
  assert.ok(toolResult)
  assert.ok(matchClaudeCodeFingerprint(toolUse))
  assert.ok(matchClaudeCodeFingerprint(toolResult))
})
