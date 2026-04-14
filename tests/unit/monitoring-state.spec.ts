import test from 'node:test'
import assert from 'node:assert/strict'

const MONITORING_STATE_MODULE_PATH = '../../src/renderer/src/contexts/monitoring-state'

type MonitoringCause = 'approval' | 'input-needed' | 'error'
type MonitoringSource = 'llm' | 'no-api'
type MonitoringConfidence = 'low' | 'medium' | 'high'
type MonitoringTransitionKind = 'entered' | 'updated' | 'cleared'

interface MonitoringEntry {
  terminalId: string
  workspacePath: string
  patternName: string
  matchedText: string
  status: 'attention-needed'
  source: MonitoringSource
  cause: MonitoringCause
  confidence: MonitoringConfidence
  summary: string
  updatedAt: number
}

interface MonitoringState {
  byTerminalId: Record<string, MonitoringEntry>
  transitionLogByTerminalId: Record<string, MonitoringTransitionEntry[]>
}

interface MonitoringSummary {
  attentionCount: number
  byCause: Partial<Record<MonitoringCause, number>>
}

interface MonitoringGroupLike {
  id: string
  terminalIds: string[]
}

interface MonitoringGroupIndicator {
  hasAttention: boolean
  affectedTerminalCount: number
  title: string | null
}

interface MonitoringTerminalIndicator {
  hasAttention: boolean
  tone: 'direct' | 'tentative'
  title: string
}

interface MonitoringTransitionEntry {
  id: string
  terminalId: string
  workspacePath: string
  sequence: number
  timestamp: number
  kind: MonitoringTransitionKind
  reason?: 'write' | 'exit'
  cause?: MonitoringCause
  confidence?: MonitoringConfidence
  source?: MonitoringSource
  summary?: string
  patternName?: string
  matchedText?: string
}

interface MonitoringStateModule {
  createMonitoringState: () => MonitoringState
  monitoringStateReducer: (
    state: MonitoringState,
    action:
      | { type: 'upsert'; entry: MonitoringEntry }
      | { type: 'clear'; terminalId: string }
      | { type: 'append-transition'; transition: MonitoringTransitionEntry }
      | { type: 'reset' }
  ) => MonitoringState
  selectGroupAttentionSummary: (state: MonitoringState, terminalIds: string[]) => MonitoringSummary
  selectStatusBarAttentionSummary: (state: MonitoringState) => MonitoringSummary
  selectAffectedGroupCount: (state: MonitoringState, groups: MonitoringGroupLike[]) => number
  selectGroupMonitoringIndicator: (
    state: MonitoringState,
    terminalIds: string[]
  ) => MonitoringGroupIndicator
  selectTerminalMonitoringIndicator: (
    state: MonitoringState,
    terminalId: string
  ) => MonitoringTerminalIndicator | null
  MAX_MONITORING_TRANSITIONS_PER_TERMINAL: number
  toMonitoringTransitionEntry: (event: {
    id: string
    terminalId: string
    workspacePath: string
    sequence: number
    timestamp: number
    kind: MonitoringTransitionKind
    reason?: 'write' | 'exit'
    category?: MonitoringCause
    confidence?: MonitoringConfidence
    source?: MonitoringSource
    summary?: string
    patternName?: string
    matchedText?: string
  }) => MonitoringTransitionEntry
  selectTerminalTransitionLog: (state: MonitoringState, terminalId: string | null | undefined) => MonitoringTransitionEntry[]
  formatMonitoringTransitionDisplay: (entry: MonitoringTransitionEntry) => {
    title: string
    meta: string
    detail: string
  }
  formatMonitoringDisplay: (entry: MonitoringEntry) => { headline: string; meta: string }
  MAX_GLOBAL_MONITORING_FEED_ITEMS?: number
  selectGlobalTransitionFeed?: (
    state: MonitoringState,
    options?: { limit?: number }
  ) => Array<{
    id: string
    terminalId: string
    timestamp: number
    receiptOrder: number
    kind: MonitoringTransitionKind
    title: string
    meta: string
    detail: string
    currentAttention: boolean
  }>
  MAX_MONITORING_QUEUE_ITEMS?: number
  selectAttentionQueue?: (
    state: MonitoringState,
    options?: { limit?: number }
  ) => Array<{
    terminalId: string
    updatedAt: number
    headline: string
    meta: string
    detail: string
    latestTransitionTimestamp: number | null
    latestTransitionReceiptOrder: number
  }>
}

function loadMonitoringStateModule():
  | { ok: true; module: MonitoringStateModule }
  | { ok: false; reason: string } {
  try {
    const loaded = require(MONITORING_STATE_MODULE_PATH) as Partial<MonitoringStateModule>
    const module = loaded as MonitoringStateModule

    if (
      typeof module.createMonitoringState !== 'function' ||
      typeof module.monitoringStateReducer !== 'function' ||
      typeof module.selectGroupAttentionSummary !== 'function' ||
      typeof module.selectStatusBarAttentionSummary !== 'function' ||
      typeof module.selectAffectedGroupCount !== 'function' ||
      typeof module.selectGroupMonitoringIndicator !== 'function' ||
      typeof module.selectTerminalMonitoringIndicator !== 'function' ||
      typeof module.toMonitoringTransitionEntry !== 'function' ||
      typeof module.selectTerminalTransitionLog !== 'function' ||
      typeof module.formatMonitoringTransitionDisplay !== 'function' ||
      typeof module.MAX_MONITORING_TRANSITIONS_PER_TERMINAL !== 'number' ||
      typeof module.formatMonitoringDisplay !== 'function'
    ) {
      return {
        ok: false,
        reason:
          `Expected ${MONITORING_STATE_MODULE_PATH} to export ` +
          'createMonitoringState, monitoringStateReducer, ' +
          'selectGroupAttentionSummary, selectStatusBarAttentionSummary, ' +
          'selectAffectedGroupCount, selectGroupMonitoringIndicator, ' +
          'selectTerminalMonitoringIndicator, toMonitoringTransitionEntry, ' +
          'selectTerminalTransitionLog, formatMonitoringTransitionDisplay, ' +
          'MAX_MONITORING_TRANSITIONS_PER_TERMINAL, and formatMonitoringDisplay.'
      }
    }

    return { ok: true, module }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      reason: `Expected pure monitoring-state module at ${MONITORING_STATE_MODULE_PATH}: ${detail}`
    }
  }
}

function createEntry(overrides: Partial<MonitoringEntry> = {}): MonitoringEntry {
  return {
    terminalId: 'terminal-1',
    workspacePath: 'D:/workspace/demo',
    patternName: 'approval-prompt',
    matchedText: 'Apply this change? (y/n)',
    status: 'attention-needed',
    source: 'llm',
    cause: 'approval',
    confidence: 'high',
    summary: 'Approval required',
    updatedAt: 1,
    ...overrides
  }
}

function createTransition(overrides: Partial<MonitoringTransitionEntry> = {}): MonitoringTransitionEntry {
  return {
    id: 'terminal-1:1:entered',
    terminalId: 'terminal-1',
    workspacePath: 'D:/workspace/demo',
    sequence: 1,
    timestamp: 1,
    kind: 'entered',
    cause: 'approval',
    confidence: 'high',
    source: 'llm',
    summary: 'Approval required',
    patternName: 'approval-prompt',
    matchedText: 'Apply this change? (y/n)',
    ...overrides
  }
}

const loadedModule = loadMonitoringStateModule()

if (!loadedModule.ok) {
  test('monitoring-state module is available for Slice 1 reducer coverage', { skip: loadedModule.reason }, () => {})
} else {
  const {
    MAX_MONITORING_QUEUE_ITEMS,
    createMonitoringState,
    MAX_GLOBAL_MONITORING_FEED_ITEMS,
    MAX_MONITORING_TRANSITIONS_PER_TERMINAL,
    monitoringStateReducer,
    formatMonitoringDisplay,
    formatMonitoringTransitionDisplay,
    selectAttentionQueue,
    selectGlobalTransitionFeed,
    selectAffectedGroupCount,
    selectGroupMonitoringIndicator,
    selectGroupAttentionSummary,
    selectStatusBarAttentionSummary,
    selectTerminalMonitoringIndicator,
    selectTerminalTransitionLog,
    toMonitoringTransitionEntry
  } = loadedModule.module

  function requireGlobalTransitionFeed() {
    assert.equal(typeof selectGlobalTransitionFeed, 'function')
    assert.equal(typeof MAX_GLOBAL_MONITORING_FEED_ITEMS, 'number')

    return {
      selectGlobalTransitionFeed: selectGlobalTransitionFeed!,
      maxGlobalMonitoringFeedItems: MAX_GLOBAL_MONITORING_FEED_ITEMS!
    }
  }

  function requireAttentionQueue() {
    assert.equal(typeof selectAttentionQueue, 'function')
    assert.equal(typeof MAX_MONITORING_QUEUE_ITEMS, 'number')

    return {
      selectAttentionQueue: selectAttentionQueue!,
      maxMonitoringQueueItems: MAX_MONITORING_QUEUE_ITEMS!
    }
  }

  test('monitoringStateReducer replaces an existing terminal entry on repeated upsert', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-1', summary: 'Approval required', updatedAt: 1 })
    })

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({
        terminalId: 'terminal-1',
        cause: 'error',
        confidence: 'medium',
        summary: 'Process failed',
        updatedAt: 2
      })
    })

    assert.deepEqual(Object.keys(state.byTerminalId), ['terminal-1'])
    assert.equal(state.byTerminalId['terminal-1']?.cause, 'error')
    assert.equal(state.byTerminalId['terminal-1']?.updatedAt, 2)
  })

  test('monitoringStateReducer removes only the cleared terminal entry', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-1' })
    })
    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-2', cause: 'input-needed', updatedAt: 2 })
    })

    state = monitoringStateReducer(state, { type: 'clear', terminalId: 'terminal-1' })

    assert.deepEqual(Object.keys(state.byTerminalId), ['terminal-2'])
    assert.equal(state.byTerminalId['terminal-2']?.cause, 'input-needed')
  })

  test('monitoringStateReducer appends entered transition for first semantic upsert', () => {
    let state = createMonitoringState()
    const entry = createEntry({ terminalId: 'terminal-1', updatedAt: 1 })

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: toMonitoringTransitionEntry({
        id: 'terminal-1:1:entered',
        terminalId: 'terminal-1',
        workspacePath: entry.workspacePath,
        sequence: 1,
        timestamp: 1,
        kind: 'entered',
        category: entry.cause,
        confidence: entry.confidence,
        source: entry.source,
        summary: entry.summary,
        patternName: entry.patternName,
        matchedText: entry.matchedText
      })
    })

    assert.equal(state.byTerminalId['terminal-1']?.summary, 'Approval required')
    assert.deepEqual(selectTerminalTransitionLog(state, 'terminal-1').map((transition) => transition.kind), ['entered'])
  })

  test('monitoringStateReducer appends updated transition when semantic tuple changes', () => {
    let state = createMonitoringState()
    const firstEntry = createEntry({ terminalId: 'terminal-1', updatedAt: 1 })
    const secondEntry = createEntry({
      terminalId: 'terminal-1',
      cause: 'error',
      confidence: 'medium',
      summary: 'Process failed',
      updatedAt: 2
    })

    state = monitoringStateReducer(state, { type: 'upsert', entry: firstEntry })
    state = monitoringStateReducer(state, { type: 'append-transition', transition: createTransition() })
    state = monitoringStateReducer(state, { type: 'upsert', entry: secondEntry })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:2:updated',
        sequence: 2,
        timestamp: 2,
        kind: 'updated',
        cause: 'error',
        confidence: 'medium',
        summary: 'Process failed'
      })
    })

    assert.deepEqual(selectTerminalTransitionLog(state, 'terminal-1').map((transition) => transition.kind), ['entered', 'updated'])
    assert.equal(state.byTerminalId['terminal-1']?.cause, 'error')
  })

  test('monitoringStateReducer coalesces unchanged upserts without appending a transition', () => {
    let state = createMonitoringState()
    const entry = createEntry({ terminalId: 'terminal-1', updatedAt: 1 })

    state = monitoringStateReducer(state, { type: 'upsert', entry })
    state = monitoringStateReducer(state, { type: 'append-transition', transition: createTransition() })
    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-1', updatedAt: 2 })
    })

    assert.equal(selectTerminalTransitionLog(state, 'terminal-1').length, 1)
    assert.equal(state.byTerminalId['terminal-1']?.updatedAt, 2)
  })

  test('monitoringStateReducer appends cleared transition and keeps prior chronology', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, { type: 'upsert', entry: createEntry({ terminalId: 'terminal-1' }) })
    state = monitoringStateReducer(state, { type: 'append-transition', transition: createTransition() })
    state = monitoringStateReducer(state, { type: 'clear', terminalId: 'terminal-1' })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:2:cleared',
        sequence: 2,
        timestamp: 2,
        kind: 'cleared',
        reason: 'write'
      })
    })

    assert.equal(state.byTerminalId['terminal-1'], undefined)
    assert.deepEqual(selectTerminalTransitionLog(state, 'terminal-1').map((transition) => transition.kind), ['entered', 'cleared'])
  })

  test('monitoringStateReducer keeps transition logs isolated per terminal', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, { type: 'append-transition', transition: createTransition({ terminalId: 'terminal-1', id: 'terminal-1:1:entered' }) })
    state = monitoringStateReducer(state, { type: 'append-transition', transition: createTransition({ terminalId: 'terminal-2', id: 'terminal-2:1:entered' }) })

    assert.equal(selectTerminalTransitionLog(state, 'terminal-1').length, 1)
    assert.equal(selectTerminalTransitionLog(state, 'terminal-2').length, 1)
    assert.equal(selectTerminalTransitionLog(state, 'terminal-1')[0]?.terminalId, 'terminal-1')
  })

  test('monitoringStateReducer keeps only the newest 20 transitions per terminal', () => {
    let state = createMonitoringState()

    for (let sequence = 1; sequence <= MAX_MONITORING_TRANSITIONS_PER_TERMINAL + 1; sequence++) {
      state = monitoringStateReducer(state, {
        type: 'append-transition',
        transition: createTransition({
          id: `terminal-1:${sequence}:updated`,
          sequence,
          timestamp: sequence,
          kind: sequence === 1 ? 'entered' : 'updated'
        })
      })
    }

    const transitions = selectTerminalTransitionLog(state, 'terminal-1')
    assert.equal(transitions.length, MAX_MONITORING_TRANSITIONS_PER_TERMINAL)
    assert.equal(transitions[0]?.sequence, 2)
    assert.equal(transitions[transitions.length - 1]?.sequence, MAX_MONITORING_TRANSITIONS_PER_TERMINAL + 1)
  })

  test('formatMonitoringTransitionDisplay keeps no-api transitions tentative', () => {
    const copy = formatMonitoringTransitionDisplay(createTransition({
      kind: 'updated',
      source: 'no-api',
      confidence: 'low'
    }))

    assert.match(copy.title, /updated · possible approval needed/i)
    assert.match(copy.meta, /no-api hint/i)
  })

  test('formatMonitoringTransitionDisplay does not overstate cleared transitions as success', () => {
    const copy = formatMonitoringTransitionDisplay(createTransition({
      kind: 'cleared',
      reason: 'write'
    }))

    assert.match(copy.title, /attention state cleared/i)
    assert.doesNotMatch(copy.title, /success|resolved|completed/i)
    assert.match(copy.meta, /after local input/i)
  })

  test('monitoringStateReducer reset clears live state and transition logs', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, { type: 'upsert', entry: createEntry({ terminalId: 'terminal-1' }) })
    state = monitoringStateReducer(state, { type: 'append-transition', transition: createTransition() })
    state = monitoringStateReducer(state, { type: 'reset' })

    assert.deepEqual(state.byTerminalId, {})
    assert.deepEqual(state.transitionLogByTerminalId, {})
  })

  test('slice4 exports a bounded global transition feed selector', () => {
    const { maxGlobalMonitoringFeedItems } = requireGlobalTransitionFeed()
    assert.ok(maxGlobalMonitoringFeedItems > 0)
  })

  test('selectGlobalTransitionFeed flattens multiple terminals newest-first', () => {
    const { selectGlobalTransitionFeed } = requireGlobalTransitionFeed()
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:1:entered',
        terminalId: 'terminal-1',
        timestamp: 10,
        sequence: 1,
        summary: 'Approval needed'
      })
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-2:1:entered',
        terminalId: 'terminal-2',
        timestamp: 20,
        sequence: 1,
        summary: 'Process failed'
      })
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-3:1:cleared',
        terminalId: 'terminal-3',
        timestamp: 30,
        sequence: 1,
        kind: 'cleared',
        reason: 'write',
        summary: 'Attention state cleared'
      })
    })

    const feed = selectGlobalTransitionFeed(state)

    assert.deepEqual(
      feed.map((entry) => `${entry.terminalId}:${entry.kind}:${entry.timestamp}`),
      [
        'terminal-3:cleared:30',
        'terminal-2:entered:20',
        'terminal-1:entered:10'
      ]
    )
  })

  test('selectGlobalTransitionFeed uses renderer receipt order for equal timestamps across terminals', () => {
    const { selectGlobalTransitionFeed } = requireGlobalTransitionFeed()
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:1:entered',
        terminalId: 'terminal-1',
        timestamp: 100,
        sequence: 1,
        summary: 'First received'
      })
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-2:1:entered',
        terminalId: 'terminal-2',
        timestamp: 100,
        sequence: 1,
        summary: 'Second received'
      })
    })

    const feed = selectGlobalTransitionFeed(state)

    assert.deepEqual(
      feed.map((entry) => `${entry.terminalId}:${entry.receiptOrder}`),
      [
        'terminal-2:2',
        'terminal-1:1'
      ]
    )
  })

  test('selectGlobalTransitionFeed keeps historical rows after clear but marks them inactive', () => {
    const { selectGlobalTransitionFeed } = requireGlobalTransitionFeed()
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-1', summary: 'Approval needed' })
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:1:entered',
        terminalId: 'terminal-1',
        timestamp: 1,
        sequence: 1,
        summary: 'Approval needed'
      })
    })
    state = monitoringStateReducer(state, { type: 'clear', terminalId: 'terminal-1' })

    const feed = selectGlobalTransitionFeed(state)

    assert.equal(feed.length, 1)
    assert.equal(feed[0]?.terminalId, 'terminal-1')
    assert.equal(feed[0]?.currentAttention, false)
    assert.match(feed[0]?.title ?? '', /entered/i)
  })

  test('selectGlobalTransitionFeed remains bounded to the configured global limit', () => {
    const { selectGlobalTransitionFeed, maxGlobalMonitoringFeedItems } = requireGlobalTransitionFeed()
    let state = createMonitoringState()

    for (let index = 1; index <= maxGlobalMonitoringFeedItems + 3; index++) {
      state = monitoringStateReducer(state, {
        type: 'append-transition',
        transition: createTransition({
          id: `terminal-${index}:${index}:updated`,
          terminalId: `terminal-${index}`,
          timestamp: index,
          sequence: index,
          kind: index === 1 ? 'entered' : 'updated',
          summary: `Transition ${index}`
        })
      })
    }

    const feed = selectGlobalTransitionFeed(state)

    assert.equal(feed.length, maxGlobalMonitoringFeedItems)
    assert.equal(feed[0]?.timestamp, maxGlobalMonitoringFeedItems + 3)
    assert.equal(feed[feed.length - 1]?.timestamp, 4)
  })

  test('selectGlobalTransitionFeed resets with the rest of volatile monitoring state', () => {
    const { selectGlobalTransitionFeed } = requireGlobalTransitionFeed()
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:1:entered',
        terminalId: 'terminal-1',
        timestamp: 1,
        sequence: 1
      })
    })
    state = monitoringStateReducer(state, { type: 'reset' })

    assert.deepEqual(selectGlobalTransitionFeed(state), [])
  })

  test('slice5 exports a bounded live-state attention queue selector', () => {
    const { maxMonitoringQueueItems } = requireAttentionQueue()
    assert.ok(maxMonitoringQueueItems > 0)
  })

  test('selectAttentionQueue derives membership from live state rather than history-only rows', () => {
    const { selectAttentionQueue } = requireAttentionQueue()
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:1:entered',
        terminalId: 'terminal-1',
        timestamp: 10,
        sequence: 1,
        summary: 'Historical row only'
      })
    })
    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({
        terminalId: 'terminal-2',
        summary: 'Live unresolved queue row',
        updatedAt: 20
      })
    })

    const queue = selectAttentionQueue(state)

    assert.deepEqual(queue.map((entry: { terminalId: string }) => entry.terminalId), ['terminal-2'])
  })

  test('selectAttentionQueue keeps live headline meta and update time primary while transition detail stays secondary', () => {
    const { selectAttentionQueue } = requireAttentionQueue()
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({
        terminalId: 'terminal-1',
        cause: 'approval',
        confidence: 'high',
        source: 'llm',
        summary: 'Live queue truth',
        updatedAt: 200
      })
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:2:updated',
        terminalId: 'terminal-1',
        timestamp: 150,
        sequence: 2,
        kind: 'updated',
        cause: 'error',
        confidence: 'medium',
        source: 'llm',
        summary: 'Secondary transition detail'
      })
    })

    const queue = selectAttentionQueue(state)

    assert.equal(queue.length, 1)
    assert.equal(queue[0]?.terminalId, 'terminal-1')
    assert.equal(queue[0]?.updatedAt, 200)
    assert.equal(queue[0]?.headline, 'Approval needed')
    assert.match(queue[0]?.meta ?? '', /llm classification · high confidence/i)
    assert.equal(queue[0]?.detail, 'Secondary transition detail')
    assert.equal(queue[0]?.latestTransitionTimestamp, 150)
  })

  test('selectAttentionQueue orders by live updatedAt before transition timestamps', () => {
    const { selectAttentionQueue } = requireAttentionQueue()
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({
        terminalId: 'terminal-1',
        summary: 'Newest live row',
        updatedAt: 300
      })
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:2:updated',
        terminalId: 'terminal-1',
        timestamp: 100,
        sequence: 2,
        kind: 'updated'
      })
    })
    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({
        terminalId: 'terminal-2',
        summary: 'Older live row',
        updatedAt: 200
      })
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-2:2:updated',
        terminalId: 'terminal-2',
        timestamp: 999,
        sequence: 2,
        kind: 'updated'
      })
    })

    const queue = selectAttentionQueue(state)

    assert.deepEqual(queue.map((entry: { terminalId: string }) => entry.terminalId), ['terminal-1', 'terminal-2'])
  })

  test('selectAttentionQueue uses latest transition timestamp then receipt order to break live-time ties', () => {
    const { selectAttentionQueue } = requireAttentionQueue()
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({
        terminalId: 'terminal-1',
        summary: 'First live tie',
        updatedAt: 500
      })
    })
    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({
        terminalId: 'terminal-2',
        summary: 'Second live tie',
        updatedAt: 500
      })
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:2:updated',
        terminalId: 'terminal-1',
        timestamp: 400,
        sequence: 2,
        kind: 'updated',
        summary: 'Earlier tie-break'
      })
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-2:2:updated',
        terminalId: 'terminal-2',
        timestamp: 400,
        sequence: 2,
        kind: 'updated',
        summary: 'Later tie-break'
      })
    })

    const queue = selectAttentionQueue(state)

    assert.deepEqual(
      queue.map((entry: { terminalId: string; latestTransitionReceiptOrder: number }) => `${entry.terminalId}:${entry.latestTransitionReceiptOrder}`),
      ['terminal-2:2', 'terminal-1:1']
    )
  })

  test('selectAttentionQueue removes terminals immediately after clear even if history remains', () => {
    const { selectAttentionQueue } = requireAttentionQueue()
    const { selectGlobalTransitionFeed } = requireGlobalTransitionFeed()
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({
        terminalId: 'terminal-1',
        summary: 'Needs approval',
        updatedAt: 100
      })
    })
    state = monitoringStateReducer(state, {
      type: 'append-transition',
      transition: createTransition({
        id: 'terminal-1:1:entered',
        terminalId: 'terminal-1',
        timestamp: 100,
        sequence: 1,
        summary: 'Needs approval'
      })
    })
    state = monitoringStateReducer(state, { type: 'clear', terminalId: 'terminal-1' })

    const queue = selectAttentionQueue(state)
    const feed = selectGlobalTransitionFeed(state)

    assert.deepEqual(queue, [])
    assert.equal(feed.length, 1)
    assert.equal(feed[0]?.terminalId, 'terminal-1')
    assert.equal(feed[0]?.currentAttention, false)
  })

  test('selectAttentionQueue remains bounded to the configured queue limit', () => {
    const { selectAttentionQueue, maxMonitoringQueueItems } = requireAttentionQueue()
    let state = createMonitoringState()

    for (let index = 1; index <= maxMonitoringQueueItems + 3; index++) {
      state = monitoringStateReducer(state, {
        type: 'upsert',
        entry: createEntry({
          terminalId: `terminal-${index}`,
          updatedAt: index,
          summary: `Queue item ${index}`
        })
      })
    }

    const queue = selectAttentionQueue(state)

    assert.equal(queue.length, maxMonitoringQueueItems)
    assert.equal(queue[0]?.terminalId, `terminal-${maxMonitoringQueueItems + 3}`)
    assert.equal(queue[queue.length - 1]?.terminalId, 'terminal-4')
  })

  test('selectAttentionQueue resets with the rest of volatile monitoring state', () => {
    const { selectAttentionQueue } = requireAttentionQueue()
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({
        terminalId: 'terminal-1',
        updatedAt: 10
      })
    })
    state = monitoringStateReducer(state, { type: 'reset' })

    assert.deepEqual(selectAttentionQueue(state), [])
  })

  test('selectGroupAttentionSummary counts only the requested terminals by cause', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-1', cause: 'approval' })
    })
    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-2', cause: 'error', updatedAt: 2 })
    })
    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-3', cause: 'input-needed', updatedAt: 3 })
    })

    const summary = selectGroupAttentionSummary(state, ['terminal-1', 'terminal-3'])

    assert.equal(summary.attentionCount, 2)
    assert.deepEqual(summary.byCause, {
      approval: 1,
      'input-needed': 1
    })
  })

  test('selectStatusBarAttentionSummary rolls up all attention-needed terminals', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-1', cause: 'approval' })
    })
    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-2', cause: 'error', updatedAt: 2 })
    })

    const summary = selectStatusBarAttentionSummary(state)

    assert.equal(summary.attentionCount, 2)
    assert.deepEqual(summary.byCause, {
      approval: 1,
      error: 1
    })
  })

  test('selectAffectedGroupCount counts only groups with at least one affected terminal', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-1' })
    })
    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-3', cause: 'error', updatedAt: 3 })
    })

    const count = selectAffectedGroupCount(state, [
      { id: 'group-1', terminalIds: ['terminal-1', 'terminal-2'] },
      { id: 'group-2', terminalIds: ['terminal-3'] },
      { id: 'group-3', terminalIds: ['terminal-4'] }
    ])

    assert.equal(count, 2)
  })

  test('selectGroupMonitoringIndicator reports affected terminal count and title', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-1' })
    })
    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-2', cause: 'input-needed', updatedAt: 2 })
    })

    const indicator = selectGroupMonitoringIndicator(state, ['terminal-1', 'terminal-2', 'terminal-3'])

    assert.equal(indicator.hasAttention, true)
    assert.equal(indicator.affectedTerminalCount, 2)
    assert.match(indicator.title ?? '', /2 terminals need attention/i)
  })

  test('selectTerminalMonitoringIndicator keeps tentative wording in tooltip metadata', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({
        terminalId: 'terminal-2',
        source: 'no-api',
        confidence: 'low',
        cause: 'approval',
        updatedAt: 2
      })
    })

    const indicator = selectTerminalMonitoringIndicator(state, 'terminal-2')

    assert.equal(indicator?.hasAttention, true)
    assert.equal(indicator?.tone, 'tentative')
    assert.match(indicator?.title ?? '', /possible approval needed/i)
    assert.match(indicator?.title ?? '', /no-api hint/i)
  })

  test('selectTerminalMonitoringIndicator returns null after clear removes the terminal entry', () => {
    let state = createMonitoringState()

    state = monitoringStateReducer(state, {
      type: 'upsert',
      entry: createEntry({ terminalId: 'terminal-2', updatedAt: 2 })
    })
    state = monitoringStateReducer(state, { type: 'clear', terminalId: 'terminal-2' })

    assert.equal(selectTerminalMonitoringIndicator(state, 'terminal-2'), null)
  })

  test('formatMonitoringDisplay marks no-api low-confidence entries as tentative', () => {
    const copy = formatMonitoringDisplay(createEntry({
      source: 'no-api',
      confidence: 'low',
      cause: 'approval'
    }))

    assert.equal(copy.headline, 'Possible approval needed')
    assert.match(copy.meta, /no-api hint/i)
    assert.match(copy.meta, /low confidence/i)
  })

  test('formatMonitoringDisplay keeps llm-backed high-confidence approval copy direct', () => {
    const copy = formatMonitoringDisplay(createEntry({
      source: 'llm',
      confidence: 'high',
      cause: 'approval'
    }))

    assert.equal(copy.headline, 'Approval needed')
    assert.match(copy.meta, /llm classification/i)
    assert.match(copy.meta, /high confidence/i)
  })
}
