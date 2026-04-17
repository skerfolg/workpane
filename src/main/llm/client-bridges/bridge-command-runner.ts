import { spawn } from 'node:child_process'
import type { LlmValidationState } from '../../../shared/types'
import { createLlmValidationState } from '../../../shared/types'
import type { BridgeCommandRequest, BridgeCommandResult, BridgeCommandRunner } from './client-bridge-types'

export const DEFAULT_TIMEOUT_MS = 45_000
export const SUPPORTED_PLATFORMS = new Set(['win32', 'darwin', 'linux'])

export class MissingClientError extends Error {}
export class UnsupportedPlatformError extends Error {}
export class TimedOutError extends Error {}

export function buildValidationState(
  status: LlmValidationState['status'],
  detail: string | null
): LlmValidationState {
  return createLlmValidationState(status, detail, new Date().toISOString())
}

export function mapBridgeError(error: unknown): LlmValidationState {
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

export class DefaultBridgeCommandRunner implements BridgeCommandRunner {
  constructor(private readonly missingClientMessage: string) {}

  async run(request: BridgeCommandRequest): Promise<BridgeCommandResult> {
    const command = request.command
    if (!command) {
      throw new Error('Bridge command was not provided.')
    }

    return await new Promise<BridgeCommandResult>((resolve, reject) => {
      const child = spawn(command, request.args, {
        stdio: 'pipe',
        windowsHide: true,
        env: request.env ?? (process.env as NodeJS.ProcessEnv)
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
          reject(new MissingClientError(this.missingClientMessage))
          return
        }
        reject(error)
      })
      child.on('close', (code: number | null) => {
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
        throw new TimedOutError(`Bridge command timed out: ${command}`)
      }
      return result
    })
  }
}
