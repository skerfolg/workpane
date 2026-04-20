import React, { useMemo } from 'react'
import { Columns2, Grid2x2, Rows2, X } from 'lucide-react'
import { useMonitoring } from '../../contexts/MonitoringContext'
import { useTerminals } from '../../contexts/TerminalContext'
import type { PresetLayoutType } from '../../types/terminal-layout'
import { isGroupPresetEligible } from '../../utils/preset-layouts'
import './MissionControlOverlay.css'

interface MissionControlOverlayProps {
  isOpen: boolean
  onClose: () => void
}

export function MissionControlOverlay({
  isOpen,
  onClose
}: MissionControlOverlayProps): React.JSX.Element | null {
  const {
    groups,
    terminals,
    switchGroup,
    setActiveTerminal,
    applyPresetLayoutToGroup
  } = useTerminals()
  const { getEntry, persistedWorkspaceFeed, historyStatus } = useMonitoring()
  const nonSqliteHistoryStatus = historyStatus && historyStatus.backend !== 'sqlite'
    ? historyStatus
    : null

  const latestPersistedByTerminal = useMemo(() => {
    const map = new Map<string, (typeof persistedWorkspaceFeed)[number]>()
    for (const entry of persistedWorkspaceFeed) {
      if (!map.has(entry.terminalId)) {
        map.set(entry.terminalId, entry)
      }
    }
    return map
  }, [persistedWorkspaceFeed])

  if (!isOpen) {
    return null
  }

  const renderPresetButton = (
    groupId: string,
    layoutType: PresetLayoutType,
    title: string,
    icon: React.ReactNode,
    eligible: boolean
  ) => (
    <button
      type="button"
      className="mission-control__preset-btn"
      data-testid={`mission-control-preset-${groupId}-${layoutType}`}
      disabled={!eligible}
      title={eligible ? title : 'Presets are unavailable for groups with browser tabs'}
      aria-label={eligible ? title : `${title} unavailable for groups with browser tabs`}
      onClick={(event) => {
        event.stopPropagation()
        if (!eligible) {
          return
        }
        applyPresetLayoutToGroup(groupId, layoutType)
      }}
    >
      {icon}
    </button>
  )

  return (
    <div className="mission-control" role="dialog" aria-modal="true" aria-label="Mission Control">
      <div className="mission-control__backdrop" onClick={onClose} />
      <div className="mission-control__panel">
        <div className="mission-control__header">
          <div>
            <h2>Mission Control</h2>
            <p>Whole-workspace session overview</p>
          </div>
          <button type="button" className="mission-control__close" onClick={onClose} aria-label="Close Mission Control">
            <X size={16} />
          </button>
        </div>
        {nonSqliteHistoryStatus && (
          <div
            className="mission-control__status"
            data-testid="mission-control-history-status"
            role="status"
          >
            <strong>History backend:</strong> {nonSqliteHistoryStatus.backend} — {nonSqliteHistoryStatus.detail}
          </div>
        )}

        <div className="mission-control__groups">
          {groups.map((group) => {
            const presetEligible = isGroupPresetEligible(group)
            const sessions = group.terminalIds
              .map((terminalId) => {
                const terminal = terminals.find((item) => item.id === terminalId)
                if (!terminal) {
                  return null
                }
                const liveEntry = getEntry(terminalId)
                const recentEntry = latestPersistedByTerminal.get(terminalId) ?? null
                return {
                  terminalId,
                  terminalName: terminal.name,
                  hasAttention: liveEntry?.status === 'attention-needed',
                  headline: liveEntry?.summary ?? recentEntry?.title ?? 'No recent history',
                  meta: liveEntry
                    ? `${liveEntry.source} · ${liveEntry.confidence} confidence`
                    : recentEntry?.meta ?? 'No live attention',
                  timestamp: liveEntry?.updatedAt ?? recentEntry?.timestamp ?? 0
                }
              })
              .filter((entry): entry is NonNullable<typeof entry> => entry != null)
              .sort((left, right) => {
                if (left.hasAttention !== right.hasAttention) {
                  return left.hasAttention ? -1 : 1
                }
                return right.timestamp - left.timestamp
              })

            return (
              <section key={group.id} className="mission-control__group" data-testid={`mission-control-group-${group.id}`}>
                <div className="mission-control__group-header">
                  <div className="mission-control__group-meta">
                    <span>{group.name}</span>
                    <span>{sessions.length} sessions</span>
                  </div>
                  <div className="mission-control__group-actions">
                    {renderPresetButton(group.id, '2col', 'Apply 2 Columns preset', <Columns2 size={13} />, presetEligible)}
                    {renderPresetButton(group.id, '2row', 'Apply 2 Rows preset', <Rows2 size={13} />, presetEligible)}
                    {renderPresetButton(group.id, '2x2', 'Apply 2x2 Grid preset', <Grid2x2 size={13} />, presetEligible)}
                  </div>
                </div>
                <div className="mission-control__matrix">
                  {sessions.map((session) => (
                    <button
                      key={session.terminalId}
                      type="button"
                      className={`mission-control__card${session.hasAttention ? ' mission-control__card--attention' : ''}`}
                      onClick={() => {
                        switchGroup(group.id)
                        setActiveTerminal(session.terminalId)
                        onClose()
                      }}
                    >
                      <div className="mission-control__card-top">
                        <span className="mission-control__card-title">{session.terminalName}</span>
                        {session.hasAttention && <span className="mission-control__card-badge">Pending</span>}
                      </div>
                      <span className="mission-control__card-headline">{session.headline}</span>
                      <span className="mission-control__card-meta">{session.meta}</span>
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default MissionControlOverlay
