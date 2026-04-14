import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import type { LlmCauseCategory } from '../../../shared/types'
import { formatMonitoringDisplay } from './monitoring-state'
import { useMonitoring } from './MonitoringContext'
import { useTerminals } from './TerminalContext'

export interface NotificationItem {
  id: string
  terminalId: string
  workspacePath: string
  workspaceName: string
  patternName: string
  matchedText: string
  message: string
  timestamp: number
  analysisSummary?: string
  analysisCategory?: LlmCauseCategory
}

interface NotificationContextValue {
  notifications: NotificationItem[]
  dismissNotification: (id: string) => void
  handleNotificationClick: (notification: NotificationItem) => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}


const MAX_NOTIFICATIONS = 3
const AUTO_DISMISS_MS = 15000

function playBeep(): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = 800
    osc.connect(ctx.destination)
    osc.start()
    setTimeout(() => {
      osc.stop()
      ctx.close()
    }, 150)
  } catch {
    // Audio not available — silently skip
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const pendingFocusRef = useRef<{ terminalId: string } | null>(null)
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const processedTransitionIds = useRef<Set<string>>(new Set())

  const { terminals, setActiveTerminal } = useTerminals()
  const { latestAttentionTransition } = useMonitoring()

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    const timer = dismissTimers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      dismissTimers.current.delete(id)
    }
  }, [])

  const scheduleAutoDismiss = useCallback((id: string) => {
    const timer = setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
      dismissTimers.current.delete(id)
    }, AUTO_DISMISS_MS)
    dismissTimers.current.set(id, timer)
  }, [])

  const handleNotificationClick = useCallback((notification: NotificationItem) => {
    pendingFocusRef.current = { terminalId: notification.terminalId }
    window.workspace.openPath(notification.workspacePath)
    dismissNotification(notification.id)
  }, [dismissNotification])

  // When terminals list updates, check if we have a pending focus to apply
  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    const exists = terminals.some((t) => t.id === pending.terminalId)
    if (exists) {
      setActiveTerminal(pending.terminalId)
      pendingFocusRef.current = null
    }
  }, [terminals, setActiveTerminal])

  useEffect(() => {
    if (!latestAttentionTransition) return
    if (processedTransitionIds.current.has(latestAttentionTransition.id)) return

    processedTransitionIds.current.add(latestAttentionTransition.id)

    let cancelled = false
    void (async () => {
      const enabled = await window.settings.get('notification.enabled')
      if (cancelled || enabled === false) return

      const id = `notif-${latestAttentionTransition.sequence}`
      const item: NotificationItem = {
        id,
        terminalId: latestAttentionTransition.terminalId,
        workspacePath: latestAttentionTransition.workspacePath,
        workspaceName: latestAttentionTransition.workspaceName,
        patternName: latestAttentionTransition.patternName,
        matchedText: latestAttentionTransition.matchedText,
        message: latestAttentionTransition.analysisSummary,
        timestamp: latestAttentionTransition.timestamp,
        analysisSummary: `${latestAttentionTransition.analysisSummary} · ${formatMonitoringDisplay({
          terminalId: latestAttentionTransition.terminalId,
          workspacePath: latestAttentionTransition.workspacePath,
          patternName: latestAttentionTransition.patternName,
          matchedText: latestAttentionTransition.matchedText,
          status: 'attention-needed',
          cause: latestAttentionTransition.analysisCategory,
          confidence: latestAttentionTransition.confidence,
          source: latestAttentionTransition.source,
          summary: latestAttentionTransition.analysisSummary,
          updatedAt: latestAttentionTransition.timestamp
        }).meta}`,
        analysisCategory: latestAttentionTransition.analysisCategory
      }

      setNotifications((prev) => {
        const updated = [...prev, item]
        return updated.length > MAX_NOTIFICATIONS
          ? updated.slice(updated.length - MAX_NOTIFICATIONS)
          : updated
      })

      scheduleAutoDismiss(id)

      const sound = await window.settings.get('notification.sound')
      if (!cancelled && sound !== false) {
        playBeep()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [latestAttentionTransition, scheduleAutoDismiss])

  // Clear all timers on unmount
  useEffect(() => {
    const timers = dismissTimers.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
    }
  }, [])

  return (
    <NotificationContext.Provider value={{ notifications, dismissNotification, handleNotificationClick }}>
      {children}
    </NotificationContext.Provider>
  )
}
