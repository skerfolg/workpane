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

export type LlmExecutionTransport = 'direct_http' | 'official_client_bridge'

export type LlmCredentialStyle = 'api_key' | 'provider_session'

export type LlmValidationStatus =
  | 'unknown'
  | 'connected'
  | 'missing_client'
  | 'unauthenticated'
  | 'unsupported_platform'
  | 'error'

export interface LlmValidationState {
  status: LlmValidationStatus
  detail: string | null
  lastValidatedAt: string | null
}

export interface LlmExecutionLane {
  laneId: string
  providerId: LlmProviderId
  transport: LlmExecutionTransport
  credentialStyle: LlmCredentialStyle
  enabled: boolean
  priority: number
  validationState: LlmValidationState
}

export const GEMINI_DIRECT_HTTP_LANE_ID = 'gemini/direct_http'
export const GEMINI_OFFICIAL_CLIENT_BRIDGE_LANE_ID = 'gemini/official_client_bridge'
export const OPENAI_DIRECT_HTTP_LANE_ID = 'openai/direct_http'
export const OPENAI_OFFICIAL_CLIENT_BRIDGE_LANE_ID = 'openai/official_client_bridge'
export type LlmLaneMoveDelta = -1 | 1
export const ERR_UNKNOWN_LANE_ID = 'ERR_UNKNOWN_LANE_ID: Unknown execution lane.'
export const ERR_NON_DIRECT_HTTP_LANE = 'ERR_NON_DIRECT_HTTP_LANE: Lane control is supported only for direct_http lanes.'

export interface LlmLaneConnectResult {
  laneId: string
  status: 'pending-user-action'
  terminalId: string
  detail: string | null
}

export interface LlmProviderCapability {
  allowedLaneKinds: LlmExecutionTransport[]
  allowedCredentialStyles: LlmCredentialStyle[]
  forbiddenAuthModes: string[]
  blockedStates: LlmValidationStatus[]
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
  executionLanes: LlmExecutionLane[]
  selectedProvider: LlmProviderId
  fallbackOrder: LlmProviderId[]
  providers: Record<LlmProviderId, LlmProviderSettings>
  usage: Record<LlmProviderId, LlmUsageSnapshot>
}

export function createLlmValidationState(
  status: LlmValidationStatus = 'unknown',
  detail: string | null = null,
  lastValidatedAt: string | null = null
): LlmValidationState {
  return {
    status,
    detail,
    lastValidatedAt
  }
}

export function buildExecutionLaneId(
  providerId: LlmProviderId,
  transport: LlmExecutionTransport
): string {
  return `${providerId}/${transport}`
}

export function createDirectHttpExecutionLane(
  providerId: LlmProviderId,
  enabled: boolean,
  priority: number
): LlmExecutionLane {
  return {
    laneId: buildExecutionLaneId(providerId, 'direct_http'),
    providerId,
    transport: 'direct_http',
    credentialStyle: 'api_key',
    enabled,
    priority,
    validationState: createLlmValidationState()
  }
}

export function createOfficialClientExecutionLane(
  providerId: LlmProviderId,
  enabled: boolean,
  priority: number
): LlmExecutionLane {
  return {
    laneId: buildExecutionLaneId(providerId, 'official_client_bridge'),
    providerId,
    transport: 'official_client_bridge',
    credentialStyle: 'provider_session',
    enabled,
    priority,
    validationState: createLlmValidationState()
  }
}

export function isDirectHttpExecutionLane(
  lane: Pick<LlmExecutionLane, 'transport'>
): boolean {
  return lane.transport === 'direct_http'
}

export function isOpenAiOfficialClientBridgeLane(
  lane: Pick<LlmExecutionLane, 'laneId' | 'providerId' | 'transport'>
): boolean {
  return lane.providerId === 'openai' && isOfficialClientBridgeLane(lane)
}

export function isGeminiOfficialClientBridgeLane(
  lane: Pick<LlmExecutionLane, 'laneId' | 'providerId' | 'transport'>
): boolean {
  return lane.providerId === 'gemini' && isOfficialClientBridgeLane(lane)
}

export function isOfficialClientBridgeLane(
  lane: Pick<LlmExecutionLane, 'laneId' | 'providerId' | 'transport'>
): boolean {
  return (
    lane.transport === 'official_client_bridge' &&
    lane.laneId === buildExecutionLaneId(lane.providerId, 'official_client_bridge') &&
    (lane.providerId === 'openai' || lane.providerId === 'gemini')
  )
}

export function pinOfficialClientBridgeLanes(
  lanes: LlmExecutionLane[]
): LlmExecutionLane[] {
  const ordered = [...lanes]
  const bridgeLaneByProvider = new Map(
    ordered
      .filter((lane) => isOfficialClientBridgeLane(lane))
      .map((lane) => [lane.providerId, lane] as const)
  )
  const result: LlmExecutionLane[] = []

  for (const lane of ordered) {
    if (isOfficialClientBridgeLane(lane)) {
      continue
    }

    const bridgeLane = lane.transport === 'direct_http'
      ? bridgeLaneByProvider.get(lane.providerId)
      : undefined
    if (bridgeLane) {
      result.push(bridgeLane)
      bridgeLaneByProvider.delete(lane.providerId)
    }

    result.push(lane)
  }

  for (const bridgeLane of bridgeLaneByProvider.values()) {
    result.push(bridgeLane)
  }

  return result.map((lane, index) => ({
    ...lane,
    priority: index
  }))
}

export function buildLegacyProviderOrder(
  selectedProvider: LlmProviderId,
  fallbackOrder: LlmProviderId[]
): LlmProviderId[] {
  const ordered = [selectedProvider, ...fallbackOrder]
  const seen = new Set<LlmProviderId>()
  const result: LlmProviderId[] = []

  for (const providerId of ordered) {
    if (!seen.has(providerId) && isLlmProviderId(providerId)) {
      seen.add(providerId)
      result.push(providerId)
    }
  }

  for (const providerId of LLM_PROVIDER_IDS) {
    if (!seen.has(providerId)) {
      seen.add(providerId)
      result.push(providerId)
    }
  }

  return result
}

export function buildDerivedProviderOrderFromLanes(
  lanes: LlmExecutionLane[]
): LlmProviderId[] {
  const orderedLanes = [...lanes]
    .filter((lane) => isDirectHttpExecutionLane(lane))
    .sort((a, b) => a.priority - b.priority)
  const seen = new Set<LlmProviderId>()
  const result: LlmProviderId[] = []

  for (const lane of orderedLanes) {
    if (!seen.has(lane.providerId)) {
      seen.add(lane.providerId)
      result.push(lane.providerId)
    }
  }

  for (const providerId of LLM_PROVIDER_IDS) {
    if (!seen.has(providerId)) {
      seen.add(providerId)
      result.push(providerId)
    }
  }

  return result
}

export function syncLegacyProviderShims(
  state: LlmSettingsState
): LlmSettingsState {
  const providerOrder = buildDerivedProviderOrderFromLanes(state.executionLanes)
  state.selectedProvider = providerOrder[0] ?? LLM_PROVIDER_IDS[0]
  state.fallbackOrder = providerOrder
  return state
}

export const LLM_PROVIDER_CAPABILITIES: Record<LlmProviderId, LlmProviderCapability> = {
  gemini: {
    allowedLaneKinds: ['direct_http', 'official_client_bridge'],
    allowedCredentialStyles: ['api_key', 'provider_session'],
    forbiddenAuthModes: ['token_scraping', 'browser_cookie_reuse'],
    blockedStates: ['missing_client', 'unauthenticated', 'unsupported_platform', 'error']
  },
  groq: {
    allowedLaneKinds: ['direct_http'],
    allowedCredentialStyles: ['api_key'],
    forbiddenAuthModes: ['official_client_bridge', 'token_scraping', 'browser_cookie_reuse'],
    blockedStates: ['error']
  },
  anthropic: {
    allowedLaneKinds: ['direct_http'],
    allowedCredentialStyles: ['api_key'],
    forbiddenAuthModes: ['official_client_bridge', 'token_scraping', 'browser_cookie_reuse', 'third_party_oauth_reuse'],
    blockedStates: ['error']
  },
  openai: {
    allowedLaneKinds: ['direct_http', 'official_client_bridge'],
    allowedCredentialStyles: ['api_key', 'provider_session'],
    forbiddenAuthModes: ['token_scraping', 'browser_cookie_reuse'],
    blockedStates: ['missing_client', 'unauthenticated', 'unsupported_platform', 'error']
  }
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

export type MonitoringTimelineFilter = 'all' | 'approval-only' | 'error-only'

export interface MonitoringHistoryEvent {
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

export interface MonitoringHistoryStoreStatus {
  available: boolean
  backend: 'sqlite' | 'json_fallback' | 'memory'
  detail: string
  storagePath: string | null
}

export interface MonitoringWorkspaceFeedEvent {
  event: MonitoringHistoryEvent
}

export type ManualTaskStatus = 'active' | 'completed'

export interface ManualTaskRecord {
  id: string
  title: string
  note: string | null
  status: ManualTaskStatus
  order: number
  createdAt: number
  updatedAt: number
  completedAt: number | null
  linkedTerminalId: string | null
  linkedEventId: string | null
}
