import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { HistoryStore } from '../../src/main/history-store'

function createWorkspaceDir(): string {
  return mkdtempSync(join(os.tmpdir(), 'workpane-history-store-'))
}

test('HistoryStore appends and queries session events with timeline filters', () => {
  const workspacePath = createWorkspaceDir()
  const store = new HistoryStore()

  try {
    store.openWorkspace(workspacePath)
    store.appendMonitoringTransition({
      id: 'terminal-1:1:entered',
      terminalId: 'terminal-1',
      workspacePath,
      sequence: 1,
      timestamp: 100,
      kind: 'entered',
      category: 'approval',
      confidence: 'high',
      source: 'llm',
      summary: 'Approval needed',
      patternName: 'Approve changes?',
      matchedText: 'Approve changes?'
    })
    store.appendMonitoringTransition({
      id: 'terminal-1:2:updated',
      terminalId: 'terminal-1',
      workspacePath,
      sequence: 2,
      timestamp: 200,
      kind: 'updated',
      category: 'error',
      confidence: 'high',
      source: 'llm',
      summary: 'Error detected',
      patternName: 'Error',
      matchedText: 'Error'
    })

    const all = store.listSessionEvents('terminal-1', 'all', 10)
    const approvalOnly = store.listSessionEvents('terminal-1', 'approval-only', 10)
    const errorOnly = store.listSessionEvents('terminal-1', 'error-only', 10)

    assert.equal(all.length, 2)
    assert.equal(all[0]?.id, 'terminal-1:2:updated')
    assert.equal(approvalOnly.length, 1)
    assert.equal(approvalOnly[0]?.category, 'approval')
    assert.equal(errorOnly.length, 1)
    assert.equal(errorOnly[0]?.category, 'error')
  } finally {
    store.closeWorkspace()
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('HistoryStore exposes workspace feed in reverse chronological order', () => {
  const workspacePath = createWorkspaceDir()
  const store = new HistoryStore()

  try {
    store.openWorkspace(workspacePath)
    store.appendMonitoringTransition({
      id: 'terminal-1:1:entered',
      terminalId: 'terminal-1',
      workspacePath,
      sequence: 1,
      timestamp: 100,
      kind: 'entered'
    })
    store.appendMonitoringTransition({
      id: 'terminal-2:1:entered',
      terminalId: 'terminal-2',
      workspacePath,
      sequence: 1,
      timestamp: 300,
      kind: 'entered'
    })

    const feed = store.listWorkspaceFeed(10)

    assert.equal(feed.length, 2)
    assert.equal(feed[0]?.terminalId, 'terminal-2')
    assert.equal(feed[1]?.terminalId, 'terminal-1')
  } finally {
    store.closeWorkspace()
    rmSync(workspacePath, { recursive: true, force: true })
  }
})
