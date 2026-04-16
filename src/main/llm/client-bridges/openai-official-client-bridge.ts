import { spawn } from 'node:child_process'
import type { LlmCauseCategory, LlmClassificationResult, LlmLaneConnectResult, LlmValidationState } from '../../../shared/types'
import { createLlmValidationState, OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID } from '../../../shared/types'
import type {
  BridgeClassificationResult,
  BridgeCommandRequest,
  BridgeCommandResult,
  BridgeCommandRunner,
  BridgeConnectHooks,
  BridgeStateRefreshResult,
  BridgeValidationResult,
  OfficialClientBridge
} from './client-bridge-types'

const DEFAULT_TIMEOUT_MS = 45_000
const SUPPORTED_PLATFORMS = new Set(['win32', 'darwin', 'linux'])

class MissingClientError extends Error {}
class UnsupportedPlatformError extends Error {}
class TimedOutError extends Error {}

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

function buildValidationState(
  status: LlmValidationState['status'],
  detail: string | null
): LlmValidationState {
  return createLlmValidationState(status, detail, new Date().toISOString())
}

function extractEventText(value: unknown): string | null {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractEventText(entry))
      .filter((entry): entry is string => Boolean(entry))
    return parts.length > 0 ? parts.join('\n') : null
  }

  if (typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') {
    return record.text
  }
  if (Array.isArray(record.content)) {
    return extractEventText(record.content)
  }
  if (record.content && typeof record.content === 'object') {
    return extractEventText(record.content)
  }
  return null
}

function parseJsonEvents(rawOutput: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  for (const line of rawOutput.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') {
        events.push(parsed as Record<string, unknown>)
      }
    } catch {
      continue
    }
  }
  return events
}

function parseAssistantPayload(rawOutput: string): { payload: string | null; inputTokens: number; outputTokens: number } {
  const events = parseJsonEvents(rawOutput)
  let payload: string | null = null
  let inputTokens = 0
  let outputTokens = 0

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type : ''
    if (type === 'item.completed') {
      const item = event.item && typeof event.item === 'object' ? (event.item as Record<string, unknown>) : null
      if (item?.type === 'agent_message') {
        const nextPayload = extractEventText(item)
        if (typeof nextPayload === 'string') {
          payload = nextPayload
        }
      }
    }
    if (type === 'turn.completed') {
      const usage = event.usage && typeof event.usage === 'object' ? (event.usage as Record<string, unknown>) : null
      inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : inputTokens
      outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : outputTokens
    }
  }

  return { payload, inputTokens, outputTokens }
}

function getCodexExecutable(): string {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    throw new UnsupportedPlatformError(`Unsupported platform: ${process.platform}`)
  }
  return process.platform === 'win32' ? 'codex.cmd' : 'codex'
}

class DefaultBridgeCommandRunner implements BridgeCommandRunner {
  async run(request: BridgeCommandRequest): Promise<BridgeCommandResult> {
    const command = getCodexExecutable()
    return await new Promise<BridgeCommandResult>((resolve, reject) => {
      const child = spawn(command, request.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: process.env as NodeJS.ProcessEnv
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let timedOut = false
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const timeoutId = setTimeout(() => {
        timedOut = true
        child.kill()
      }, timeoutMs)

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdoutChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      })
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderrChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      })
      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timeoutId)
        if (error.code === 'ENOENT') {
          reject(new MissingClientError('Codex CLI is not installed.'))
          return
        }
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timeoutId)
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: code,
          timedOut
        })
      })
    }).then((result) => {
      if (result.timedOut) {
        throw new TimedOutError('Codex CLI command timed out.')
      }
      return result
    })
  }
}

function mapLoginStatusToValidationState(output: string): LlmValidationState {
  const normalized = output.trim()
  const lower = normalized.toLowerCase()

  if (!normalized) {
    return buildValidationState('error', 'No output from codex login status.')
  }
  if (isUnauthenticatedOutput(lower)) {
    return buildValidationState('unauthenticated', normalized)
  }
  if (lower.includes('logged in')) {
    return buildValidationState('connected', normalized)
  }
  return buildValidationState('error', normalized)
}

function isUnauthenticatedOutput(lower: string): boolean {
  return (
    lower.includes('not logged in') ||
    lower.includes('login required') ||
    lower.includes('unauthenticated') ||
    lower.includes('authenticate')
  )
}

function mapBridgeError(error: unknown): LlmValidationState {
  if (error instanceof UnsupportedPlatformError) {
    return buildValidationState('unsupported_platform', error.message)
  }
  if (error instanceof MissingClientError) {
    return buildValidationState('missing_client', error.message)
  }
  if (error instanceof Error) {
    return buildValidationState('error', error.message)
  }
  return buildValidationState('error', 'Unknown bridge error.')
}

function buildClassificationResult(
  payload: string,
  recentOutput: string
): LlmClassificationResult {
  const parsed = JSON.parse(payload) as {
    category?: string
    summary?: string
    confidence?: 'low' | 'medium' | 'high'
  }

  return {
    category: normalizeCategory(parsed.category ?? 'unknown'),
    summary: parsed.summary?.trim() || 'The session may need attention.',
    confidence: normalizeConfidence(parsed.confidence),
    source: 'llm',
    providerId: 'openai',
    modelId: null,
    recentOutputExcerpt: buildRecentOutputExcerpt(recentOutput)
  }
}

export class OpenAiOfficialClientBridge implements OfficialClientBridge {
  constructor(private readonly commandRunner: BridgeCommandRunner = new DefaultBridgeCommandRunner()) {}

  async connect(laneId: string, hooks: BridgeConnectHooks): Promise<LlmLaneConnectResult> {
    if (laneId !== OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID) {
      throw new Error(`Unsupported bridge lane: ${laneId}`)
    }

    const launch = await hooks.launch({
      laneId,
      command: getCodexExecutable(),
      args: ['login', '--device-auth']
    })

    return {
      laneId,
      status: 'pending-user-action',
      terminalId: launch.terminalId,
      detail: 'Complete device authentication in the dedicated terminal session.'
    }
  }

  async refreshState(): Promise<BridgeStateRefreshResult> {
    try {
      const result = await this.commandRunner.run({
        args: ['login', 'status'],
        timeoutMs: DEFAULT_TIMEOUT_MS
      })
      return {
        validationState: mapLoginStatusToValidationState(`${result.stdout}\n${result.stderr}`)
      }
    } catch (error) {
      return {
        validationState: mapBridgeError(error)
      }
    }
  }

  async validate(): Promise<BridgeValidationResult> {
    try {
      const result = await this.commandRunner.run({
        args: ['exec', '--json', 'reply with exactly the word ok'],
        timeoutMs: DEFAULT_TIMEOUT_MS
      })
      const { payload } = parseAssistantPayload(`${result.stdout}\n${result.stderr}`)
      const normalized = payload?.trim() ?? ''
      if (normalized === 'ok') {
        return {
          validationState: buildValidationState('connected', 'Validated via codex exec.')
        }
      }

      const fallbackMessage = `${result.stdout}\n${result.stderr}`.trim() || 'Codex CLI validation did not return the expected assistant payload.'
      const lower = fallbackMessage.toLowerCase()
      return {
        validationState: buildValidationState(
          isUnauthenticatedOutput(lower) ? 'unauthenticated' : 'error',
          fallbackMessage
        )
      }
    } catch (error) {
      return {
        validationState: mapBridgeError(error)
      }
    }
  }

  async classifyCause(recentOutput: string): Promise<BridgeClassificationResult> {
    try {
      const result = await this.commandRunner.run({
        args: ['exec', '--json', buildClassificationPrompt(recentOutput)],
        timeoutMs: DEFAULT_TIMEOUT_MS
      })
      const parsed = parseAssistantPayload(`${result.stdout}\n${result.stderr}`)
      if (!parsed.payload) {
        throw new Error('Codex CLI did not emit a final assistant payload.')
      }

      return {
        result: buildClassificationResult(parsed.payload, recentOutput),
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        validationState: buildValidationState('connected', 'Executed via Codex CLI official client bridge.')
      }
    } catch (error) {
      throw Object.assign(new Error('Official-client bridge execution failed.'), {
        cause: error,
        validationState: mapBridgeError(error)
      })
    }
  }
}
