import React from 'react'
import { useTranslation } from 'react-i18next'
import './Welcome.css'

interface WelcomeProps {
  recentWorkspaces: string[]
  onOpen: () => void
  onOpenPath: (path: string) => void
}

function getNameFromPath(folderPath: string): string {
  return folderPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? folderPath
}

function Welcome({ recentWorkspaces, onOpen, onOpenPath }: WelcomeProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="welcome">
      <h1 className="welcome__title">{t('app.title')}</h1>
      <p className="welcome__subtitle">{t('workspace.switch')}</p>

      <div className="welcome__actions">
        <button className="welcome__btn welcome__btn--primary" onClick={onOpen}>
          {t('workspace.open')}
        </button>
      </div>

      <div className="welcome__recent">
        <div className="welcome__recent-title">{t('workspace.recent')}</div>
        <div className="welcome__recent-list">
          {recentWorkspaces.length === 0 ? (
            <div className="welcome__recent-empty">최근 워크스페이스가 없습니다.</div>
          ) : (
            recentWorkspaces.map((wsPath) => (
              <button
                key={wsPath}
                className="welcome__recent-item"
                onClick={() => onOpenPath(wsPath)}
              >
                <span className="welcome__recent-name">{getNameFromPath(wsPath)}</span>
                <span className="welcome__recent-path">{wsPath}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default Welcome
