import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CcSessionLogAdapter } from '../../src/main/l0/adapters/cc-session-log-adapter'
import {
  encodeCwdToProjectDir,
  findMatchingProjectDir,
  resolveProjectsDir
} from '../../src/main/l0/session-log-locator'
import { SessionLogTailer } from '../../src/main/l0/session-log-tailer'

/**
 * Slice 1C — Option E session log adapter + locator tests.
 *
 * The spike's measured encoding rule and mtime-fallback behavior are
 * covered here so a future Claude Code release that changes the
 * project-dir naming scheme is caught before it silently degrades
 * Option E.
 */

test('encodeCwdToProjectDir — Windows cwd with spaces and dotted dir name', () => {
  // Verified against real ~/.claude/projects entry created by CC.
  const input = 'D:\\4. Workspace\\PromptManager.worktrees\\m0-phase0-spike'
  const encoded = encodeCwdToProjectDir(input)
  assert.equal(encoded, 'D--4--Workspace-PromptManager--worktrees-m0-phase0-spike')
})

test('encodeCwdToProjectDir — simple Windows cwd matches on-disk name', () => {
  const encoded = encodeCwdToProjectDir('D:\\4. Workspace\\PromptManager')
  assert.equal(encoded, 'D--4--Workspace-PromptManager')
})

test('encodeCwdToProjectDir — POSIX cwd removes whitespace', () => {
  const encoded = encodeCwdToProjectDir('/home/alice/work pm/project')
  assert.equal(encoded, '-home-alice-workpm-project')
})

test('encodeCwdToProjectDir — consecutive slashes each become a dash', () => {
  const encoded = encodeCwdToProjectDir('/tmp//a///b')
  assert.equal(encoded, '-tmp--a---b')
})

test('findMatchingProjectDir — exact match wins', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'l0-locator-'))
  try {
    const encoded = encodeCwdToProjectDir('/test/cwd/example')
    const targetDir = path.join(scratch, encoded)
    fs.mkdirSync(targetDir)
    fs.mkdirSync(path.join(scratch, 'other-project'))

    const match = findMatchingProjectDir(scratch, '/test/cwd/example')
    assert.ok(match)
    assert.equal(match.strategy, 'exact')
    assert.equal(match.path, targetDir)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('findMatchingProjectDir — falls back to longest-suffix match when exact miss', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'l0-locator-'))
  try {
    // Real encoded name for '/test/cwd/example/unique' is
    // '-test-cwd-example-unique'. Create a neighbor with the same
    // suffix but a different prefix so suffix-match still wins.
    fs.mkdirSync(path.join(scratch, '-old-cwd-example-unique'))
    fs.mkdirSync(path.join(scratch, '-totally-different'))

    const match = findMatchingProjectDir(scratch, '/test/cwd/example/unique')
    assert.ok(match)
    assert.equal(match.strategy, 'suffix')
    assert.ok(match.path.endsWith('-old-cwd-example-unique'))
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('findMatchingProjectDir — mtime fallback when no suffix match meets threshold', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'l0-locator-'))
  try {
    const older = path.join(scratch, 'zzzz')
    const newer = path.join(scratch, 'aaaa')
    fs.mkdirSync(older)
    // Bump newer's mtime so it wins the fallback
    await new Promise((r) => setTimeout(r, 10))
    fs.mkdirSync(newer)

    const match = findMatchingProjectDir(scratch, '/no/overlap/path')
    assert.ok(match)
    assert.equal(match.strategy, 'mtime')
    assert.ok(match.path.endsWith('aaaa'))
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('findMatchingProjectDir — returns null when projects dir is empty', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'l0-locator-'))
  try {
    const match = findMatchingProjectDir(scratch, '/anything')
    assert.equal(match, null)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('resolveProjectsDir — returns null when no candidate exists', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'l0-home-'))
  try {
    const prior = process.env.APPDATA
    delete process.env.APPDATA
    try {
      assert.equal(resolveProjectsDir(scratch), null)
    } finally {
      if (prior) process.env.APPDATA = prior
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('CcSessionLogAdapter — tool_use envelope emits L0Event with suppress flag', () => {
  const adapter = new CcSessionLogAdapter()
  const envelope = {
    type: 'assistant',
    timestamp: '2026-04-24T12:00:00.000Z',
    message: {
      role: 'assistant',
      type: 'message',
      content: [{ type: 'tool_use', name: 'Read', id: 'tu-1', input: { file_path: '/a' } }]
    }
  }

  const result = adapter.ingest('terminal-1', envelope)
  assert.equal(result.kind, 'event')
  if (result.kind === 'event') {
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0].vendor, 'claude-code')
    assert.equal(result.events[0].eventKind, 'tool-use-pending')
    assert.equal(result.events[0].category, 'approval')
    assert.equal(result.suppressApprovalDetector, true)
  }
  assert.equal(adapter.getStatus('terminal-1')?.mode, 'active')
})

test('CcSessionLogAdapter — string input is parsed as JSON line', () => {
  const adapter = new CcSessionLogAdapter()
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-04-24T12:00:00.000Z',
    message: {
      role: 'assistant',
      type: 'message',
      content: [{ type: 'tool_use', name: 'Edit', id: 'tu-2', input: {} }]
    }
  })
  const result = adapter.ingest('terminal-2', line)
  assert.equal(result.kind, 'event')
})

test('CcSessionLogAdapter — unparseable input no-ops without crashing', () => {
  const adapter = new CcSessionLogAdapter()
  assert.equal(adapter.ingest('t', 42).kind, 'noop')
  assert.equal(adapter.ingest('t', null).kind, 'noop')
  assert.equal(adapter.ingest('t', []).kind, 'noop')
  assert.equal(adapter.ingest('t', 'not json').kind, 'noop')
  assert.equal(adapter.ingest('t', '').kind, 'noop')
})

test('CcSessionLogAdapter — reset + dispose clear state', () => {
  const adapter = new CcSessionLogAdapter()
  const envelope = {
    type: 'assistant',
    timestamp: 0,
    message: {
      role: 'assistant',
      type: 'message',
      content: [{ type: 'tool_use', name: 'Bash', id: 'tu', input: { command: 'ls' } }]
    }
  }
  adapter.ingest('t1', envelope)
  adapter.ingest('t2', envelope)
  assert.ok(adapter.getStatus('t1'))
  adapter.reset('t1')
  assert.equal(adapter.getStatus('t1'), undefined)
  adapter.dispose()
  assert.equal(adapter.getStatus('t2'), undefined)
})

test('SessionLogTailer — dryRun start returns projectDir without starting watcher', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'l0-tailer-'))
  try {
    const encoded = encodeCwdToProjectDir('/cwd/case')
    fs.mkdirSync(path.join(scratch, encoded))
    const tailer = new SessionLogTailer({
      terminalId: 't',
      cwd: '/cwd/case',
      projectsDirOverride: scratch,
      dryRun: true
    })
    const { started, projectDir } = tailer.start()
    assert.equal(started, false)
    assert.ok(projectDir && projectDir.endsWith(encoded))
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('SessionLogTailer._emitForTest — parses jsonl content into envelope events', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'l0-tailer-'))
  try {
    const encoded = encodeCwdToProjectDir('/test/emit')
    fs.mkdirSync(path.join(scratch, encoded))
    const tailer = new SessionLogTailer({
      terminalId: 't-emit',
      cwd: '/test/emit',
      projectsDirOverride: scratch,
      dryRun: true
    })
    tailer.start()

    const envelopes: Array<{ terminalId: string; payload: Record<string, unknown> }> = []
    const parseErrors: Array<{ line: string }> = []
    tailer.on('envelope', (e) => envelopes.push({ terminalId: e.terminalId, payload: e.payload }))
    tailer.on('parse-error', (e) => parseErrors.push({ line: e.line }))

    const chunk = [
      JSON.stringify({ type: 'assistant', id: 1 }),
      '',
      '{bad json',
      JSON.stringify({ type: 'assistant', id: 2 })
    ].join('\n')

    tailer._emitForTest(path.join(scratch, encoded, 'fake.jsonl'), chunk)

    assert.equal(envelopes.length, 2)
    assert.equal(envelopes[0].terminalId, 't-emit')
    assert.equal((envelopes[0].payload as { id: number }).id, 1)
    assert.equal(parseErrors.length, 1)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})
