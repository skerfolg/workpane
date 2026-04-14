import type {
  LlmCauseCategory,
  LlmClassificationResult,
  LlmModelSummary,
  LlmProviderId
} from '../../shared/types'

function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Provider response did not contain JSON.')
  }
  return text.slice(start, end + 1)
}

function normalizeCategory(value: string): LlmCauseCategory {
  if (value === 'approval' || value === 'input-needed' || value === 'error') {
    return value
  }
  return 'unknown'
}

function buildClassificationPrompt(recentOutput: string): string {
  return [
    'Classify the likely cause of this stalled terminal session.',
    'Return JSON only with keys: category, summary, confidence.',
    'Valid category values: approval, input-needed, error, unknown.',
    'Valid confidence values: low, medium, high.',
    'Keep summary under 140 characters.',
    '',
    recentOutput
  ].join('\n')
}

function makeResult(
  providerId: LlmProviderId,
  modelId: string,
  rawText: string,
  recentOutput: string
): LlmClassificationResult {
  const parsed = JSON.parse(extractJsonObject(rawText)) as {
    category?: string
    summary?: string
    confidence?: 'low' | 'medium' | 'high'
  }

  return {
    category: normalizeCategory(parsed.category ?? 'unknown'),
    summary: parsed.summary?.trim() || 'The session may need attention.',
    confidence: parsed.confidence ?? 'low',
    source: 'llm',
    providerId,
    modelId,
    recentOutputExcerpt: recentOutput.split(/\r?\n/).filter(Boolean).slice(-6).join('\n')
  }
}

interface ProviderCallSuccess {
  result: LlmClassificationResult
  inputTokens: number
  outputTokens: number
}

interface LlmProviderAdapter {
  listModels: (apiKey: string) => Promise<LlmModelSummary[]>
  classifyCause: (apiKey: string, modelId: string, recentOutput: string) => Promise<ProviderCallSuccess>
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }
  return text ? JSON.parse(text) : {}
}

function mapOpenAiModels(providerId: LlmProviderId, payload: { data?: Array<{ id: string }> }): LlmModelSummary[] {
  return (payload.data ?? [])
    .map((model) => ({
      id: model.id,
      providerId,
      displayName: model.id
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

async function openAiCompatibleListModels(baseUrl: string, apiKey: string, providerId: LlmProviderId): Promise<LlmModelSummary[]> {
  const payload = await parseJsonResponse(await fetch(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  }))
  return mapOpenAiModels(providerId, payload)
}

async function openAiCompatibleClassify(baseUrl: string, apiKey: string, providerId: LlmProviderId, modelId: string, recentOutput: string): Promise<ProviderCallSuccess> {
  const payload = await parseJsonResponse(await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'You classify stalled terminal sessions. Return JSON only.'
        },
        {
          role: 'user',
          content: buildClassificationPrompt(recentOutput)
        }
      ]
    })
  }))

  const text = payload.choices?.[0]?.message?.content ?? ''
  return {
    result: makeResult(providerId, modelId, text, recentOutput),
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0
  }
}

const ADAPTERS: Record<LlmProviderId, LlmProviderAdapter> = {
  openai: {
    listModels: (apiKey) => openAiCompatibleListModels('https://api.openai.com/v1', apiKey, 'openai'),
    classifyCause: (apiKey, modelId, recentOutput) => openAiCompatibleClassify('https://api.openai.com/v1', apiKey, 'openai', modelId, recentOutput)
  },
  groq: {
    listModels: (apiKey) => openAiCompatibleListModels('https://api.groq.com/openai/v1', apiKey, 'groq'),
    classifyCause: (apiKey, modelId, recentOutput) => openAiCompatibleClassify('https://api.groq.com/openai/v1', apiKey, 'groq', modelId, recentOutput)
  },
  anthropic: {
    async listModels(apiKey) {
      const payload = await parseJsonResponse(await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      }))
      return (payload.data ?? []).map((model: { id: string; display_name?: string }) => ({
        id: model.id,
        providerId: 'anthropic',
        displayName: model.display_name ?? model.id
      }))
    },
    async classifyCause(apiKey, modelId, recentOutput) {
      const payload = await parseJsonResponse(await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 180,
          temperature: 0,
          system: 'You classify stalled terminal sessions. Return JSON only.',
          messages: [{ role: 'user', content: buildClassificationPrompt(recentOutput) }]
        })
      }))

      const text = payload.content?.map((part: { text?: string }) => part.text ?? '').join('\n') ?? ''
      return {
        result: makeResult('anthropic', modelId, text, recentOutput),
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0
      }
    }
  },
  gemini: {
    async listModels(apiKey) {
      const payload = await parseJsonResponse(await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`))
      return (payload.models ?? [])
        .map((model: { name: string; displayName?: string }) => {
          const id = String(model.name).replace(/^models\//, '')
          return {
            id,
            providerId: 'gemini',
            displayName: model.displayName ?? id
          }
        })
        .sort((a: LlmModelSummary, b: LlmModelSummary) => a.id.localeCompare(b.id))
    },
    async classifyCause(apiKey, modelId, recentOutput) {
      const payload = await parseJsonResponse(await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: buildClassificationPrompt(recentOutput) }]
              }
            ],
            generationConfig: {
              temperature: 0
            }
          })
        }
      ))

      const text = payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('\n') ?? ''
      return {
        result: makeResult('gemini', modelId, text, recentOutput),
        inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0
      }
    }
  }
}

export function getProviderAdapter(providerId: LlmProviderId): LlmProviderAdapter {
  return ADAPTERS[providerId]
}
