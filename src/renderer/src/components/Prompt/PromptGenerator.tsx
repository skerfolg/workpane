import React, { useState, useCallback, useEffect } from 'react'
import { useKanban } from '../../contexts/KanbanContext'
import './PromptGenerator.css'

interface PromptGeneratorProps {
  issueId: string
}

export function PromptGenerator({ issueId }: PromptGeneratorProps): React.JSX.Element {
  const { promptTemplates, generatePrompt } = useKanban()
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [prompt, setPrompt] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [generating, setGenerating] = useState(false)

  // Pick default template on mount or when templates change
  useEffect(() => {
    if (promptTemplates.length > 0 && !selectedTemplateId) {
      const defaultTpl = promptTemplates.find((t) => t.isDefault) ?? promptTemplates[0]
      setSelectedTemplateId(defaultTpl.id)
    }
  }, [promptTemplates, selectedTemplateId])

  const handleGenerate = useCallback(async (): Promise<void> => {
    if (!selectedTemplateId) return
    setGenerating(true)
    try {
      const result = await generatePrompt(issueId, selectedTemplateId)
      setPrompt(result?.content ?? '')
    } finally {
      setGenerating(false)
    }
  }, [issueId, selectedTemplateId, generatePrompt])

  // Auto-generate when issueId or template changes
  useEffect(() => {
    if (issueId && selectedTemplateId) {
      handleGenerate()
    }
  }, [issueId, selectedTemplateId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = useCallback(async (): Promise<void> => {
    if (!prompt) return
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [prompt])

  return (
    <div className="prompt-gen">
      <div className="prompt-gen__header">
        <span className="prompt-gen__title">Prompt Generator</span>
      </div>
      <div className="prompt-gen__template-row">
        <label className="prompt-gen__label" htmlFor="prompt-template-select">
          Template
        </label>
        <select
          id="prompt-template-select"
          className="prompt-gen__select"
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
        >
          {promptTemplates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
            </option>
          ))}
          {promptTemplates.length === 0 && (
            <option value="">No templates</option>
          )}
        </select>
      </div>
      <div className="prompt-gen__preview">
        {generating ? (
          <div className="prompt-gen__generating">Generating...</div>
        ) : prompt ? (
          <pre className="prompt-gen__content">{prompt}</pre>
        ) : (
          <div className="prompt-gen__empty">Generate a prompt</div>
        )}
      </div>
      <div className="prompt-gen__actions">
        <button
          className="prompt-gen__btn prompt-gen__btn--copy"
          onClick={handleCopy}
          disabled={!prompt || generating}
        >
          {copied ? 'Copied!' : 'Copy to clipboard'}
        </button>
        <button
          className="prompt-gen__btn prompt-gen__btn--regen"
          onClick={handleGenerate}
          disabled={!selectedTemplateId || generating}
        >
          Regenerate
        </button>
      </div>
    </div>
  )
}
