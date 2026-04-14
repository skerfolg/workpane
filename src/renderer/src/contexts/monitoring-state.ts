import type {
  SessionMonitoringCategory,
  SessionMonitoringState,
  SessionMonitoringTransitionEvent,
  SessionMonitoringTransitionKind
} from '../../../shared/types'

export interface MonitoringEntry {
  terminalId: string
  workspacePath: string
  patternName: string
  matchedText: string
  status: 'attention-needed'
  cause: SessionMonitoringCategory
  confidence: 'low' | 'medium' | 'high'
  source: 'llm' | 'no-api'
  summary: string
  updatedAt: number
}

export interface MonitoringState {
  byTerminalId: Record<string, MonitoringEntry>
  transitionLogByTerminalId: Record<string, MonitoringTransitionEntry[]>
}

export interface MonitoringDisplayCopy {
  headline: string
  meta: string
}

export interface MonitoringSummary {
  attentionCount: number
  byCause: Partial<Record<SessionMonitoringCategory, number>>
}

export interface MonitoringGroupLike {
  id: string
  terminalIds: string[]
}

export interface MonitoringGroupIndicator {
  hasAttention: boolean
  affectedTerminalCount: number
  title: string | null
}

export type MonitoringIndicatorTone = 'direct' | 'tentative'

export interface MonitoringTerminalIndicator {
  hasAttention: boolean
  tone: MonitoringIndicatorTone
  title: string
}

export interface MonitoringTransitionEntry {
  id: string
  terminalId: string
  workspacePath: string
  sequence: number
  timestamp: number
  receiptOrder?: number
  kind: SessionMonitoringTransitionKind
  reason?: 'write' | 'exit'
  cause?: SessionMonitoringCategory
  confidence?: 'low' | 'medium' | 'high'
  source?: 'llm' | 'no-api'
  summary?: string
  patternName?: string
  matchedText?: string
}

export interface MonitoringTransitionDisplayCopy {
  title: string
  meta: string
  detail: string
}

export interface MonitoringGlobalFeedEntry {
  id: string
  terminalId: string
  timestamp: number
  receiptOrder: number
  kind: SessionMonitoringTransitionKind
  title: string
  meta: string
  detail: string
  currentAttention: boolean
}

export interface MonitoringQueueEntry {
  terminalId: string
  updatedAt: number
  headline: string
  meta: string
  detail: string
  latestTransitionTimestamp: number | null
  latestTransitionReceiptOrder: number
}

export type MonitoringStateAction =
  | { type: 'upsert'; entry: MonitoringEntry }
  | { type: 'clear'; terminalId: string }
  | { type: 'append-transition'; transition: MonitoringTransitionEntry }
  | { type: 'reset' }

export const MAX_MONITORING_TRANSITIONS_PER_TERMINAL = 20
export const MAX_GLOBAL_MONITORING_FEED_ITEMS = 10
export const MAX_MONITORING_QUEUE_ITEMS = 10

export function createMonitoringState(): MonitoringState {
  return {
    byTerminalId: {},
    transitionLogByTerminalId: {}
  }
}

export function toMonitoringEntry(event: SessionMonitoringState): MonitoringEntry {
  return {
    terminalId: event.terminalId,
    workspacePath: event.workspacePath,
    patternName: event.patternName,
    matchedText: event.matchedText,
    status: event.status,
    cause: event.category,
    confidence: event.confidence,
    source: event.source,
    summary: event.summary,
    updatedAt: event.timestamp
  }
}

export function monitoringStateReducer(state: MonitoringState, action: MonitoringStateAction): MonitoringState {
  if (action.type === 'reset') {
    return createMonitoringState()
  }

  if (action.type === 'upsert') {
    return {
      byTerminalId: {
        ...state.byTerminalId,
        [action.entry.terminalId]: action.entry
      },
      transitionLogByTerminalId: state.transitionLogByTerminalId
    }
  }

  if (action.type === 'append-transition') {
    const existing = state.transitionLogByTerminalId[action.transition.terminalId] ?? []
    const nextReceiptOrder = action.transition.receiptOrder ?? getNextMonitoringReceiptOrder(state)
    const next = [...existing, { ...action.transition, receiptOrder: nextReceiptOrder }]
    if (next.length > MAX_MONITORING_TRANSITIONS_PER_TERMINAL) {
      next.splice(0, next.length - MAX_MONITORING_TRANSITIONS_PER_TERMINAL)
    }
    return {
      byTerminalId: state.byTerminalId,
      transitionLogByTerminalId: {
        ...state.transitionLogByTerminalId,
        [action.transition.terminalId]: next
      }
    }
  }

  if (!(action.terminalId in state.byTerminalId)) {
    return state
  }

  const nextByTerminalId = { ...state.byTerminalId }
  delete nextByTerminalId[action.terminalId]

  return {
    byTerminalId: nextByTerminalId,
    transitionLogByTerminalId: state.transitionLogByTerminalId
  }
}

function getNextMonitoringReceiptOrder(state: MonitoringState): number {
  let maxReceiptOrder = 0

  for (const transitions of Object.values(state.transitionLogByTerminalId)) {
    for (const transition of transitions) {
      if ((transition.receiptOrder ?? 0) > maxReceiptOrder) {
        maxReceiptOrder = transition.receiptOrder ?? 0
      }
    }
  }

  return maxReceiptOrder + 1
}

function buildSummary(entries: MonitoringEntry[]): MonitoringSummary {
  const byCause: Partial<Record<SessionMonitoringCategory, number>> = {}

  for (const entry of entries) {
    byCause[entry.cause] = (byCause[entry.cause] ?? 0) + 1
  }

  return {
    attentionCount: entries.length,
    byCause
  }
}

export function selectGroupAttentionSummary(state: MonitoringState, terminalIds: string[]): MonitoringSummary {
  const scopedEntries = terminalIds
    .map((terminalId) => state.byTerminalId[terminalId])
    .filter((entry): entry is MonitoringEntry => entry != null)

  return buildSummary(scopedEntries)
}

export function selectStatusBarAttentionSummary(state: MonitoringState): MonitoringSummary {
  return buildSummary(Object.values(state.byTerminalId))
}

export function selectAffectedGroupCount(state: MonitoringState, groups: MonitoringGroupLike[]): number {
  return groups.reduce((count, group) => {
    const summary = selectGroupAttentionSummary(state, group.terminalIds)
    return count + (summary.attentionCount > 0 ? 1 : 0)
  }, 0)
}

export function selectGroupMonitoringIndicator(
  state: MonitoringState,
  terminalIds: string[]
): MonitoringGroupIndicator {
  const summary = selectGroupAttentionSummary(state, terminalIds)
  if (summary.attentionCount === 0) {
    return {
      hasAttention: false,
      affectedTerminalCount: 0,
      title: null
    }
  }

  const suffix = summary.attentionCount === 1 ? '' : 's'
  return {
    hasAttention: true,
    affectedTerminalCount: summary.attentionCount,
    title: `${summary.attentionCount} terminal${suffix} need attention`
  }
}

export function formatMonitoringDisplay(entry: MonitoringEntry): MonitoringDisplayCopy {
  const isTentative = entry.source === 'no-api' || entry.confidence === 'low'

  let headline = 'Attention needed'
  if (entry.cause === 'approval') {
    headline = isTentative ? 'Possible approval needed' : 'Approval needed'
  } else if (entry.cause === 'input-needed') {
    headline = isTentative ? 'Possible input needed' : 'Input needed'
  } else if (entry.cause === 'error') {
    headline = isTentative ? 'Possible issue detected' : 'Attention needed'
  }

  return {
    headline,
    meta: entry.source === 'no-api'
      ? `no-api hint · ${entry.confidence} confidence`
      : `llm classification · ${entry.confidence} confidence`
  }
}

export function toMonitoringTransitionEntry(
  event: SessionMonitoringTransitionEvent
): MonitoringTransitionEntry {
  return {
    id: event.id,
    terminalId: event.terminalId,
    workspacePath: event.workspacePath,
    sequence: event.sequence,
    timestamp: event.timestamp,
    kind: event.kind,
    reason: event.reason,
    cause: event.category,
    confidence: event.confidence,
    source: event.source,
    summary: event.summary,
    patternName: event.patternName,
    matchedText: event.matchedText
  }
}

export function selectTerminalTransitionLog(
  state: MonitoringState,
  terminalId: string | null | undefined
): MonitoringTransitionEntry[] {
  if (!terminalId) {
    return []
  }
  return state.transitionLogByTerminalId[terminalId] ?? []
}

export function selectGlobalTransitionFeed(
  state: MonitoringState,
  options?: { limit?: number }
): MonitoringGlobalFeedEntry[] {
  const limit = options?.limit ?? MAX_GLOBAL_MONITORING_FEED_ITEMS

  const flattened = Object.values(state.transitionLogByTerminalId)
    .flat()
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return right.timestamp - left.timestamp
      }

      return (right.receiptOrder ?? 0) - (left.receiptOrder ?? 0)
    })
    .slice(0, limit)

  return flattened.map((entry) => {
    const display = formatMonitoringTransitionDisplay(entry)

    return {
      id: entry.id,
      terminalId: entry.terminalId,
      timestamp: entry.timestamp,
      receiptOrder: entry.receiptOrder ?? 0,
      kind: entry.kind,
      title: display.title,
      meta: display.meta,
      detail: display.detail,
      currentAttention: state.byTerminalId[entry.terminalId] != null
    }
  })
}

export function selectAttentionQueue(
  state: MonitoringState,
  options?: { limit?: number }
): MonitoringQueueEntry[] {
  const limit = options?.limit ?? MAX_MONITORING_QUEUE_ITEMS

  return Object.values(state.byTerminalId)
    .map((entry) => {
      const display = formatMonitoringDisplay(entry)
      const latestTransition = selectTerminalTransitionLog(state, entry.terminalId).at(-1) ?? null
      const latestTransitionDisplay = latestTransition ? formatMonitoringTransitionDisplay(latestTransition) : null

      return {
        terminalId: entry.terminalId,
        updatedAt: entry.updatedAt,
        headline: display.headline,
        meta: display.meta,
        detail: latestTransitionDisplay?.detail ?? '',
        latestTransitionTimestamp: latestTransition?.timestamp ?? null,
        latestTransitionReceiptOrder: latestTransition?.receiptOrder ?? 0
      }
    })
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt - left.updatedAt
      }

      if ((left.latestTransitionTimestamp ?? 0) !== (right.latestTransitionTimestamp ?? 0)) {
        return (right.latestTransitionTimestamp ?? 0) - (left.latestTransitionTimestamp ?? 0)
      }

      if (left.latestTransitionReceiptOrder !== right.latestTransitionReceiptOrder) {
        return right.latestTransitionReceiptOrder - left.latestTransitionReceiptOrder
      }

      return left.terminalId.localeCompare(right.terminalId)
    })
    .slice(0, limit)
}

export function formatMonitoringTransitionDisplay(
  entry: MonitoringTransitionEntry
): MonitoringTransitionDisplayCopy {
  if (entry.kind === 'cleared') {
    return {
      title: 'Attention state cleared',
      meta: entry.reason === 'exit' ? 'cleared · on terminal exit' : 'cleared · after local input',
      detail: entry.summary ?? entry.patternName ?? entry.matchedText ?? ''
    }
  }

  const display = entry.cause != null && entry.confidence != null && entry.source != null
    ? formatMonitoringDisplay({
      terminalId: entry.terminalId,
      workspacePath: entry.workspacePath,
      patternName: entry.patternName ?? '',
      matchedText: entry.matchedText ?? '',
      status: 'attention-needed',
      cause: entry.cause,
      confidence: entry.confidence,
      source: entry.source,
      summary: entry.summary ?? '',
      updatedAt: entry.timestamp
    })
    : {
      headline: 'Attention needed',
      meta: 'transition'
    }

  return {
    title: `${entry.kind === 'entered' ? 'Entered' : 'Updated'} · ${display.headline}`,
    meta: `${entry.kind} · ${display.meta}`,
    detail: entry.summary ?? entry.matchedText ?? entry.patternName ?? ''
  }
}

export function selectTerminalMonitoringIndicator(
  state: MonitoringState,
  terminalId: string
): MonitoringTerminalIndicator | null {
  const entry = state.byTerminalId[terminalId]
  if (!entry) {
    return null
  }

  const display = formatMonitoringDisplay(entry)
  const tone: MonitoringIndicatorTone =
    entry.source === 'no-api' || entry.confidence === 'low' ? 'tentative' : 'direct'

  return {
    hasAttention: true,
    tone,
    title: `${display.headline} · ${display.meta}`
  }
}
