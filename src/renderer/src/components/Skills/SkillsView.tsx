import React, { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSkills } from '../../contexts/SkillsContext'
import SkillCard from './SkillCard'
import './SkillsView.css'

function SkillsView(): React.JSX.Element {
  const { t } = useTranslation()
  const { skills, loading, error, refreshRegistry } = useSkills()
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase()) ||
          s.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()))
      )
    : skills

  return (
    <div className="skills-view">
      <div className="skills-view__header">
        <span className="skills-view__title">{t('skills.title')}</span>
        <button
          className="skills-view__refresh-btn"
          onClick={refreshRegistry}
          disabled={loading}
          title={t('skills.refresh')}
          aria-label={t('skills.refresh')}
        >
          <RefreshCw size={14} className={loading ? 'skills-view__spin' : ''} />
        </button>
      </div>

      <div className="skills-view__search-row">
        <input
          className="skills-view__search"
          type="text"
          placeholder={t('skills.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading && (
        <div className="skills-view__loading">
          <span className="skills-view__spinner" />
          {t('skills.loading')}
        </div>
      )}

      {!loading && error && (
        <div className="skills-view__error">
          <span>{t('skills.error')}</span>
          <button className="skills-view__retry-btn" onClick={refreshRegistry}>
            {t('skills.retry')}
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="skills-view__empty">{t('skills.noSkills')}</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="skills-view__list">
          {filtered.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      )}
    </div>
  )
}

export default SkillsView
