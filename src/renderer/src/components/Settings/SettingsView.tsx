import React, { useState, useEffect, useCallback } from 'react'
import './SettingsView.css'
import { useTheme } from '../../contexts/ThemeContext'
import i18n from '../../i18n'
import type {
  LlmExecutionLane,
  LlmModelSummary,
  LlmProviderId,
  LlmSettingsState,
  LlmStorageStatus,
  LlmValidationStatus
} from '../../../../shared/types'
import { OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID } from '../../../../shared/types'

interface NotificationPattern {
  name: string
  pattern: string
}

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
  notification: {
    enabled: boolean
    sound: boolean
    customPatterns: NotificationPattern[]
  }
}

const PROVIDER_LABELS: Record<LlmProviderId, string> = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  anthropic: 'Anthropic',
  openai: 'OpenAI'
}

const BRIDGE_PLATFORM_COPY = 'Native Windows is the documented path. Use WSL2 only when a Linux-native workflow/runtime is needed.'
const BRIDGE_STATUS_LABELS: Record<LlmValidationStatus, string> = {
  unknown: 'Unknown',
  connected: 'Connected',
  missing_client: 'Missing Codex CLI',
  unauthenticated: 'Sign-in required',
  unsupported_platform: 'Unsupported platform',
  error: 'Error'
}

const DEFAULT_SETTINGS: SettingsData = {
  general: { language: 'en', autoSave: true, autoSaveInterval: 30000 },
  appearance: { theme: 'dark' },
  terminal: { defaultShell: '', fontSize: 14, fontFamily: 'monospace' },
  editor: { fontSize: 14, wordWrap: true, tabSize: 2 },
  workspace: { defaultPath: '' },
  notification: { enabled: true, sound: true, customPatterns: [] }
}

const BUILTIN_PATTERNS = [
  { name: 'Claude Code', pattern: 'Do you want to proceed' },
  { name: 'Codex', pattern: 'Approve|Deny' }
]

function getBridgeStatusDetail(
  status: LlmValidationStatus,
  detail: string | null | undefined
): string | null {
  if (detail) {
    return detail
  }
  if (status === 'connected') {
    return 'Codex CLI session is ready for the official-client bridge.'
  }
  if (status === 'unknown') {
    return 'Bridge status has not been checked yet.'
  }
  return null
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
  const [newPatternName, setNewPatternName] = useState('')
  const [newPatternRegex, setNewPatternRegex] = useState('')
  const [patternError, setPatternError] = useState('')
  const [llmSettings, setLlmSettings] = useState<LlmSettingsState | null>(null)
  const [storageStatus, setStorageStatus] = useState<LlmStorageStatus | null>(null)
  const [modelOptions, setModelOptions] = useState<Partial<Record<LlmProviderId, LlmModelSummary[]>>>({})
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Partial<Record<LlmProviderId, string>>>({})
  const [llmError, setLlmError] = useState('')
  const [bridgeActionBusy, setBridgeActionBusy] = useState<string | null>(null)
  const [bridgeConnectInfo, setBridgeConnectInfo] = useState<{
    terminalId: string
    guidance: string
  } | null>(null)

  useEffect(() => {
    window.settings.get().then((raw) => {
      if (raw && typeof raw === 'object') {
        const s = raw as Record<string, unknown>
        const general = s.general as Record<string, unknown> | undefined
        if (general?.language && typeof general.language === 'string') {
          i18n.changeLanguage(general.language)
        }
        setSettings((prev) => ({
          general: { ...prev.general, ...(s.general as object ?? {}) },
          appearance: { ...prev.appearance, ...(s.appearance as object ?? {}) },
          terminal: { ...prev.terminal, ...(s.terminal as object ?? {}) },
          editor: { ...prev.editor, ...(s.editor as object ?? {}) },
          workspace: { ...prev.workspace, ...(s.workspace as object ?? {}) },
          notification: { ...prev.notification, ...(s.notification as object ?? {}) }
        }))
      }
    })
    void refreshLlmState()
  }, [])

  const refreshLlmState = useCallback(async () => {
    try {
      const [state, status] = await Promise.all([
        window.llm.getSettingsState(),
        window.llm.getStorageStatus()
      ])
      setLlmSettings(state)
      setStorageStatus(status)
      setLlmError('')
    } catch (error) {
      console.error('Failed to load LLM settings:', error)
      setLlmError('Failed to load LLM settings.')
    }
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

  const handleAddPattern = useCallback(() => {
    if (!newPatternName.trim() || !newPatternRegex.trim()) {
      setPatternError('Name and pattern are required.')
      return
    }
    try {
      new RegExp(newPatternRegex)
    } catch {
      setPatternError('Invalid regular expression.')
      return
    }
    setPatternError('')
    setSettings((prev) => {
      const updated = {
        ...prev,
        notification: {
          ...prev.notification,
          customPatterns: [
            ...prev.notification.customPatterns,
            { name: newPatternName.trim(), pattern: newPatternRegex.trim() }
          ]
        }
      }
      window.settings.set('notification.customPatterns', updated.notification.customPatterns)
      return updated
    })
    setNewPatternName('')
    setNewPatternRegex('')
  }, [newPatternName, newPatternRegex])

  const handleDeletePattern = useCallback((index: number) => {
    setSettings((prev) => {
      const customPatterns = prev.notification.customPatterns.filter((_, i) => i !== index)
      const updated = { ...prev, notification: { ...prev.notification, customPatterns } }
      window.settings.set('notification.customPatterns', customPatterns)
      return updated
    })
  }, [])

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
  const orderedExecutionLanes = [...(llmSettings?.executionLanes ?? [])]
    .sort((a, b) => a.priority - b.priority)
  const directHttpLanes = [...orderedExecutionLanes]
    .filter((lane) => lane.transport === 'direct_http')
  const openAiBridgeLane =
    orderedExecutionLanes.find((lane) => lane.laneId === OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID) ?? null
  const bridgeStatus = openAiBridgeLane?.validationState.status ?? 'unknown'
  const bridgeStatusDetail = getBridgeStatusDetail(
    bridgeStatus,
    openAiBridgeLane?.validationState.detail
  )
  const bridgeStatusClass = bridgeStatus.replace(/_/g, '-')
  const bridgeConnectBlocked = bridgeStatus === 'missing_client' || bridgeStatus === 'unsupported_platform'

  const handleRefreshModels = useCallback(async (providerId: LlmProviderId) => {
    try {
      setLlmError('')
      const models = await window.llm.listModels(providerId)
      setModelOptions((prev) => ({ ...prev, [providerId]: models }))
      await refreshLlmState()
    } catch (error) {
      console.error('Failed to refresh models:', error)
      setLlmError(`Failed to refresh models for ${PROVIDER_LABELS[providerId]}.`)
    }
  }, [refreshLlmState])

  const handleSaveApiKey = useCallback(async (providerId: LlmProviderId) => {
    const apiKey = apiKeyDrafts[providerId]?.trim()
    if (!apiKey) return
    try {
      setLlmError('')
      await window.llm.setApiKey(providerId, apiKey)
      setApiKeyDrafts((prev) => ({ ...prev, [providerId]: '' }))
      await refreshLlmState()
    } catch (error) {
      console.error('Failed to save API key:', error)
      setLlmError(`Failed to save API key for ${PROVIDER_LABELS[providerId]}.`)
    }
  }, [apiKeyDrafts, refreshLlmState])

  const handleClearApiKey = useCallback(async (providerId: LlmProviderId) => {
    try {
      setLlmError('')
      await window.llm.clearApiKey(providerId)
      await refreshLlmState()
    } catch (error) {
      console.error('Failed to clear API key:', error)
      setLlmError(`Failed to clear API key for ${PROVIDER_LABELS[providerId]}.`)
    }
  }, [refreshLlmState])

  const moveDirectHttpLane = useCallback(async (laneId: string, delta: -1 | 1) => {
    try {
      setLlmError('')
      await window.llm.moveLane(laneId, delta)
      await refreshLlmState()
    } catch (error) {
      console.error('Failed to move execution lane:', error)
      setLlmError('Failed to update execution lane order.')
    }
  }, [refreshLlmState])

  const handleBridgeAction = useCallback(async (action: 'connect' | 'disconnect' | 'validate' | 'refresh-state') => {
    const laneId = openAiBridgeLane?.laneId ?? OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID
    try {
      setBridgeActionBusy(action)
      setLlmError('')
      if (action !== 'connect') {
        setBridgeConnectInfo(null)
      }
      switch (action) {
        case 'connect': {
          const result = await window.llm.connect(laneId)
          setBridgeConnectInfo({
            terminalId: result.terminalId,
            guidance: result.guidance
          })
          break
        }
        case 'disconnect':
          await window.llm.disconnect(laneId)
          setBridgeConnectInfo(null)
          break
        case 'validate':
          await window.llm.validate(laneId)
          setBridgeConnectInfo(null)
          break
        case 'refresh-state':
          await window.llm.refreshState(laneId)
          setBridgeConnectInfo(null)
          break
      }
      await refreshLlmState()
    } catch (error) {
      console.error(`Failed to ${action} bridge lane:`, error)
      if (action !== 'connect') {
        setBridgeConnectInfo(null)
      }
      setLlmError(`Failed to ${action} OpenAI official-client bridge.`)
    } finally {
      setBridgeActionBusy(null)
    }
  }, [openAiBridgeLane?.laneId, refreshLlmState])

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
                    onChange={(e) => {
                      const lang = e.target.value
                      setSetting('general', 'language', lang)
                      i18n.changeLanguage(lang)
                    }}
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

        {(visible('llm') || visible('provider') || visible('api') || visible('model') || visible('fallback') || visible('lane') || visible('consent') || !q) && llmSettings && (
          <Section title="LLM Integration">
            <div className="settings-row">
              <span className="settings-row__label">Consent for provider-backed analysis</span>
              <div className="settings-row__control">
                <input
                  type="checkbox"
                  checked={llmSettings.consentEnabled}
                  onChange={async (e) => {
                    await window.llm.setConsent(e.target.checked)
                    await refreshLlmState()
                  }}
                />
              </div>
            </div>

            {storageStatus ? (
              <div className="settings-row--column">
                <span className="settings-row__label">Secure Storage Status</span>
                <div className="settings-pattern-list">
                  <div className="settings-pattern-row settings-pattern-row--builtin">
                    <span className="settings-pattern-row__name">{storageStatus.backend}</span>
                    <span className="settings-pattern-row__pattern">{storageStatus.detail}</span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="settings-row--column">
              <span className="settings-row__label">Execution Lanes</span>
              <div className="settings-pattern-list">
                {orderedExecutionLanes.map((lane, index) => {
                  const directHttpIndex = directHttpLanes.findIndex((entry) => entry.laneId === lane.laneId)
                  const canMoveUp = lane.transport === 'direct_http' && directHttpIndex > 0
                  const canMoveDown = lane.transport === 'direct_http' && directHttpIndex !== -1 && directHttpIndex < directHttpLanes.length - 1
                  return (
                  <div key={lane.laneId} className="settings-pattern-row">
                    <span className="settings-pattern-row__name">{index + 1}. {PROVIDER_LABELS[lane.providerId]} · {lane.transport}</span>
                    <div className="settings-row__control settings-row__control--wrap">
                      {lane.transport === 'direct_http' ? (
                        <>
                          <span className={`settings-lane-state settings-lane-state--${lane.enabled ? 'enabled' : 'disabled'}`}>
                            {lane.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          <button
                            className="settings-btn settings-btn--secondary settings-btn--small"
                            disabled={!canMoveUp}
                            onClick={() => void moveDirectHttpLane(lane.laneId, -1)}
                          >
                            Up
                          </button>
                          <button
                            className="settings-btn settings-btn--secondary settings-btn--small"
                            disabled={!canMoveDown}
                            onClick={() => void moveDirectHttpLane(lane.laneId, 1)}
                          >
                            Down
                          </button>
                        </>
                      ) : (
                        <span className={`settings-lane-state settings-lane-state--${bridgeStatusClass}`}>
                          {BRIDGE_STATUS_LABELS[lane.validationState.status]}
                        </span>
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>

            {openAiBridgeLane ? (
              <div className="settings-row--column">
                <span className="settings-row__label">OpenAI · official_client_bridge</span>
                <div className="settings-pattern-list">
                  <div className="settings-pattern-row">
                    <span className="settings-pattern-row__name">Status</span>
                    <div className="settings-lane-detail">
                      <span className={`settings-lane-state settings-lane-state--${bridgeStatusClass}`}>
                        {BRIDGE_STATUS_LABELS[bridgeStatus]}
                      </span>
                      {bridgeStatusDetail ? (
                        <span className="settings-pattern-row__pattern">{bridgeStatusDetail}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="settings-pattern-row settings-pattern-row--builtin">
                    <span className="settings-pattern-row__name">Model</span>
                    <span className="settings-pattern-row__pattern">Managed by Codex CLI</span>
                  </div>
                  <div className="settings-pattern-row settings-pattern-row--builtin">
                    <span className="settings-pattern-row__name">Platform</span>
                    <span className="settings-pattern-row__pattern">{BRIDGE_PLATFORM_COPY}</span>
                  </div>
                  {openAiBridgeLane.validationState.lastValidatedAt ? (
                    <div className="settings-pattern-row settings-pattern-row--builtin">
                      <span className="settings-pattern-row__name">Last checked</span>
                      <span className="settings-pattern-row__pattern">{openAiBridgeLane.validationState.lastValidatedAt}</span>
                    </div>
                  ) : null}
                  {bridgeConnectInfo && bridgeStatus === 'unknown' ? (
                    <div className="settings-pattern-row settings-pattern-row--builtin">
                      <span className="settings-pattern-row__name">Connect</span>
                      <span className="settings-pattern-row__pattern">
                        Pending user action in terminal {bridgeConnectInfo.terminalId}. {bridgeConnectInfo.guidance}
                      </span>
                    </div>
                  ) : null}
                  <div className="settings-pattern-row">
                    <span className="settings-pattern-row__name">Actions</span>
                    <div className="settings-row__control settings-row__control--wrap">
                      <button
                        className="settings-btn settings-btn--secondary settings-btn--small"
                        disabled={bridgeActionBusy !== null || bridgeConnectBlocked}
                        onClick={() => void handleBridgeAction('connect')}
                      >
                        Connect
                      </button>
                      <button
                        className="settings-btn settings-btn--secondary settings-btn--small"
                        disabled={bridgeActionBusy !== null}
                        onClick={() => void handleBridgeAction('refresh-state')}
                      >
                        Refresh State
                      </button>
                      <button
                        className="settings-btn settings-btn--secondary settings-btn--small"
                        disabled={bridgeActionBusy !== null}
                        onClick={() => void handleBridgeAction('validate')}
                      >
                        Validate
                      </button>
                      <button
                        className="settings-btn settings-btn--secondary settings-btn--small"
                        disabled={bridgeActionBusy !== null}
                        onClick={() => void handleBridgeAction('disconnect')}
                      >
                        Disconnect (local only)
                      </button>
                    </div>
                  </div>
                  <div className="settings-pattern-row settings-pattern-row--builtin">
                    <span className="settings-pattern-row__name">Disconnect</span>
                    <span className="settings-pattern-row__pattern">Local only. PromptManager does not run `codex logout` and leaves your Codex CLI session unchanged.</span>
                  </div>
                </div>
              </div>
            ) : null}

            {directHttpLanes.map((lane) => {
              const providerId = lane.providerId
              const provider = llmSettings.providers[providerId]
              const models = modelOptions[providerId] ?? []
              return (
                <div key={lane.laneId} className="settings-row--column">
                  <span className="settings-row__label">{PROVIDER_LABELS[providerId]} · {lane.transport}</span>
                  <div className="settings-pattern-list">
                    <div className="settings-pattern-row">
                      <span className="settings-pattern-row__name">Enabled</span>
                      <div className="settings-row__control">
                        <input
                          type="checkbox"
                          checked={lane.enabled}
                          onChange={async (e) => {
                            await window.llm.setLaneEnabled(lane.laneId, e.target.checked)
                            await refreshLlmState()
                          }}
                        />
                      </div>
                    </div>
                    <div className="settings-pattern-row">
                      <span className="settings-pattern-row__name">API Key</span>
                      <div className="settings-row__control">
                        <input
                          type="password"
                          value={apiKeyDrafts[providerId] ?? ''}
                          placeholder={provider.apiKeyStored ? 'Stored securely' : 'Enter API key'}
                          onChange={(e) => setApiKeyDrafts((prev) => ({ ...prev, [providerId]: e.target.value }))}
                        />
                        <button className="settings-btn settings-btn--secondary settings-btn--small" onClick={() => void handleSaveApiKey(providerId)}>Save</button>
                        <button className="settings-btn settings-btn--secondary settings-btn--small" onClick={() => void handleClearApiKey(providerId)}>Clear</button>
                      </div>
                    </div>
                    <div className="settings-pattern-row">
                      <span className="settings-pattern-row__name">Model</span>
                      <div className="settings-row__control">
                        <select
                          value={provider.selectedModel}
                          onChange={async (e) => {
                            await window.llm.setSelectedModel(providerId, e.target.value)
                            await refreshLlmState()
                          }}
                        >
                          <option value={provider.selectedModel}>{provider.selectedModel}</option>
                          {models.filter((model) => model.id !== provider.selectedModel).map((model) => (
                            <option key={model.id} value={model.id}>{model.displayName}</option>
                          ))}
                        </select>
                        <button className="settings-btn settings-btn--secondary settings-btn--small" onClick={() => void handleRefreshModels(providerId)}>Refresh</button>
                      </div>
                    </div>
                    <div className="settings-pattern-row settings-pattern-row--builtin">
                      <span className="settings-pattern-row__name">Usage</span>
                      <span className="settings-pattern-row__pattern">
                        Requests {llmSettings.usage[providerId].requestCount} · Input {llmSettings.usage[providerId].inputTokens} · Output {llmSettings.usage[providerId].outputTokens} · Cost {llmSettings.usage[providerId].estimatedCostUsd ?? 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}

            {llmError ? <div className="settings-pattern-error">{llmError}</div> : null}
          </Section>
        )}

        {(visible('notification') || visible('approval') || visible('sound') || visible('pattern') || !q) && (
          <Section title="Notifications">
            {visible('approval') || visible('notification') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Agent Approval Notifications</span>
                <div className="settings-row__control">
                  <input
                    type="checkbox"
                    checked={settings.notification.enabled}
                    onChange={(e) => setSetting('notification', 'enabled', e.target.checked)}
                  />
                </div>
              </div>
            ) : null}
            {visible('sound') || visible('notification') || !q ? (
              <div className="settings-row">
                <span className="settings-row__label">Notification Sound</span>
                <div className="settings-row__control">
                  <input
                    type="checkbox"
                    checked={settings.notification.sound}
                    onChange={(e) => setSetting('notification', 'sound', e.target.checked)}
                  />
                </div>
              </div>
            ) : null}

            {visible('pattern') || visible('notification') || !q ? (
              <>
                <div className="settings-row--column">
                  <span className="settings-row__label">Built-in Detection Patterns</span>
                  <div className="settings-pattern-list">
                    {BUILTIN_PATTERNS.map((p) => (
                      <div key={p.name} className="settings-pattern-row settings-pattern-row--builtin">
                        <span className="settings-pattern-row__name">{p.name}</span>
                        <span className="settings-pattern-row__pattern">{p.pattern}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="settings-row--column">
                  <span className="settings-row__label">Custom Detection Patterns</span>
                  <div className="settings-pattern-list">
                    {settings.notification.customPatterns.map((p, i) => (
                      <div key={i} className="settings-pattern-row">
                        <span className="settings-pattern-row__name">{p.name}</span>
                        <span className="settings-pattern-row__pattern">{p.pattern}</span>
                        <button
                          className="settings-btn settings-btn--secondary settings-btn--small"
                          onClick={() => handleDeletePattern(i)}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="settings-pattern-add">
                    <input
                      type="text"
                      placeholder="Pattern name"
                      value={newPatternName}
                      onChange={(e) => { setNewPatternName(e.target.value); setPatternError('') }}
                    />
                    <input
                      type="text"
                      placeholder="Regex pattern"
                      value={newPatternRegex}
                      onChange={(e) => { setNewPatternRegex(e.target.value); setPatternError('') }}
                    />
                    <button className="settings-btn" onClick={handleAddPattern}>Add</button>
                  </div>
                  {patternError && (
                    <div className="settings-pattern-error">{patternError}</div>
                  )}
                </div>
              </>
            ) : null}
          </Section>
        )}
      </div>
    </div>
  )
}
