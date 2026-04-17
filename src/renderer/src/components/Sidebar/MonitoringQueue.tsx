import React from 'react'
import { Check, Pencil, Plus, ArrowUp, ArrowDown } from 'lucide-react'
import { useMonitoring } from '../../contexts/MonitoringContext'
import { useTerminals } from '../../contexts/TerminalContext'

export function MonitoringQueue(): React.JSX.Element {
  const {
    queueItems,
    createManualTask,
    updateManualTask,
    reorderManualTasks,
    completeManualTask
  } = useMonitoring()
  const { groups, switchGroup, setActiveTerminal } = useTerminals()

  const activeQueueItems = queueItems.filter((entry) => entry.kind !== 'completed')
  const recentCompletedItems = queueItems.filter((entry) => entry.kind === 'completed')
  const manualTaskIds = activeQueueItems.filter((entry) => entry.kind === 'task').map((entry) => entry.id)

  const navigateToTerminal = (terminalId: string | null) => {
    if (!terminalId) {
      return
    }
    const group = groups.find((item) => item.terminalIds.includes(terminalId))
    if (!group) {
      return
    }
    switchGroup(group.id)
    setActiveTerminal(terminalId)
  }

  const handleCreateManualTask = async () => {
    const title = prompt('Task title')
    if (!title?.trim()) {
      return
    }
    const note = prompt('Optional note') ?? ''
    await createManualTask(title.trim(), note.trim() || null)
  }

  const handleEditTask = async (taskId: string, currentTitle: string, currentDetail: string) => {
    const title = prompt('Task title', currentTitle)
    if (!title?.trim()) {
      return
    }
    const note = prompt('Optional note', currentDetail) ?? ''
    await updateManualTask(taskId, { title: title.trim(), note: note.trim() || null })
  }

  const handleMoveTask = async (taskId: string, delta: -1 | 1) => {
    const index = manualTaskIds.indexOf(taskId)
    const swapIndex = index + delta
    if (index === -1 || swapIndex < 0 || swapIndex >= manualTaskIds.length) {
      return
    }
    const nextOrder = [...manualTaskIds]
    ;[nextOrder[index], nextOrder[swapIndex]] = [nextOrder[swapIndex], nextOrder[index]]
    await reorderManualTasks(nextOrder)
  }

  const handleCompleteTask = async (taskId: string) => {
    await completeManualTask(taskId)
  }

  return (
    <div className="sidebar__queue monitoring-queue" data-testid="monitoring-queue">
      <div className="sidebar__queue-toolbar">
        <button
          type="button"
          className="sidebar__queue-toolbar-btn"
          data-testid="monitoring-queue-add-task"
          onClick={() => void handleCreateManualTask()}
        >
          <Plus size={12} />
          <span>Add task</span>
        </button>
      </div>

      {activeQueueItems.map((entry) => {
        const isManualTask = entry.kind === 'task'
        return (
          <button
            key={entry.id}
            type="button"
            className="sidebar__queue-item monitoring-queue__row"
            data-testid="monitoring-queue-row"
            onClick={() => navigateToTerminal(entry.terminalId)}
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
              {entry.groupLabel && entry.terminalLabel
                ? `${entry.groupLabel} · ${entry.terminalLabel}`
                : 'Manual task'}
            </span>
            <span className="sidebar__queue-item-meta">{entry.meta}</span>
            {entry.detail && (
              <span className="sidebar__queue-item-detail" title={entry.detail}>
                {entry.detail}
              </span>
            )}
            {isManualTask && (
              <span className="sidebar__queue-item-actions">
                <button
                  type="button"
                  className="sidebar__queue-action-btn"
                  title="Move up"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleMoveTask(entry.id, -1)
                  }}
                >
                  <ArrowUp size={11} />
                </button>
                <button
                  type="button"
                  className="sidebar__queue-action-btn"
                  title="Move down"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleMoveTask(entry.id, 1)
                  }}
                >
                  <ArrowDown size={11} />
                </button>
                <button
                  type="button"
                  className="sidebar__queue-action-btn"
                  title="Edit task"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleEditTask(entry.id, entry.headline, entry.detail)
                  }}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  className="sidebar__queue-action-btn"
                  title="Complete task"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleCompleteTask(entry.id)
                  }}
                >
                  <Check size={11} />
                </button>
              </span>
            )}
          </button>
        )
      })}

      {recentCompletedItems.length > 0 && (
        <div className="sidebar__queue-completed">
          <div className="sidebar__queue-completed-title">Recent completed</div>
          {recentCompletedItems.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="sidebar__queue-item sidebar__queue-item--completed"
              onClick={() => navigateToTerminal(entry.terminalId)}
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
                {entry.groupLabel && entry.terminalLabel
                  ? `${entry.groupLabel} · ${entry.terminalLabel}`
                  : 'Completed task'}
              </span>
              <span className="sidebar__queue-item-meta">{entry.meta}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default MonitoringQueue
