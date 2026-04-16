import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAiOfficialClientBridge } from '../../src/main/llm/client-bridges/openai-official-client-bridge'
import type { BridgeCommandRunner } from '../../src/main/llm/client-bridges/client-bridge-types'

function createRunner(output: {
  stdout?: string
  stderr?: string
  exitCode?: number | null
  timedOut?: boolean
}): BridgeCommandRunner {
  return {
    async run() {
      return {
        stdout: output.stdout ?? '',
        stderr: output.stderr ?? '',
        exitCode: output.exitCode ?? 0,
        timedOut: output.timedOut ?? false
      }
    }
  }
}

test('refreshState treats "Not logged in" as unauthenticated, not connected', async () => {
  const bridge = new OpenAiOfficialClientBridge(createRunner({
    stdout: 'Not logged in'
  }))

  const result = await bridge.refreshState()

  assert.equal(result.validationState.status, 'unauthenticated')
  assert.equal(result.validationState.detail, 'Not logged in')
  assert.match(result.validationState.lastValidatedAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
})

test('validate matches refreshState unauthenticated classification for "Not logged in" output', async () => {
  const bridge = new OpenAiOfficialClientBridge(createRunner({
    stdout: 'Not logged in'
  }))

  const refreshResult = await bridge.refreshState()
  const validateResult = await bridge.validate()

  assert.equal(refreshResult.validationState.status, 'unauthenticated')
  assert.equal(validateResult.validationState.status, 'unauthenticated')
  assert.equal(validateResult.validationState.detail, 'Not logged in')
  assert.match(validateResult.validationState.lastValidatedAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
})

test('classifyCause parses only the final assistant payload into the live classification schema', async () => {
  const bridge = new OpenAiOfficialClientBridge(createRunner({
    stdout: [
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          content: [{ text: 'ignore this earlier payload' }]
        }
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          content: [{ text: '{"category":"approval","summary":"Approval needed","confidence":"high"}' }]
        }
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 12,
          output_tokens: 4
        }
      })
    ].join('\n')
  }))

  const result = await bridge.classifyCause([
    'Created patch for auth middleware.',
    'Approve changes?',
    'Please confirm whether to apply the patch.'
  ].join('\n'))

  assert.equal(result.result.category, 'approval')
  assert.equal(result.result.summary, 'Approval needed')
  assert.equal(result.result.confidence, 'high')
  assert.equal(result.result.providerId, 'openai')
  assert.equal(result.result.modelId, null)
  assert.equal(result.result.source, 'llm')
  assert.equal(result.inputTokens, 12)
  assert.equal(result.outputTokens, 4)
  assert.equal(result.validationState.status, 'connected')
})
