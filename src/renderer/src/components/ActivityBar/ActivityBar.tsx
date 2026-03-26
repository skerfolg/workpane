import React from 'react'
import { FolderTree, Columns3, Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useKanban } from '../../contexts/KanbanContext'
import './ActivityBar.css'

export type ViewType = 'explorer' | 'kanban' | 'search' | 'settings'

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
  const { issues } = useKanban()

  const openCount = issues.filter((i) => i.status === 'todo').length

  const items: NavItem[] = [
    { id: 'explorer', icon: <FolderTree size={18} />, labelKey: 'activityBar.explorer' },
    { id: 'kanban', icon: <Columns3 size={18} />, labelKey: 'activityBar.kanban' },
    { id: 'search', icon: <Search size={18} />, labelKey: 'activityBar.search' },
    { id: 'settings', icon: <Settings size={18} />, labelKey: 'activityBar.settings' }
  ]

  return (
    <div className="activity-bar" role="navigation" aria-label="Activity Bar">
      {items.map((item) => (
        <button
          key={item.id}
          className={`activity-bar__item${activeView === item.id ? ' activity-bar__item--active' : ''}`}
          onClick={() => onViewChange(item.id)}
          title={t(item.labelKey)}
          aria-label={t(item.labelKey)}
          aria-pressed={activeView === item.id}
        >
          {item.icon}
          {item.id === 'kanban' && openCount > 0 && (
            <span className="activity-bar__badge" aria-label={`${openCount} open issues`}>
              {openCount > 99 ? '99+' : openCount}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export default ActivityBar
