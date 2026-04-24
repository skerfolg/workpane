import { useEffect, useState } from 'react'
import type { L0Status } from '../../../shared/types'

interface TerminalApiLike {
  getL0Status?: (id: string) => Promise<L0Status>
  onL0StatusChanged?: (
    callback: (event: { terminalId: string; status: L0Status; timestamp: number }) => void
  ) => () => void
}

function getTerminalApi(): TerminalApiLike | null {
  const api = (window as unknown as { terminal?: TerminalApiLike }).terminal
  if (!api) {
    return null
  }
  return api
}

/**
 * Subscribe to the L0 supervision status for a terminal.
 *
 * Returns `null` when the renderer has no active terminal selection and
 * `{ mode: 'inactive' }` when the terminal is not vendor-hinted (DP-2
 * treats that as "L0 unavailable"). Callers decide whether to render a
 * badge for each mode.
 */
export function useL0Status(terminalId: string | null): L0Status | null {
  const [status, setStatus] = useState<L0Status | null>(null)

  useEffect(() => {
    if (!terminalId) {
      setStatus(null)
      return
    }
    const api = getTerminalApi()
    if (!api?.getL0Status || !api.onL0StatusChanged) {
      setStatus({ terminalId, mode: 'inactive' })
      return
    }

    let cancelled = false
    let eventReceived = false

    // Subscribe FIRST so inbound status events are never lost to the async
    // initial fetch below. The unsubscribe closure also guards against late
    // events after unmount.
    const unsubscribe = api.onL0StatusChanged((event) => {
      if (cancelled || event.terminalId !== terminalId) {
        return
      }
      eventReceived = true
      setStatus(event.status)
    })

    api.getL0Status(terminalId)
      .then((initial) => {
        if (cancelled || eventReceived) {
          return
        }
        setStatus(initial)
      })
      .catch(() => {
        if (cancelled || eventReceived) {
          return
        }
        setStatus({ terminalId, mode: 'inactive' })
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [terminalId])

  return status
}
