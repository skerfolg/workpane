import type { LlmClassificationResult, LlmLaneConnectResult, LlmValidationState } from '../../../shared/types'

export interface BridgeCommandRequest {
  command?: string
  args: string[]
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export interface BridgeCommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

export interface BridgeCommandRunner {
  run(request: BridgeCommandRequest): Promise<BridgeCommandResult>
}

export interface BridgeConnectLaunchRequest {
  laneId: string
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

export interface BridgeConnectHooks {
  launch(request: BridgeConnectLaunchRequest): Promise<{ terminalId: string }>
}

export interface BridgeStateRefreshResult {
  validationState: LlmValidationState
}

export interface BridgeValidationResult {
  validationState: LlmValidationState
}

export interface BridgeClassificationResult {
  result: LlmClassificationResult
  inputTokens: number
  outputTokens: number
  validationState: LlmValidationState
}

export interface OfficialClientBridge {
  connect(laneId: string, hooks: BridgeConnectHooks): Promise<LlmLaneConnectResult>
  refreshState(): Promise<BridgeStateRefreshResult>
  validate(): Promise<BridgeValidationResult>
  classifyCause(recentOutput: string): Promise<BridgeClassificationResult>
}
