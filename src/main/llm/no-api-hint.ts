import type { LlmClassificationResult, LlmRuntimeInput } from '../../shared/types'

function tailLines(text: string, count: number): string {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-count)
    .join('\n')
}

export function buildNoApiHint(input: LlmRuntimeInput): LlmClassificationResult {
  const excerpt = tailLines(input.recentOutput, 6) || input.matchedText || input.patternName
  const lower = excerpt.toLowerCase()

  let category: LlmClassificationResult['category'] = 'unknown'
  if (/\b(error|exception|failed|traceback)\b/.test(lower)) {
    category = 'error'
  } else if (/\b(approve|approval|allow|confirm|proceed)\b/.test(lower)) {
    category = 'approval'
  } else if (/\b(input|enter|type|provide|fill|select)\b/.test(lower)) {
    category = 'input-needed'
  }

  const summary = excerpt.split('\n')[0]?.trim() || 'Recent output suggests attention is needed.'

  return {
    category,
    summary,
    confidence: 'low',
    source: 'no-api',
    providerId: null,
    modelId: null,
    recentOutputExcerpt: excerpt
  }
}
