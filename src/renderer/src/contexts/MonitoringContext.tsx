import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import type {
  LlmCauseCategory,
  SessionMonitoringClearEvent,
  SessionMonitoringState,
  SessionMonitoringTransitionEvent
} from '../../../shared/types'
import { useTerminals } from './TerminalContext'
import type { MonitoringEntry, MonitoringState, MonitoringSummary } from './monitoring-state'
import {
  createMonitoringState,
  formatMonitoringTransitionDisplay,
  monitoringStateReducer,
  selectAffectedGroupCount,
  selectAttentionQueue,
  selectGlobalTransitionFeed,
  selectGroupMonitoringIndicator,
  selectGroupAttentionSummary,
  selectStatusBarAttentionSummary,
  selectTerminalMonitoringIndicator,
  selectTerminalTransitionLog,
  toMonitoringTransitionEntry,
  toMonitoringEntry
} from './monitoring-state'

export interface MonitoringAggregate {
  attentionNeededCount: number
  causeCounts: Partial<Record<LlmCauseCategory, number>>
}

export interface MonitoringTerminalState {
  terminalId: string
  attentionNeeded: boolean
  analysisCategory: LlmCauseCategory
  analysisSummary: string
  confidence: 'low' | 'medium' | 'high'
  source: 'llm' | 'no-api'
  matchedText: string
  patternName: string
  updatedAt: number
}

export interface MonitoringSectionCue {
  affectedGroupCount: number
}

export interface MonitoringGroupState {
  hasAttention: boolean
  affectedTerminalCount: number
  title: string | null
}

export interface MonitoringSidebarTerminalState {
  hasAttention: boolean
  title: string
  tone: 'direct' | 'tentative'
}

export interface AttentionTransition {
  id: string
  sequence: number
  terminalId: string
  workspacePath: string
  workspaceName: string
  patternName: string
  matchedText: string
  analysisSummary: string
  analysisCategory: LlmCauseCategory
  confidence: 'low' | 'medium' | 'high'
  source: 'llm' | 'no-api'
  timestamp: number
}

export interface MonitoringPanelTransitionState {
  id: string
  sequence: number
  kind: 'entered' | 'updated' | 'cleared'
  timestamp: number
  title: string
  meta: string
  detail: string
}

export interface MonitoringGlobalTransitionState {
  id: string
  terminalId: string
  timestamp: number
  title: string
  meta: string
  detail: string
  terminalLabel: string
  groupLabel: string
  currentAttention: boolean
  isAvailable: boolean
}

export interface MonitoringQueueState {
  terminalId: string
  terminalLabel: string
  groupLabel: string
  headline: string
  meta: string
  detail: string
  timestamp: number
}

interface MonitoringContextValue {
  state: MonitoringState
  activeGroupAggregate: MonitoringAggregate
  globalAggregate: MonitoringAggregate
  globalTransitionFeed: MonitoringGlobalTransitionState[]
  attentionQueue: MonitoringQueueState[]
  sidebarSectionCue: MonitoringSectionCue
  latestAttentionTransition: AttentionTransition | null
  getEntry: (terminalId: string | null | undefined) => MonitoringEntry | null
  getGroupSummary: (terminalIds: string[]) => MonitoringAggregate
  getGroupMonitoringState: (groupId: string) => MonitoringGroupState
  getTerminalMonitoringState: (terminalId: string) => MonitoringSidebarTerminalState | null
  getTerminalTransitionLog: (terminalId: string | null | undefined) => MonitoringPanelTransitionState[]
}

const MonitoringContext = createContext<MonitoringContextValue | null>(null)

export function useMonitoring(): MonitoringContextValue {
  const ctx = useContext(MonitoringContext)
  if (!ctx) {
    throw new Error('useMonitoring must be used within MonitoringProvider')
  }
  return ctx
}

function basename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? filePath
}

function toAggregate(summary: MonitoringSummary): MonitoringAggregate {
  return {
    attentionNeededCount: summary.attentionCount,
    causeCounts: summary.byCause
  }
}

export function MonitoringProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { terminals, groups, activeGroupId } = useTerminals()
  const [state, setState] = useState<MonitoringState>(() => createMonitoringState())
  const [latestAttentionTransition, setLatestAttentionTransition] = useState<AttentionTransition | null>(null)
  const transitionSequenceRef = useRef(0)

  useEffect(() => {
    if (!window.terminal.onMonitoringUpsert || !window.terminal.onMonitoringClear) {
      return
    }

    const unsubscribeUpsert = window.terminal.onMonitoringUpsert((event: SessionMonitoringState) => {
      const entry = toMonitoringEntry(event)
      setState((prev) => {
        const hadEntry = prev.byTerminalId[entry.terminalId] != null
        const next = monitoringStateReducer(prev, { type: 'upsert', entry })
        if (!hadEntry) {
          transitionSequenceRef.current += 1
          setLatestAttentionTransition({
            id: `${entry.terminalId}:${entry.updatedAt}`,
            sequence: transitionSequenceRef.current,
            terminalId: entry.terminalId,
            workspacePath: entry.workspacePath,
            workspaceName: basename(entry.workspacePath),
            patternName: entry.patternName,
            matchedText: entry.matchedText,
            analysisSummary: entry.summary,
            analysisCategory: entry.cause,
            confidence: entry.confidence,
            source: entry.source,
            timestamp: entry.updatedAt
          })
        }
        return next
      })
    })

    const unsubscribeClear = window.terminal.onMonitoringClear((event: SessionMonitoringClearEvent) => {
      setState((prev) => monitoringStateReducer(prev, { type: 'clear', terminalId: event.terminalId }))
    })

    const unsubscribeTransition = window.terminal.onMonitoringTransition?.((event: SessionMonitoringTransitionEvent) => {
      const transition = toMonitoringTransitionEntry(event)
      setState((prev) => monitoringStateReducer(prev, { type: 'append-transition', transition }))
    })

    return () => {
      unsubscribeUpsert()
      unsubscribeClear()
      unsubscribeTransition?.()
    }
  }, [])

  useEffect(() => {
    const workspaceApi = window.workspace
    if (!workspaceApi?.onChanged) {
      return
    }

    const resetMonitoringState = () => {
      setState(createMonitoringState())
      setLatestAttentionTransition(null)
    }

    const unsubscribe = workspaceApi.onChanged(() => {
      resetMonitoringState()
    })

    return unsubscribe
  }, [])

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null
  const activeGroupAggregate = toAggregate(
    selectGroupAttentionSummary(state, activeGroup?.terminalIds ?? [])
  )
  const globalAggregate = toAggregate(selectStatusBarAttentionSummary(state))
  const sidebarSectionCue: MonitoringSectionCue = {
    affectedGroupCount: selectAffectedGroupCount(state, groups)
  }
  const groupMonitoringStateById = Object.fromEntries(
    groups.map((group) => [group.id, selectGroupMonitoringIndicator(state, group.terminalIds)])
  ) satisfies Record<string, MonitoringGroupState>
  const attentionQueue: MonitoringQueueState[] = []
  for (const entry of selectAttentionQueue(state)) {
    const terminal = terminals.find((item) => item.id === entry.terminalId) ?? null
    const group = groups.find((item) => item.terminalIds.includes(entry.terminalId)) ?? null

    if (!terminal || !group) {
      continue
    }

    attentionQueue.push({
      terminalId: entry.terminalId,
      terminalLabel: terminal.name,
      groupLabel: group.name,
      headline: entry.headline,
      meta: entry.meta,
      detail: entry.detail,
      timestamp: entry.updatedAt
    })
  }
  const globalTransitionFeed = selectGlobalTransitionFeed(state).map((entry) => {
    const terminal = terminals.find((item) => item.id === entry.terminalId) ?? null
    const group = groups.find((item) => item.terminalIds.includes(entry.terminalId)) ?? null

    return {
      id: entry.id,
      terminalId: entry.terminalId,
      timestamp: entry.timestamp,
      title: entry.title,
      meta: entry.meta,
      detail: entry.detail,
      terminalLabel: terminal?.name ?? entry.terminalId,
      groupLabel: group?.name ?? 'Terminal unavailable',
      currentAttention: entry.currentAttention,
      isAvailable: terminal != null && group != null
    }
  })

  const value: MonitoringContextValue = {
    state,
    activeGroupAggregate,
    globalAggregate,
    globalTransitionFeed,
    attentionQueue,
    sidebarSectionCue,
    latestAttentionTransition,
    getEntry: (terminalId) => {
      if (!terminalId) {
        return null
      }
      return state.byTerminalId[terminalId] ?? null
    },
    getGroupSummary: (terminalIds) => toAggregate(selectGroupAttentionSummary(state, terminalIds)),
    getGroupMonitoringState: (groupId) => groupMonitoringStateById[groupId] ?? {
      hasAttention: false,
      affectedTerminalCount: 0,
      title: null
    },
    getTerminalMonitoringState: (terminalId) => {
      if (!terminalId) {
        return null
      }
      return selectTerminalMonitoringIndicator(state, terminalId)
    },
    getTerminalTransitionLog: (terminalId) => selectTerminalTransitionLog(state, terminalId).map((entry) => {
      const display = formatMonitoringTransitionDisplay(entry)
      return {
        id: entry.id,
        sequence: entry.sequence,
        kind: entry.kind,
        timestamp: entry.timestamp,
        title: display.title,
        meta: display.meta,
        detail: display.detail
      }
    })
  }

  return (
    <MonitoringContext.Provider value={value}>
      {children}
    </MonitoringContext.Provider>
  )
}

export function useTerminalTransitionLog(
  terminalId: string | null | undefined
): MonitoringPanelTransitionState[] {
  const { getTerminalTransitionLog } = useMonitoring()
  return getTerminalTransitionLog(terminalId)
}

export function useTerminalMonitoring(terminalId: string | null | undefined): MonitoringTerminalState | null {
  const { getEntry } = useMonitoring()
  const entry = getEntry(terminalId)
  if (!entry) {
    return null
  }

  return {
    terminalId: entry.terminalId,
    attentionNeeded: entry.status === 'attention-needed',
    analysisCategory: entry.cause,
    analysisSummary: entry.summary,
    confidence: entry.confidence,
    source: entry.source,
    matchedText: entry.matchedText,
    patternName: entry.patternName,
    updatedAt: entry.updatedAt
  }
}
