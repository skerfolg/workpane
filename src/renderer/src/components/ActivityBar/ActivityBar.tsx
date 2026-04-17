import React from 'react'
import { FolderTree, Search, Settings, Crosshair } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './ActivityBar.css'

export type ViewType = 'explorer' | 'search' | 'settings'

interface ActivityBarProps {
  activeView: ViewType
  onViewChange: (view: ViewType) => void
  onOpenMissionControl: () => void
}

interface NavItem {
  id: ViewType
  icon: React.ReactNode
  labelKey: string
}

const ActivityBar: React.FC<ActivityBarProps> = ({ activeView, onViewChange, onOpenMissionControl }) => {
  const { t } = useTranslation()

  const items: NavItem[] = [
    { id: 'explorer', icon: <FolderTree size={18} />, labelKey: 'activityBar.explorer' },
    { id: 'search', icon: <Search size={18} />, labelKey: 'activityBar.search' }
  ]

  return (
    <div className="activity-bar" role="navigation" aria-label="Activity Bar">
      {items.map((item) => (
        <button
          key={item.id}
          className={`activity-bar__item${activeView === item.id ? ' activity-bar__item--active' : ''}`}
          data-testid={`activity-bar-${item.id}`}
          onClick={() => onViewChange(item.id)}
          title={t(item.labelKey)}
          aria-label={t(item.labelKey)}
          aria-pressed={activeView === item.id}
        >
          {item.icon}
        </button>
      ))}
      <button
        className="activity-bar__utility"
        data-testid="activity-bar-mission-control"
        onClick={onOpenMissionControl}
        title="Mission Control"
        aria-label="Mission Control"
      >
        <Crosshair size={18} />
      </button>
      <button
        className={`activity-bar__item${activeView === 'settings' ? ' activity-bar__item--active' : ''}`}
        data-testid="activity-bar-settings"
        onClick={() => onViewChange('settings')}
        title={t('activityBar.settings')}
        aria-label={t('activityBar.settings')}
        aria-pressed={activeView === 'settings'}
      >
        <Settings size={18} />
      </button>
    </div>
  )
}

export default ActivityBar
