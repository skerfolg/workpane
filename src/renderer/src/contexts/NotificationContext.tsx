import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
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

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}

export function NotificationProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const pendingFocusRef = useRef<{ terminalId: string } | null>(null)
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const { terminals, setActiveTerminal } = useTerminals()

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

  // Subscribe to approval detected events from main process
  useEffect(() => {
    if (!window.terminal.onApprovalDetected) return

    const unsubscribe = window.terminal.onApprovalDetected(async (event) => {
      // Check if notifications are enabled
      const enabled = await window.settings.get('notification.enabled')
      if (enabled === false) return

      const workspaceName = basename(event.workspacePath)
      const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const item: NotificationItem = {
        id,
        terminalId: event.terminalId,
        workspacePath: event.workspacePath,
        workspaceName,
        patternName: event.patternName,
        matchedText: event.matchedText,
        message: `${event.patternName} in ${workspaceName}`,
        timestamp: Date.now()
      }

      setNotifications((prev) => {
        const updated = [...prev, item]
        // Keep max 3, remove oldest (FIFO)
        return updated.length > MAX_NOTIFICATIONS ? updated.slice(updated.length - MAX_NOTIFICATIONS) : updated
      })

      scheduleAutoDismiss(id)

      // Play sound if enabled
      const sound = await window.settings.get('notification.sound')
      if (sound !== false) {
        playBeep()
      }
    })

    return () => {
      unsubscribe()
    }
  }, [scheduleAutoDismiss])

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
