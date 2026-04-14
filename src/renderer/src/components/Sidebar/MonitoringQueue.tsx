import React from 'react'
import { useMonitoring } from '../../contexts/MonitoringContext'
import { useTerminals } from '../../contexts/TerminalContext'

export function MonitoringQueue(): React.JSX.Element {
  const { attentionQueue } = useMonitoring()
  const { groups, switchGroup, setActiveTerminal } = useTerminals()

  const handleQueueClick = (terminalId: string) => {
    const group = groups.find((item) => item.terminalIds.includes(terminalId))
    if (!group) {
      return
    }

    switchGroup(group.id)
    setActiveTerminal(terminalId)
  }

  return (
    <div className="sidebar__queue monitoring-queue" data-testid="monitoring-queue">
      {attentionQueue.map((entry) => (
        <button
          key={entry.terminalId}
          type="button"
          className="sidebar__queue-item monitoring-queue__row"
          data-testid="monitoring-queue-row"
          onClick={() => handleQueueClick(entry.terminalId)}
        >
          <div className="sidebar__queue-item-top">
            <span className="sidebar__queue-item-headline">{entry.headline}</span>
            <span className="sidebar__queue-item-time">
              {new Date(entry.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
            </span>
          </div>
          <span className="sidebar__queue-item-location">
            {entry.groupLabel} · {entry.terminalLabel}
          </span>
          <span className="sidebar__queue-item-meta">{entry.meta}</span>
          {entry.detail && (
            <span className="sidebar__queue-item-detail" title={entry.detail}>
              {entry.detail}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export default MonitoringQueue
