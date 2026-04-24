import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkCompat, parseCcVersion, type CcCompatResult, type CcVersion } from './cc-compat'

/**
 * CC version detector — Slice 2A.
 *
 * Runs `claude --version` in a bounded subprocess and parses the result
 * through cc-compat. Windows needs CLAUDE_CODE_GIT_BASH_PATH like the
 * spike scripts; we auto-detect common install locations the same way.
 *
 * Returns a discriminated union so the Settings UI can show one of:
 *   - supported    — hook ingress is green-lit
 *   - unsupported  — Settings shows upgrade CTA, adapter falls back to E
 *   - not-installed — Settings guides user to install CC first
 *   - detection-failed — runtime error (timeout, spawn crash, parse fail)
 */

export type CcDetectionResult =
  | ({ kind: 'supported' | 'unsupported' | 'unknown' } & CcCompatResult)
  | { kind: 'not-installed'; reason: string }
  | { kind: 'detection-failed'; reason: string; stderr?: string }

export interface DetectCcVersionOptions {
  /** Override the command (tests). */
  command?: string
  /** Override argv (tests). */
  args?: string[]
  /** Max ms to wait before killing the spawn. Defaults to 5s. */
  timeoutMs?: number
  /** Test-only environment override. */
  env?: NodeJS.ProcessEnv
}

const DEFAULT_TIMEOUT_MS = 5_000

function resolveGitBashOverride(env: NodeJS.ProcessEnv): string | undefined {
  if (process.platform !== 'win32') {
    return undefined
  }
  if (env.CLAUDE_CODE_GIT_BASH_PATH) {
    return env.CLAUDE_CODE_GIT_BASH_PATH
  }
  const username = os.userInfo().username
  const candidates = [
    `C:/Users/${username}/scoop/apps/git/current/usr/bin/bash.exe`,
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files (x86)/Git/bin/bash.exe'
  ]
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate)
    } catch {
      return false
    }
  })
}

export async function detectCcVersion(
  options: DetectCcVersionOptions = {}
): Promise<CcDetectionResult> {
  const command = options.command ?? 'claude'
  const args = options.args ?? ['--version']
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env) }

  const gitBash = resolveGitBashOverride(env)
  if (gitBash && !env.CLAUDE_CODE_GIT_BASH_PATH) {
    env.CLAUDE_CODE_GIT_BASH_PATH = gitBash
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: CcDetectionResult): void => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      resolve(result)
    }

    let child
    try {
      child = spawn(command, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      finish({ kind: 'detection-failed', reason: `spawn 실패: ${message}` })
      return
    }

    let stdoutBuf = ''
    let stderrBuf = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBuf += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBuf += chunk.toString()
    })

    const timeoutHandle = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignored
      }
      finish({
        kind: 'detection-failed',
        reason: `claude --version 이 ${timeoutMs}ms 내에 응답하지 않음`,
        stderr: stderrBuf.slice(0, 512)
      })
    }, timeoutMs)

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish({
          kind: 'not-installed',
          reason: 'claude 실행 파일을 PATH 에서 찾지 못했습니다. Claude Code 설치 후 재시도하세요.'
        })
        return
      }
      finish({
        kind: 'detection-failed',
        reason: `spawn error: ${error.message}`,
        stderr: stderrBuf.slice(0, 512)
      })
    })

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal === 'SIGKILL') {
        return // timeoutHandle already resolved
      }
      if (code !== 0) {
        finish({
          kind: 'detection-failed',
          reason: `claude --version 종료 코드 ${code ?? 'null'}`,
          stderr: stderrBuf.slice(0, 512)
        })
        return
      }
      const version = parseCcVersion(stdoutBuf)
      const compat = checkCompat(version)
      if (compat.status === 'supported') {
        finish({ kind: 'supported', ...compat })
      } else if (compat.status === 'unsupported') {
        finish({ kind: 'unsupported', ...compat })
      } else {
        finish({ kind: 'unknown', ...compat })
      }
    })
  })
}

/**
 * Narrow detection result to the single boolean used by path-selector's
 * `hook_installed` axis input when the hook is installed. UI uses the
 * full CcDetectionResult for messaging.
 */
export function isCompatible(result: CcDetectionResult): boolean {
  return result.kind === 'supported'
}

// Re-export so consumers can import the full surface from one place.
export type { CcCompatResult, CcVersion } from './cc-compat'

// Keep Node typings happy when os/path are tree-shaken in builds that
// drop the Windows branch. Referencing them here is cheap and avoids
// "imported but unused" lints on macOS/Linux.
void path
