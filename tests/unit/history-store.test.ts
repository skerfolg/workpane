import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const HISTORY_STORE_MODULE_PATH = '../../src/main/history-store'

type HistoryStoreModule = typeof import('../../src/main/history-store')

function createWorkspaceDir(): string {
  return mkdtempSync(join(os.tmpdir(), 'workpane-history-store-'))
}

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

function appendApprovalEvent(
  store: InstanceType<HistoryStoreModule['HistoryStore']>,
  workspacePath: string,
  sequence: number,
  timestamp: number,
  kind: 'entered' | 'updated' | 'cleared' = 'entered'
): void {
  store.appendMonitoringTransition({
    id: `terminal-1:${sequence}:${kind}`,
    terminalId: 'terminal-1',
    workspacePath,
    sequence,
    timestamp,
    kind,
    category: 'approval',
    confidence: 'high',
    source: 'llm',
    summary: `Approval event ${sequence}`,
    patternName: 'Approve changes?',
    matchedText: 'Approve changes?'
  })
}

test('HistoryStore reports memory status and empty reads before any workspace is opened', () => {
  const { HistoryStore } = require(HISTORY_STORE_MODULE_PATH) as HistoryStoreModule
  const store = new HistoryStore({ logger: silentLogger })

  assert.deepEqual(store.listSessionEvents('terminal-1', 'all', 10), [])
  assert.deepEqual(store.listWorkspaceFeed(10), [])
  assert.deepEqual(store.getStatus(), {
    available: false,
    backend: 'memory',
    detail: 'No workspace-local history store is open.',
    storagePath: null
  })
})

test('HistoryStore appends and queries session events with timeline filters', () => {
  const workspacePath = createWorkspaceDir()
  const { HistoryStore } = require(HISTORY_STORE_MODULE_PATH) as HistoryStoreModule
  const store = new HistoryStore({ logger: silentLogger })

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
  const { HistoryStore } = require(HISTORY_STORE_MODULE_PATH) as HistoryStoreModule
  const store = new HistoryStore({ logger: silentLogger })

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

test('HistoryStore falls back to the JSON backend when sqlite is unavailable', () => {
  const workspacePath = createWorkspaceDir()
  const { HistoryStore } = require(HISTORY_STORE_MODULE_PATH) as HistoryStoreModule
  const store = new HistoryStore({
    loadSqliteModule: () => null,
    logger: silentLogger
  })

  try {
    store.openWorkspace(workspacePath)

    const status = store.getStatus()

    assert.equal(status.available, true)
    assert.equal(status.backend, 'json_fallback')
    assert.match(status.detail, /node:sqlite is unavailable/i)
    assert.equal(status.storagePath, join(workspacePath, '.workspace', 'workpane-history.json'))
  } finally {
    store.closeWorkspace()
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('HistoryStore falls back and preserves history across close and reopen when sqlite init fails', () => {
  const workspacePath = createWorkspaceDir()
  const { HistoryStore } = require(HISTORY_STORE_MODULE_PATH) as HistoryStoreModule
  const store = new HistoryStore({
    loadSqliteModule: () => ({
      DatabaseSync: class DatabaseSync {
        constructor(_path: string) {
          throw new Error('sqlite init failed for test')
        }

        exec(): void {}

        prepare() {
          return {
            run: () => undefined,
            all: () => []
          }
        }

        close(): void {}
      }
    } as any),
    logger: silentLogger
  })

  try {
    store.openWorkspace(workspacePath)
    appendApprovalEvent(store, workspacePath, 1, 100)
    store.closeWorkspace()

    assert.deepEqual(store.getStatus(), {
      available: false,
      backend: 'memory',
      detail: 'No workspace-local history store is open.',
      storagePath: null
    })
    assert.deepEqual(store.listSessionEvents('terminal-1', 'all', 10), [])

    store.openWorkspace(workspacePath)

    const reopenedStatus = store.getStatus()
    const reopenedEvents = store.listSessionEvents('terminal-1', 'all', 10)
    const reopenedFeed = store.listWorkspaceFeed(10)

    assert.equal(reopenedStatus.backend, 'json_fallback')
    assert.match(reopenedStatus.detail, /node:sqlite initialization failed/i)
    assert.equal(reopenedEvents.length, 1)
    assert.equal(reopenedEvents[0]?.id, 'terminal-1:1:entered')
    assert.equal(reopenedFeed.length, 1)
    assert.equal(reopenedFeed[0]?.id, 'terminal-1:1:entered')
  } finally {
    store.closeWorkspace()
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('HistoryStore can force JSON fallback without loading sqlite and resets to memory on close', () => {
  const workspacePath = createWorkspaceDir()
  const { HistoryStore } = require(HISTORY_STORE_MODULE_PATH) as HistoryStoreModule
  const originalMode = process.env.WORKPANE_HISTORY_BACKEND
  const store = new HistoryStore({
    loadSqliteModule: () => {
      throw new Error('loadSqliteModule should not be called when fallback is forced')
    },
    logger: silentLogger
  })

  try {
    process.env.WORKPANE_HISTORY_BACKEND = 'json_fallback'
    store.openWorkspace(workspacePath)

    const status = store.getStatus()
    assert.equal(status.available, true)
    assert.equal(status.backend, 'json_fallback')
    assert.match(status.detail, /forced by WORKPANE_HISTORY_BACKEND/i)
    assert.equal(status.storagePath, join(workspacePath, '.workspace', 'workpane-history.json'))

    store.closeWorkspace()

    assert.deepEqual(store.getStatus(), {
      available: false,
      backend: 'memory',
      detail: 'No workspace-local history store is open.',
      storagePath: null
    })
  } finally {
    if (originalMode == null) {
      delete process.env.WORKPANE_HISTORY_BACKEND
    } else {
      process.env.WORKPANE_HISTORY_BACKEND = originalMode
    }
    store.closeWorkspace()
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('HistoryStore preserves persisted events across close and reopen for the active backend', () => {
  const workspacePath = createWorkspaceDir()
  const { HistoryStore } = require(HISTORY_STORE_MODULE_PATH) as HistoryStoreModule
  const store = new HistoryStore({ logger: silentLogger })

  try {
    store.openWorkspace(workspacePath)
    appendApprovalEvent(store, workspacePath, 1, 100)
    appendApprovalEvent(store, workspacePath, 2, 200, 'updated')
    const initialStatus = store.getStatus()

    assert.equal(initialStatus.available, true)
    assert.match(initialStatus.storagePath ?? '', /workpane-history\.(sqlite|json)$/)

    store.closeWorkspace()
    store.openWorkspace(workspacePath)

    const reopenedEvents = store.listSessionEvents('terminal-1', 'all', 10)
    const reopenedFeed = store.listWorkspaceFeed(10)

    assert.deepEqual(
      reopenedEvents.map((event) => event.id),
      ['terminal-1:2:updated', 'terminal-1:1:entered']
    )
    assert.deepEqual(
      reopenedFeed.map((event) => event.id),
      ['terminal-1:2:updated', 'terminal-1:1:entered']
    )
  } finally {
    store.closeWorkspace()
    rmSync(workspacePath, { recursive: true, force: true })
  }
})
