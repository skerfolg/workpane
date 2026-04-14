import React from 'react'
import { useTranslation } from 'react-i18next'
import type { UnifiedSkill } from '../../../../shared/types'
import { useSkills } from '../../contexts/SkillsContext'
import './SkillCard.css'

interface SkillCardProps {
  skill: UnifiedSkill
}

function SkillCard({ skill }: SkillCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { isInstalled, hasUpdate, pendingInstalls, installSkill, uninstallSkill } = useSkills()

  const agentEntries = Object.entries(skill.agents)

  return (
    <div className="skill-card">
      <div className="skill-card__header">
        <span className="skill-card__name">{skill.name}</span>
        <span className="skill-card__version">v{skill.version}</span>
      </div>

      {skill.description && (
        <p className="skill-card__description">{skill.description}</p>
      )}

      {skill.tags.length > 0 && (
        <div className="skill-card__tags">
          {skill.tags.map((tag) => (
            <span key={tag} className="skill-card__tag">{tag}</span>
          ))}
        </div>
      )}

      {agentEntries.length > 0 && (
        <div className="skill-card__agents">
          {agentEntries.map(([agentId]) => {
            const installed = isInstalled(skill.id, agentId)
            const update = hasUpdate(skill.id, agentId)
            const key = `${skill.id}:${agentId}`
            const pending = pendingInstalls.has(key)

            return (
              <div key={agentId} className="skill-card__agent-row">
                <span className="skill-card__agent-id">{agentId}</span>

                {installed && update && (
                  <span className="skill-card__update-badge">
                    {t('skills.updateAvailable')}
                  </span>
                )}

                {installed && !update && (
                  <span className="skill-card__installed-badge">
                    {t('skills.installed')}
                  </span>
                )}

                <button
                  className={`skill-card__action-btn${installed ? ' skill-card__action-btn--uninstall' : ''}`}
                  disabled={pending}
                  onClick={() =>
                    installed
                      ? uninstallSkill(skill.id, agentId)
                      : installSkill(skill.id, agentId)
                  }
                >
                  {pending
                    ? '...'
                    : installed
                      ? t('skills.uninstall')
                      : t('skills.install')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default SkillCard
