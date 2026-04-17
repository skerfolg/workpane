import type { LlmCauseCategory, LlmClassificationResult, LlmLaneConnectResult, LlmValidationState } from '../../../shared/types'
import { GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID } from '../../../shared/types'
import type {
  BridgeClassificationResult,
  BridgeCommandRunner,
  BridgeConnectHooks,
  BridgeStateRefreshResult,
  BridgeValidationResult,
  OfficialClientBridge
} from './client-bridge-types'
import {
  buildValidationState,
  DEFAULT_TIMEOUT_MS,
  DefaultBridgeCommandRunner,
  mapBridgeError,
  SUPPORTED_PLATFORMS,
  UnsupportedPlatformError
} from './bridge-command-runner'

export const GEMINI_BRIDGE_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENAI_USE_VERTEXAI'
] as const

type GeminiJsonRecord = Record<string, unknown>

function normalizeCategory(value: string): LlmCauseCategory {
  if (value === 'approval' || value === 'input-needed' || value === 'error') {
    return value
  }
  return 'unknown'
}

function normalizeConfidence(value: unknown): LlmClassificationResult['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low'
}

function buildRecentOutputExcerpt(recentOutput: string): string {
  return recentOutput.split(/\r?\n/).filter(Boolean).slice(-6).join('\n')
}

function buildClassificationPrompt(recentOutput: string): string {
  return [
    'Classify the likely cause of this stalled terminal session.',
    'Return JSON only with keys: category, summary, confidence.',
    'Valid category values: approval, input-needed, error, unknown.',
    'Valid confidence values: low, medium, high.',
    'Keep summary under 140 characters.',
    '',
    recentOutput
  ].join('\n')
}

function getGeminiExecutable(): string {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    throw new UnsupportedPlatformError(`Unsupported platform: ${process.platform}`)
  }
  return process.platform === 'win32' ? 'gemini.cmd' : 'gemini'
}

function buildGeminiBridgeEnv(): NodeJS.ProcessEnv {
  const env = { ...(process.env as NodeJS.ProcessEnv) }
  for (const key of GEMINI_BRIDGE_ENV_KEYS) {
    delete env[key]
  }
  return env
}

function buildProbeArgs(prompt: string): string[] {
  return ['-p', prompt, '--output-format', 'json']
}

function parseGeminiJson(rawOutput: string): GeminiJsonRecord | null {
  const trimmed = rawOutput.trim()
  if (!trimmed) {
    return null
  }

  const candidates = [trimmed, ...trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse()]
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) {
      continue
    }
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as GeminiJsonRecord
      }
    } catch {
      continue
    }
  }

  return null
}

function extractErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null
  }
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as GeminiJsonRecord
  const message = record.message
  if (typeof message === 'string' && message.trim()) {
    return message.trim()
  }

  const code = typeof record.code === 'string' ? record.code : null
  const details = typeof record.details === 'string' ? record.details : null
  if (code && details) {
    return `${code}: ${details}`
  }
  return code ?? details
}

function isRecognizedGeminiJsonSession(payload: GeminiJsonRecord): boolean {
  const response = payload.response
  const error = payload.error
  const hasResponse = typeof response === 'string' || response === null
  const hasError = error === null || typeof error === 'string' || (typeof error === 'object' && error !== null)
  return hasResponse && hasError
}

function isUnauthenticatedMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('sign in') ||
    lower.includes('signin') ||
    lower.includes('login') ||
    lower.includes('authenticate') ||
    lower.includes('authentication') ||
    lower.includes('google account') ||
    lower.includes('oauth') ||
    lower.includes('unauth')
  )
}

function coerceNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function extractTokenCounts(stats: unknown): { inputTokens: number; outputTokens: number } {
  if (!stats || typeof stats !== 'object') {
    return { inputTokens: 0, outputTokens: 0 }
  }

  const record = stats as GeminiJsonRecord
  const candidates = [
    {
      input: coerceNumber(record.inputTokens),
      output: coerceNumber(record.outputTokens)
    },
    {
      input: coerceNumber(record.input_tokens),
      output: coerceNumber(record.output_tokens)
    },
    {
      input: coerceNumber((record.tokens as GeminiJsonRecord | undefined)?.input),
      output: coerceNumber((record.tokens as GeminiJsonRecord | undefined)?.output)
    },
    {
      input: coerceNumber((record.tokens as GeminiJsonRecord | undefined)?.input_tokens),
      output: coerceNumber((record.tokens as GeminiJsonRecord | undefined)?.output_tokens)
    },
    {
      input: coerceNumber((record.usage as GeminiJsonRecord | undefined)?.inputTokens),
      output: coerceNumber((record.usage as GeminiJsonRecord | undefined)?.outputTokens)
    },
    {
      input: coerceNumber((record.usage as GeminiJsonRecord | undefined)?.input_tokens),
      output: coerceNumber((record.usage as GeminiJsonRecord | undefined)?.output_tokens)
    }
  ]

  for (const candidate of candidates) {
    if (candidate.input !== null || candidate.output !== null) {
      return {
        inputTokens: candidate.input ?? 0,
        outputTokens: candidate.output ?? 0
      }
    }
  }

  return { inputTokens: 0, outputTokens: 0 }
}

function mapGeminiProbeOutput(rawOutput: string): LlmValidationState {
  const payload = parseGeminiJson(rawOutput)
  if (!payload) {
    const detail = rawOutput.trim() || 'No output from Gemini CLI probe.'
    return buildValidationState(isUnauthenticatedMessage(detail) ? 'unauthenticated' : 'error', detail)
  }

  if (!isRecognizedGeminiJsonSession(payload)) {
    return buildValidationState('error', 'Gemini CLI returned an unrecognized JSON response.')
  }

  const errorMessage = extractErrorMessage(payload.error)
  if (errorMessage) {
    return buildValidationState(
      isUnauthenticatedMessage(errorMessage) ? 'unauthenticated' : 'error',
      errorMessage
    )
  }

  const response = typeof payload.response === 'string' ? payload.response.trim() : ''
  if (response === 'ok') {
    return buildValidationState('connected', 'Validated via Gemini CLI.')
  }

  return buildValidationState('error', 'Gemini CLI probe did not return the expected response.')
}

function buildClassificationResult(response: string, recentOutput: string): LlmClassificationResult {
  const parsed = JSON.parse(response) as {
    category?: string
    summary?: string
    confidence?: 'low' | 'medium' | 'high'
  }

  return {
    category: normalizeCategory(parsed.category ?? 'unknown'),
    summary: parsed.summary?.trim() || 'The session may need attention.',
    confidence: normalizeConfidence(parsed.confidence),
    source: 'llm',
    providerId: 'gemini',
    modelId: null,
    recentOutputExcerpt: buildRecentOutputExcerpt(recentOutput)
  }
}

export class GeminiOfficialClientBridge implements OfficialClientBridge {
  constructor(
    private readonly commandRunner: BridgeCommandRunner = new DefaultBridgeCommandRunner('Gemini CLI is not installed.')
  ) {}

  async connect(laneId: string, hooks: BridgeConnectHooks): Promise<LlmLaneConnectResult> {
    if (laneId !== GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID) {
      throw new Error(`Unsupported bridge lane: ${laneId}`)
    }

    const launch = await hooks.launch({
      laneId,
      command: 'gemini',
      args: [],
      env: buildGeminiBridgeEnv()
    })

    return {
      laneId,
      status: 'pending-user-action',
      terminalId: launch.terminalId,
      detail: 'Choose Sign in with Google in Gemini CLI and complete authentication in the dedicated terminal session.'
    }
  }

  async refreshState(): Promise<BridgeStateRefreshResult> {
    try {
      const result = await this.commandRunner.run({
        command: getGeminiExecutable(),
        args: buildProbeArgs('Reply with exactly the word ok.'),
        env: buildGeminiBridgeEnv(),
        timeoutMs: DEFAULT_TIMEOUT_MS
      })
      return {
        validationState: mapGeminiProbeOutput(`${result.stdout}\n${result.stderr}`)
      }
    } catch (error) {
      return {
        validationState: mapBridgeError(error)
      }
    }
  }

  async validate(): Promise<BridgeValidationResult> {
    return await this.refreshState()
  }

  async classifyCause(recentOutput: string): Promise<BridgeClassificationResult> {
    try {
      const result = await this.commandRunner.run({
        command: getGeminiExecutable(),
        args: buildProbeArgs(buildClassificationPrompt(recentOutput)),
        env: buildGeminiBridgeEnv(),
        timeoutMs: DEFAULT_TIMEOUT_MS
      })
      const payload = parseGeminiJson(`${result.stdout}\n${result.stderr}`)
      if (!payload || !isRecognizedGeminiJsonSession(payload)) {
        throw new Error('Gemini CLI returned an unrecognized JSON response.')
      }

      const errorMessage = extractErrorMessage(payload.error)
      if (errorMessage) {
        throw Object.assign(new Error(errorMessage), {
          validationState: buildValidationState(
            isUnauthenticatedMessage(errorMessage) ? 'unauthenticated' : 'error',
            errorMessage
          )
        })
      }

      const response = typeof payload.response === 'string' ? payload.response.trim() : ''
      if (!response) {
        throw new Error('Gemini CLI did not return a response payload.')
      }

      const usage = extractTokenCounts(payload.stats)
      return {
        result: buildClassificationResult(response, recentOutput),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        validationState: buildValidationState('connected', 'Executed via Gemini CLI official-client bridge.')
      }
    } catch (error) {
      const bridgeError =
        typeof error === 'object' && error !== null
          ? (error as { validationState?: LlmValidationState })
          : null
      throw Object.assign(new Error('Official-client bridge execution failed.'), {
        cause: error,
        validationState: bridgeError?.validationState ?? mapBridgeError(error)
      })
    }
  }
}
