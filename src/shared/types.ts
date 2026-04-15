// Shared type definitions — single source of truth for main + renderer

export interface DocEntry {
  filePath: string
  date: string
  hash: string
  topic: string
  docType: string // design, plan, report, result, sprint, etc.
  title: string
  folder: string // designs, plans, reports, results, and similar doc buckets
  source: 'standard' | 'project' // standard = docs/, project = elsewhere
}

export interface DocGroup {
  hash: string
  topic: string // human-readable topic summary
  date: string // latest date among documents
  documents: DocEntry[]
  docTypes: string[] // unique sorted doc types
  source: 'standard' | 'project'
}

// Skills — bundled skill info (from resources/skills/*/skill.json)
export interface SkillInfo {
  name: string
  version: string
  description: string
  files: string[]
  docsStructure: string[]
}

// Registry skill file with required SHA-256 checksum
export interface RegistrySkillFile {
  name: string
  url: string
  sha256: string
}

// Per-agent install configuration (e.g. Claude Code, Cursor, Windsurf)
export interface AgentInstallConfig {
  installPath: string // e.g. "{projectRoot}/.claude/skills/{skillId}"
}

// A skill entry in the remote registry
export interface RegistrySkill {
  id: string
  name: string
  version: string
  description: string
  author: string
  tags: string[]
  files: RegistrySkillFile[]
  agents: Record<string, AgentInstallConfig>
}

// Top-level registry manifest
export interface SkillRegistry {
  version: string
  lastUpdated: string
  skills: RegistrySkill[]
}

// Record stored in .claude/installed-skills.json per installed registry skill
export interface InstalledSkillRecord {
  skillId: string
  version: string
  agentId: string
  installedAt: string
  installPath: string
}

// Unified view merging bundled + registry skills for the UI
export interface UnifiedSkill {
  id: string
  name: string
  version: string
  description: string
  source: 'bundled' | 'registry'
  agents: Record<string, AgentInstallConfig>
  tags: string[]
}

export type LlmProviderId = 'gemini' | 'groq' | 'anthropic' | 'openai'

export const LLM_PROVIDER_IDS: LlmProviderId[] = ['gemini', 'groq', 'anthropic', 'openai']

export function isLlmProviderId(value: string): value is LlmProviderId {
  return (LLM_PROVIDER_IDS as string[]).includes(value)
}

export type LlmCauseCategory = 'approval' | 'input-needed' | 'error' | 'unknown'

export type LlmAnalysisSource = 'llm' | 'no-api'

export interface LlmModelSummary {
  id: string
  providerId: LlmProviderId
  displayName: string
  contextWindow?: number | null
}

export interface LlmProviderSettings {
  enabled: boolean
  selectedModel: string
  apiKeyStored: boolean
  lastModelRefreshAt: string | null
}

export interface LlmUsageSnapshot {
  providerId: LlmProviderId
  requestCount: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number | null
  lastUsedAt: string | null
}

export interface LlmSettingsState {
  consentEnabled: boolean
  selectedProvider: LlmProviderId
  fallbackOrder: LlmProviderId[]
  providers: Record<LlmProviderId, LlmProviderSettings>
  usage: Record<LlmProviderId, LlmUsageSnapshot>
}

export interface LlmStorageStatus {
  available: boolean
  backend: 'basic_text' | 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' | 'unknown' | 'not_supported' | 'dpapi' | 'keychain'
  degraded: boolean
  detail: string
}

export interface LlmClassificationResult {
  category: LlmCauseCategory
  summary: string
  confidence: 'low' | 'medium' | 'high'
  source: LlmAnalysisSource
  providerId: LlmProviderId | null
  modelId: string | null
  recentOutputExcerpt: string
}

export interface LlmApprovalAnalysisPreview {
  category: LlmCauseCategory
  summary: string
  confidence: 'low' | 'medium' | 'high'
  source: LlmAnalysisSource
}

export interface LlmRuntimeInput {
  terminalId: string
  workspacePath: string
  patternName: string
  matchedText: string
  recentOutput: string
}

export interface ApprovalDetectedEvent {
  terminalId: string
  workspacePath: string
  patternName: string
  matchedText: string
  timestamp: number
  analysis: LlmApprovalAnalysisPreview
}

export type SessionMonitoringCategory = Exclude<LlmCauseCategory, 'unknown'> | 'unknown'

export interface SessionMonitoringState {
  terminalId: string
  workspacePath: string
  patternName: string
  matchedText: string
  status: 'attention-needed'
  category: SessionMonitoringCategory
  confidence: 'low' | 'medium' | 'high'
  source: LlmAnalysisSource
  summary: string
  timestamp: number
}

export type SessionMonitoringUpsertEvent = SessionMonitoringState

export interface SessionMonitoringClearEvent {
  terminalId: string
  reason: 'write' | 'exit'
  timestamp: number
}

export type SessionMonitoringTransitionKind = 'entered' | 'updated' | 'cleared'

export interface SessionMonitoringTransitionEvent {
  id: string
  terminalId: string
  workspacePath: string
  sequence: number
  timestamp: number
  kind: SessionMonitoringTransitionKind
  reason?: SessionMonitoringClearEvent['reason']
  category?: SessionMonitoringCategory
  confidence?: SessionMonitoringState['confidence']
  source?: SessionMonitoringState['source']
  summary?: string
  patternName?: string
  matchedText?: string
}
