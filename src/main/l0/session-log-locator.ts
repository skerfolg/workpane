import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Session-log locator — Slice 1C (port of helpers in
 * scripts/phase-1/measure-option-e-latency.mjs).
 *
 * Claude Code stores per-project conversation logs under
 * `~/.claude/projects/<encoded-cwd>/*.jsonl`. The encoding is not
 * documented publicly, so we combine three strategies:
 *   1. exact match on the observed encoding rule
 *   2. longest-common-suffix best match (handles edge cases like
 *      unicode folder names)
 *   3. most-recently-modified fallback when no suffix match passes
 *      the minimum score threshold
 *
 * All functions here are pure (no watchers, no side effects) — the
 * tailer consumes this output.
 */

const MIN_SUFFIX_SCORE = 5

/**
 * Encode a cwd into Claude Code's project-directory name.
 *
 * Rule reverse-engineered from real CC project dirs on disk (the spike's
 * original rule was slightly wrong — it preserved the `.` single-dash
 * and collapsed whitespace to `-`, both of which disagree with observed
 * directory names like
 * `D--4--Workspace-PromptManager--worktrees-m0-phase0-spike`).
 *
 *   `:`       → `-`
 *   `\` `/`   → `-`
 *   `.`       → `--` (the source of the extra dash we were missing)
 *   whitespace → removed
 *   `-`       → preserved
 *
 * Windows example:
 *   `D:\4. Workspace\PromptManager.worktrees\m0-phase0-spike`
 *   → `D--4--Workspace-PromptManager--worktrees-m0-phase0-spike`
 *
 * POSIX example:
 *   `/home/alice/work pm/project`
 *   → `-home-alice-workpm-project`
 */
export function encodeCwdToProjectDir(cwd: string): string {
  return cwd
    .replace(/:/g, '-')
    .replace(/[\\/]/g, '-')
    .replace(/\./g, '--')
    .replace(/\s+/g, '')
}

/**
 * Find the first `~/.claude/projects` style directory that exists on
 * this machine. Returns null when no candidate is present (Claude Code
 * not installed or no session has ever run).
 */
export function resolveProjectsDir(home: string = os.homedir()): string | null {
  const candidates = [
    path.join(home, '.claude', 'projects'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'claude', 'projects') : null
  ].filter((value): value is string => value !== null)
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

function longestCommonSuffixLength(a: string, b: string): number {
  const lower = a.toLowerCase()
  const encLower = b.toLowerCase()
  let score = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (lower[lower.length - 1 - i] === encLower[encLower.length - 1 - i]) {
      score += 1
    } else {
      break
    }
  }
  return score
}

export interface ProjectDirMatch {
  path: string
  /** 'exact' > 'suffix' > 'mtime' in confidence order. */
  strategy: 'exact' | 'suffix' | 'mtime'
  score?: number
}

/**
 * Match a cwd to the CC project directory that most likely contains
 * its session logs. Returns null when the projects dir is empty or
 * no strategy produces a candidate.
 */
export function findMatchingProjectDir(
  projectsDir: string,
  cwd: string
): ProjectDirMatch | null {
  const encoded = encodeCwdToProjectDir(cwd)

  // Strategy 1 — exact match
  const exact = path.join(projectsDir, encoded)
  if (fs.existsSync(exact)) {
    return { path: exact, strategy: 'exact' }
  }

  // Strategy 2 — longest common suffix
  let dirs: string[]
  try {
    dirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return null
  }
  if (dirs.length === 0) {
    return null
  }

  const scored = dirs
    .map((name) => ({ name, score: longestCommonSuffixLength(name, encoded) }))
    .sort((a, b) => b.score - a.score)

  const top = scored[0]
  if (top && top.score >= MIN_SUFFIX_SCORE) {
    return { path: path.join(projectsDir, top.name), strategy: 'suffix', score: top.score }
  }

  // Strategy 3 — most recently modified
  const byMtime = dirs
    .map((name) => {
      try {
        return { name, mtime: fs.statSync(path.join(projectsDir, name)).mtimeMs }
      } catch {
        return { name, mtime: 0 }
      }
    })
    .sort((a, b) => b.mtime - a.mtime)

  const newest = byMtime[0]
  return newest ? { path: path.join(projectsDir, newest.name), strategy: 'mtime' } : null
}
