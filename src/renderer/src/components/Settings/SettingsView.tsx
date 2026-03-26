import React, { useState, useEffect, useCallback } from 'react'
import './SettingsView.css'
import { useTheme } from '../../contexts/ThemeContext'

interface SettingsData {
  general: {
    language: string
    autoSave: boolean
    autoSaveInterval: number
  }
  appearance: {
    theme: string
  }
  terminal: {
    defaultShell: string
    fontSize: number
    fontFamily: string
  }
  editor: {
    fontSize: number
    wordWrap: boolean
    tabSize: number
  }
  workspace: {
    defaultPath: string
  }
}

const DEFAULT_SETTINGS: SettingsData = {
  general: { language: 'en', autoSave: true, autoSaveInterval: 30000 },
  appearance: { theme: 'dark' },
  terminal: { defaultShell: '', fontSize: 14, fontFamily: 'monospace' },
  editor: { fontSize: 14, wordWrap: true, tabSize: 2 },
  workspace: { defaultPath: '' }
}

interface SectionProps {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: SectionProps): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="settings-section">
      <div className="settings-section__header" onClick={() => setOpen((o) => !o)}>
        <span className="arrow">{open ? '▼' : '▶'}</span>
        <span>{title}</span>
      </div>
      {open && <div className="settings-section__body">{children}</div>}
    </div>
  )
}

export default function SettingsView(): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS)
  const { setTheme } = useTheme()

  useEffect(() => {
    window.settings.get().then((raw) => {
      if (raw && typeof raw === 'object') {
        const s = raw as Record<string, unknown>
        setSettings((prev) => ({
          general: { ...prev.general, ...(s.general as object ?? {}) },
          appearance: { ...prev.appearance, ...(s.appearance as object ?? {}) },
          terminal: { ...prev.terminal, ...(s.terminal as object ?? {}) },
          editor: { ...prev.editor, ...(s.editor as object ?? {}) },
          workspace: { ...prev.workspace, ...(s.workspace as object ?? {}) }
        }))
      }
    })
  }, [])

  const setSetting = useCallback(<K extends keyof SettingsData>(
    section: K,
    key: keyof SettingsData[K],
    value: unknown
  ) => {
    setSettings((prev) => {
      const updated = { ...prev, [section]: { ...prev[section], [key]: value } }
      window.settings.set(`${section}.${String(key)}`, value)
      return updated
    })
  }, [])

  const handleThemeChange = useCallback((theme: string) => {
    setSetting('appearance', 'theme', theme)
    setTheme(theme as 'dark' | 'light' | 'high-contrast')
  }, [setSetting, setTheme])

  const handleImportTheme = useCallback(async () => {
    try {
      const result = await window.theme.import()
      if (result) {
        console.log('Theme imported:', result)
      }
    } catch (err) {
      console.error('Failed to import theme:', err)
    }
  }, [])

  const q = search.toLowerCase()
  const visible = (label: string): boolean => !q || label.toLowerCase().includes(q)

  return (
    <div className="settings-view">
      <div className="settings-view__search">
        <input
          type="text"
          placeholder="Search settings..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="settings-view__content">
        {(visible('language') || visible('auto save') || visible('Korean') || !q) && (
          <Section title="General">
            {visible('language') || visible('Korean') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Language</span>
                <div className="settings-row__control">
                  <select
                    value={settings.general.language}
                    onChange={(e) => setSetting('general', 'language', e.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="ko">Korean</option>
                  </select>
                </div>
              </div>
            ) : null}
            {visible('auto save') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Auto Save</span>
                <div className="settings-row__control">
                  <input
                    type="checkbox"
                    checked={settings.general.autoSave}
                    onChange={(e) => setSetting('general', 'autoSave', e.target.checked)}
                  />
                </div>
              </div>
            ) : null}
            {visible('auto save interval') || visible('save interval') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Auto Save Interval (ms)</span>
                <div className="settings-row__control">
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    value={settings.general.autoSaveInterval}
                    onChange={(e) => setSetting('general', 'autoSaveInterval', Number(e.target.value))}
                  />
                </div>
              </div>
            ) : null}
          </Section>
        )}

        {(visible('theme') || !q) && (
          <Section title="Appearance">
            {visible('theme') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Theme</span>
                <div className="settings-row__control">
                  <select
                    value={settings.appearance.theme}
                    onChange={(e) => handleThemeChange(e.target.value)}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="high-contrast">High Contrast</option>
                  </select>
                </div>
              </div>
            ) : null}
            <div className="settings-row">
              <span className="settings-row__label">Import Theme File</span>
              <div className="settings-row__control">
                <button className="settings-btn settings-btn--secondary" onClick={handleImportTheme}>
                  Import Theme File
                </button>
              </div>
            </div>
          </Section>
        )}

        {(visible('shell') || visible('font') || visible('terminal') || !q) && (
          <Section title="Terminal">
            {visible('shell') || visible('default shell') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Default Shell</span>
                <div className="settings-row__control">
                  <input
                    type="text"
                    value={settings.terminal.defaultShell}
                    onChange={(e) => setSetting('terminal', 'defaultShell', e.target.value)}
                  />
                </div>
              </div>
            ) : null}
            {visible('font size') || visible('terminal') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Font Size</span>
                <div className="settings-row__control">
                  <input
                    type="number"
                    min={8}
                    max={32}
                    value={settings.terminal.fontSize}
                    onChange={(e) => setSetting('terminal', 'fontSize', Number(e.target.value))}
                  />
                </div>
              </div>
            ) : null}
            {visible('font family') || visible('terminal') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Font Family</span>
                <div className="settings-row__control">
                  <input
                    type="text"
                    value={settings.terminal.fontFamily}
                    onChange={(e) => setSetting('terminal', 'fontFamily', e.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </Section>
        )}

        {(visible('editor') || visible('font') || visible('word wrap') || visible('tab size') || !q) && (
          <Section title="Editor">
            {visible('font size') || visible('editor') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Font Size</span>
                <div className="settings-row__control">
                  <input
                    type="number"
                    min={8}
                    max={32}
                    value={settings.editor.fontSize}
                    onChange={(e) => setSetting('editor', 'fontSize', Number(e.target.value))}
                  />
                </div>
              </div>
            ) : null}
            {visible('word wrap') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Word Wrap</span>
                <div className="settings-row__control">
                  <input
                    type="checkbox"
                    checked={settings.editor.wordWrap}
                    onChange={(e) => setSetting('editor', 'wordWrap', e.target.checked)}
                  />
                </div>
              </div>
            ) : null}
            {visible('tab size') || visible('tab') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Tab Size</span>
                <div className="settings-row__control">
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={settings.editor.tabSize}
                    onChange={(e) => setSetting('editor', 'tabSize', Number(e.target.value))}
                  />
                </div>
              </div>
            ) : null}
          </Section>
        )}

        {(visible('workspace') || visible('default path') || !q) && (
          <Section title="Workspace">
            {visible('default path') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Default Path</span>
                <div className="settings-row__control">
                  <input
                    type="text"
                    value={settings.workspace.defaultPath}
                    onChange={(e) => setSetting('workspace', 'defaultPath', e.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </Section>
        )}
      </div>
    </div>
  )
}
