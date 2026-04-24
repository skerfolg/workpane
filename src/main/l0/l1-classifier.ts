/**
 * L1 rule-based classifier — Slice 1E (port of
 * scripts/phase-2/classify-hook-payloads.mjs from the Slice 0 spike).
 *
 * Takes a structured L0 event payload (from the hook adapter or the
 * session-log adapter) and returns a classification the UI can surface
 * directly: approval pending overlays, tool-completed toasts, session
 * lifecycle markers, etc. API cost is 0 — this is pure pattern matching.
 *
 * L2 (LLM deep analysis) lives in a separate lane and is not invoked here.
 * See Plan v3 Slice 1E + R6 for the scoping rationale.
 */

export type L1Category =
  | 'approval-pending'
  | 'tool-completed'
  | 'lifecycle:session-start'
  | 'lifecycle:session-end'
  | 'lifecycle:stop'
  | 'lifecycle:user-input'
  | 'unknown'

export type L1Severity = 'info' | 'warn' | 'high' | 'error'

export interface L1UiHint {
  panel_border?: 'yellow' | 'red' | 'green' | null
  badge?: string | null
  overlay?: boolean
}

export interface L1Classification {
  category: L1Category
  severity: L1Severity
  user_action_required: boolean
  summary: string
  detail: Record<string, unknown>
  ui_hint: L1UiHint
}

/**
 * Hook event payload surface accepted by the classifier. Field set matches
 * the Claude Code PreToolUse / PostToolUse / SessionStart / SessionEnd /
 * Stop / UserPromptSubmit hook payloads captured during the spike.
 *
 * Session-log tailer will lift the same fields from jsonl lines so both
 * adapters can share this classifier.
 */
export interface L1HookPayload {
  hook_event_name?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: {
    is_error?: boolean
    content?: unknown
    type?: string
    file?: { numLines?: number }
    output?: unknown
  }
  session_id?: string
  cwd?: string
  permission_mode?: string
  reason?: string
  prompt?: string
}

function summarizeToolInput(toolName: string | undefined, input: Record<string, unknown> | undefined): string | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const filePath = typeof input.file_path === 'string' ? input.file_path : '?'
  const command = typeof input.command === 'string' ? input.command : ''
  const pattern = typeof input.pattern === 'string' ? input.pattern : '?'
  const content = typeof input.content === 'string' ? input.content : ''

  switch (toolName) {
    case 'Read':
      return `file_path: ${filePath}`
    case 'Edit':
      return `file_path: ${filePath} (old → new)`
    case 'Write':
      return `file_path: ${filePath} (${content.length} bytes)`
    case 'Bash':
      return `command: ${command.slice(0, 80)}${command.length > 80 ? '...' : ''}`
    case 'Glob':
      return `pattern: ${pattern}`
    case 'Grep':
      return `pattern: ${pattern}`
    default: {
      const keys = Object.keys(input).slice(0, 3)
      return `${keys.join(', ')}${Object.keys(input).length > 3 ? ', ...' : ''}`
    }
  }
}

function summarizeToolResponse(res: L1HookPayload['tool_response']): string | null {
  if (!res) {
    return null
  }
  if (res.is_error) {
    const content = String(res.content ?? res.type ?? 'unknown').slice(0, 120)
    return `ERROR: ${content}`
  }
  if (res.type === 'text' && res.file && typeof res.file.numLines === 'number') {
    return `file read, ${res.file.numLines} lines`
  }
  if (typeof res.output === 'string') {
    return res.output.slice(0, 120)
  }
  return res.type ?? 'OK'
}

export function classify(payload: L1HookPayload): L1Classification {
  const event = payload.hook_event_name ?? 'unknown'

  switch (event) {
    case 'PreToolUse': {
      const toolName = payload.tool_name ?? 'unknown tool'
      return {
        category: 'approval-pending',
        severity: 'high',
        user_action_required: true,
        summary: `Approval needed: ${toolName}`,
        detail: {
          tool: payload.tool_name,
          input_preview: summarizeToolInput(payload.tool_name, payload.tool_input),
          session_id: payload.session_id,
          permission_mode: payload.permission_mode
        },
        ui_hint: {
          panel_border: 'yellow',
          badge: 'L0 vendor-event',
          overlay: true
        }
      }
    }

    case 'PostToolUse': {
      const isError = payload.tool_response?.is_error === true
      const toolName = payload.tool_name ?? 'tool'
      return {
        category: 'tool-completed',
        severity: isError ? 'error' : 'info',
        user_action_required: false,
        summary: `${toolName} completed${isError ? ' with error' : ''}`,
        detail: {
          tool: payload.tool_name,
          input_preview: summarizeToolInput(payload.tool_name, payload.tool_input),
          response_summary: summarizeToolResponse(payload.tool_response),
          session_id: payload.session_id
        },
        ui_hint: {
          panel_border: isError ? 'red' : 'green',
          overlay: false
        }
      }
    }

    case 'SessionStart':
      return {
        category: 'lifecycle:session-start',
        severity: 'info',
        user_action_required: false,
        summary: 'Session started',
        detail: { session_id: payload.session_id, cwd: payload.cwd },
        ui_hint: { badge: 'L0 ready', overlay: false }
      }

    case 'SessionEnd':
      return {
        category: 'lifecycle:session-end',
        severity: 'info',
        user_action_required: false,
        summary: 'Session ended',
        detail: { session_id: payload.session_id, reason: payload.reason },
        ui_hint: { badge: null, overlay: false }
      }

    case 'Stop':
      return {
        category: 'lifecycle:stop',
        severity: 'info',
        user_action_required: false,
        summary: 'Assistant turn completed',
        detail: { session_id: payload.session_id },
        ui_hint: { overlay: false }
      }

    case 'UserPromptSubmit':
      return {
        category: 'lifecycle:user-input',
        severity: 'info',
        user_action_required: false,
        summary: 'User submitted prompt',
        detail: {
          session_id: payload.session_id,
          prompt_preview: (payload.prompt ?? '').slice(0, 100)
        },
        ui_hint: { overlay: false }
      }

    default:
      return {
        category: 'unknown',
        severity: 'warn',
        user_action_required: false,
        summary: `Unknown hook event: ${event}`,
        detail: payload as Record<string, unknown>,
        ui_hint: {}
      }
  }
}
