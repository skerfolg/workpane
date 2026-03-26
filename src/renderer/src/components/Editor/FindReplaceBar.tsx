import React, { useState, useEffect, useRef, useCallback } from 'react'
import './FindReplaceBar.css'

interface FindReplaceBarProps {
  content: string
  onReplace: (newContent: string) => void
  onClose: () => void
  mode: 'find' | 'replace'
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function FindReplaceBar({ content, onReplace, onClose, mode }: FindReplaceBarProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)
  const [totalMatches, setTotalMatches] = useState(0)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [isReplaceMode, setIsReplaceMode] = useState(mode === 'replace')
  const [regexError, setRegexError] = useState(false)

  const findInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const matchIndicesRef = useRef<number[]>([])

  useEffect(() => {
    findInputRef.current?.focus()
    findInputRef.current?.select()
  }, [])

  useEffect(() => {
    setIsReplaceMode(mode === 'replace')
  }, [mode])

  const computeMatches = useCallback(
    (q: string): { indices: number[]; total: number } => {
      if (!q) return { indices: [], total: 0 }
      try {
        const flags = caseSensitive ? 'g' : 'gi'
        const pattern = useRegex ? q : escapeRegex(q)
        const re = new RegExp(pattern, flags)
        setRegexError(false)
        const indices: number[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(content)) !== null) {
          indices.push(m.index)
          if (m[0].length === 0) re.lastIndex++ // avoid infinite loop on empty match
        }
        return { indices, total: indices.length }
      } catch {
        setRegexError(true)
        return { indices: [], total: 0 }
      }
    },
    [content, caseSensitive, useRegex]
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const { indices, total } = computeMatches(query)
      matchIndicesRef.current = indices
      setTotalMatches(total)
      setCurrentMatch(total > 0 ? 1 : 0)
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, computeMatches])

  const goNext = (): void => {
    if (totalMatches === 0) return
    setCurrentMatch((prev) => (prev >= totalMatches ? 1 : prev + 1))
  }

  const goPrev = (): void => {
    if (totalMatches === 0) return
    setCurrentMatch((prev) => (prev <= 1 ? totalMatches : prev - 1))
  }

  const replaceCurrent = (): void => {
    if (totalMatches === 0 || currentMatch === 0) return
    const idx = matchIndicesRef.current[currentMatch - 1]
    if (idx === undefined) return
    try {
      const flags = caseSensitive ? '' : 'i'
      const pattern = useRegex ? query : escapeRegex(query)
      const re = new RegExp(pattern, flags)
      const before = content.slice(0, idx)
      const after = content.slice(idx).replace(re, replacement)
      onReplace(before + after)
    } catch {
      // invalid regex — do nothing
    }
  }

  const replaceAll = (): void => {
    if (!query) return
    try {
      const flags = caseSensitive ? 'g' : 'gi'
      const pattern = useRegex ? query : escapeRegex(query)
      const re = new RegExp(pattern, flags)
      onReplace(content.replace(re, replacement))
    } catch {
      // invalid regex — do nothing
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        goPrev()
      } else {
        goNext()
      }
    }
  }

  return (
    <div className="find-replace-bar" onKeyDown={handleKeyDown}>
      {/* Find row */}
      <div className="find-replace-bar__row">
        <input
          ref={findInputRef}
          className={`find-replace-bar__input${regexError ? ' find-replace-bar__input--error' : ''}`}
          type="text"
          placeholder="Find"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <span className="find-replace-bar__counter">
          {totalMatches > 0 ? `${currentMatch} / ${totalMatches}` : query ? '0 / 0' : ''}
        </span>

        <button
          className={`find-replace-bar__opt-btn${caseSensitive ? ' active' : ''}`}
          title="Match Case (Aa)"
          onClick={() => setCaseSensitive((v) => !v)}
        >
          Aa
        </button>
        <button
          className={`find-replace-bar__opt-btn${useRegex ? ' active' : ''}`}
          title="Use Regex (.*)"
          onClick={() => setUseRegex((v) => !v)}
        >
          .*
        </button>

        <button className="find-replace-bar__nav-btn" title="Previous (Shift+Enter)" onClick={goPrev}>
          &#8593;
        </button>
        <button className="find-replace-bar__nav-btn" title="Next (Enter)" onClick={goNext}>
          &#8595;
        </button>

        <button
          className={`find-replace-bar__opt-btn${isReplaceMode ? ' active' : ''}`}
          title="Toggle Replace Mode"
          onClick={() => setIsReplaceMode((v) => !v)}
        >
          ⇄
        </button>

        <button className="find-replace-bar__close-btn" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
      </div>

      {/* Replace row */}
      {isReplaceMode && (
        <div className="find-replace-bar__row">
          <input
            className="find-replace-bar__input"
            type="text"
            placeholder="Replace text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
          />
          <button className="find-replace-bar__action-btn" onClick={replaceCurrent}>
            Replace
          </button>
          <button className="find-replace-bar__action-btn" onClick={replaceAll}>
            Replace All
          </button>
        </div>
      )}
    </div>
  )
}

export default FindReplaceBar
