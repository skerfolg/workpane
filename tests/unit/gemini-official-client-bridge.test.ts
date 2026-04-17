import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GeminiOfficialClientBridge, GEMINI_BRIDGE_ENV_KEYS } from '../../src/main/llm/client-bridges/gemini-official-client-bridge'
import type { BridgeCommandRequest, BridgeCommandRunner } from '../../src/main/llm/client-bridges/client-bridge-types'
import { GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID } from '../../src/shared/types'

function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', 'gemini-cli', name), 'utf8')
}

function createRunner(
  output: {
    stdout?: string
    stderr?: string
    exitCode?: number | null
    timedOut?: boolean
  },
  onRun?: (request: BridgeCommandRequest) => void
): BridgeCommandRunner {
  return {
    async run(request) {
      onRun?.(request)
      return {
        stdout: output.stdout ?? '',
        stderr: output.stderr ?? '',
        exitCode: output.exitCode ?? 0,
        timedOut: output.timedOut ?? false
      }
    }
  }
}

test('connect launches the interactive gemini flow with Sign in with Google guidance', async () => {
  const bridge = new GeminiOfficialClientBridge(createRunner({}))

  const result = await bridge.connect(GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID, {
    async launch(request) {
      assert.equal(request.command, 'gemini')
      assert.deepEqual(request.args, [])
      for (const key of GEMINI_BRIDGE_ENV_KEYS) {
        assert.equal(request.env?.[key], undefined)
      }
      return { terminalId: 'gemini-terminal-1' }
    }
  })

  assert.equal(result.status, 'pending-user-action')
  assert.equal(result.terminalId, 'gemini-terminal-1')
  assert.match(result.detail ?? '', /Sign in with Google/i)
})

test('refreshState and validate use the same env-scrubbed Gemini CLI probe and recognize a success fixture', async () => {
  const originalEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GOOGLE_GENAI_USE_VERTEXAI: process.env.GOOGLE_GENAI_USE_VERTEXAI
  }
  process.env.GEMINI_API_KEY = 'gemini-key'
  process.env.GOOGLE_API_KEY = 'google-key'
  process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true'

  const requests: BridgeCommandRequest[] = []
  const bridge = new GeminiOfficialClientBridge(createRunner({
    stdout: readFixture('probe-success.json')
  }, (request) => {
    requests.push(request)
  }))

  try {
    const refreshResult = await bridge.refreshState()
    const validateResult = await bridge.validate()

    assert.equal(refreshResult.validationState.status, 'connected')
    assert.equal(validateResult.validationState.status, 'connected')
    assert.equal(refreshResult.validationState.detail, 'Validated via Gemini CLI.')
    assert.equal(validateResult.validationState.detail, 'Validated via Gemini CLI.')
    assert.equal(requests.length, 2)
    for (const request of requests) {
      assert.equal(request.command, process.platform === 'win32' ? 'gemini.cmd' : 'gemini')
      assert.deepEqual(request.args, ['-p', 'Reply with exactly the word ok.', '--output-format', 'json'])
      for (const key of GEMINI_BRIDGE_ENV_KEYS) {
        assert.equal(request.env?.[key], undefined)
      }
    }
  } finally {
    if (originalEnv.GEMINI_API_KEY === undefined) {
      delete process.env.GEMINI_API_KEY
    } else {
      process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY
    }
    if (originalEnv.GOOGLE_API_KEY === undefined) {
      delete process.env.GOOGLE_API_KEY
    } else {
      process.env.GOOGLE_API_KEY = originalEnv.GOOGLE_API_KEY
    }
    if (originalEnv.GOOGLE_GENAI_USE_VERTEXAI === undefined) {
      delete process.env.GOOGLE_GENAI_USE_VERTEXAI
    } else {
      process.env.GOOGLE_GENAI_USE_VERTEXAI = originalEnv.GOOGLE_GENAI_USE_VERTEXAI
    }
  }
})

test('refreshState maps Gemini sign-in errors to unauthenticated', async () => {
  const bridge = new GeminiOfficialClientBridge(createRunner({
    stdout: readFixture('probe-unauthenticated.json')
  }))

  const result = await bridge.refreshState()

  assert.equal(result.validationState.status, 'unauthenticated')
  assert.equal(result.validationState.detail, 'Sign in with Google to continue.')
})

test('refreshState treats unknown exit-0 JSON as bounded failure', async () => {
  const bridge = new GeminiOfficialClientBridge(createRunner({
    stdout: readFixture('probe-unknown-shape.json')
  }))

  const result = await bridge.refreshState()

  assert.equal(result.validationState.status, 'error')
  assert.equal(result.validationState.detail, 'Gemini CLI returned an unrecognized JSON response.')
})

test('classifyCause parses fixture-backed Gemini JSON and falls back token usage to 0/0 when counts are absent', async () => {
  const bridge = new GeminiOfficialClientBridge(createRunner({
    stdout: readFixture('classify-success-missing-tokens.json')
  }))

  const result = await bridge.classifyCause([
    'Created patch for auth middleware.',
    'Approve changes?',
    'Please confirm whether to apply the patch.'
  ].join('\n'))

  assert.equal(result.result.category, 'approval')
  assert.equal(result.result.summary, 'Approval needed')
  assert.equal(result.result.confidence, 'high')
  assert.equal(result.result.providerId, 'gemini')
  assert.equal(result.result.modelId, null)
  assert.equal(result.result.source, 'llm')
  assert.equal(result.inputTokens, 0)
  assert.equal(result.outputTokens, 0)
  assert.equal(result.validationState.status, 'connected')
})
