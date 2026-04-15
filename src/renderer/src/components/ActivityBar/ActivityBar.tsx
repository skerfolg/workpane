import React from 'react'
import { FolderTree, Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './ActivityBar.css'

export type ViewType = 'explorer' | 'search' | 'settings'

interface ActivityBarProps {
  activeView: ViewType
  onViewChange: (view: ViewType) => void
}

interface NavItem {
  id: ViewType
  icon: React.ReactNode
  labelKey: string
}

const ActivityBar: React.FC<ActivityBarProps> = ({ activeView, onViewChange }) => {
  const { t } = useTranslation()

  const items: NavItem[] = [
    { id: 'explorer', icon: <FolderTree size={18} />, labelKey: 'activityBar.explorer' },
    { id: 'search', icon: <Search size={18} />, labelKey: 'activityBar.search' },
    { id: 'settings', icon: <Settings size={18} />, labelKey: 'activityBar.settings' }
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
    </div>
  )
}

export default ActivityBar
