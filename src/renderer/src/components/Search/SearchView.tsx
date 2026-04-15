import React, { useState, useCallback, useRef } from 'react'
import './SearchView.css'
import { useEditor } from '../../contexts/EditorContext'

interface SearchMatch {
  line: string
  lineNumber: number
  matchStart: number
  matchEnd: number
}

interface SearchResult {
  filePath: string
  fileName: string
  category: string
  matches: SearchMatch[]
}

type Scope = 'docs' | 'source'

const ALL_SCOPES: Scope[] = ['docs', 'source']

const SCOPE_LABELS: Record<Scope, string> = {
  docs: 'Docs',
  source: 'Source'
}

function highlightMatch(line: string, matchStart: number, matchEnd: number): React.JSX.Element {
  const before = line.slice(0, matchStart)
  const match = line.slice(matchStart, matchEnd)
  const after = line.slice(matchEnd)
  return (
    <span>
      {before}
      <strong className="search-view__highlight">{match}</strong>
      {after}
    </span>
  )
}

function groupByCategory(results: SearchResult[]): Record<string, SearchResult[]> {
  const groups: Record<string, SearchResult[]> = {}
  for (const result of results) {
    if (!groups[result.category]) groups[result.category] = []
    groups[result.category].push(result)
  }
  return groups
}

function countMatches(results: SearchResult[]): number {
  return results.reduce((sum, r) => sum + r.matches.length, 0)
}

export function SearchView(): React.JSX.Element {
  const { openFile } = useEditor()

  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [scopes, setScopes] = useState<Set<Scope>>(new Set(ALL_SCOPES))
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  const queryRef = useRef(query)
  queryRef.current = query

  const getRootDir = useCallback(async (): Promise<string | null> => {
    const ws = await window.workspace.getCurrent()
    return ws ? ws.path : null
  }, [])

  const handleSearch = useCallback(async () => {
    const q = queryRef.current.trim()
    if (!q) return

    const rootDir = await getRootDir()
    if (!rootDir) return

    setLoading(true)
    setSearched(false)
    try {
      const found = await window.search.find(rootDir, q, {
        scopes: Array.from(scopes)
      })
      setResults(found)
      setSearched(true)
    } catch (err) {
      console.error('Search failed:', err)
      setResults([])
      setSearched(true)
    } finally {
      setLoading(false)
    }
  }, [scopes, getRootDir])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSearch()
      }
    },
    [handleSearch]
  )

  const toggleScope = useCallback((scope: Scope) => {
    setScopes((prev) => {
      const next = new Set(prev)
      if (next.has(scope)) {
        if (next.size === 1) return prev // keep at least one
        next.delete(scope)
      } else {
        next.add(scope)
      }
      return next
    })
  }, [])

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }, [])

  const handleReplaceAll = useCallback(async () => {
    const q = query.trim()
    if (!q || results.length === 0) return

    const rootDir = await getRootDir()
    if (!rootDir) return

    const filePaths = results.map((r) => r.filePath)
    setReplacing(true)
    try {
      await window.search.replace(rootDir, q, replacement, filePaths)
      // Re-run search to refresh results
      await handleSearch()
    } catch (err) {
      console.error('Replace failed:', err)
    } finally {
      setReplacing(false)
    }
  }, [query, replacement, results, getRootDir, handleSearch])

  const groups = groupByCategory(results)
  const categoryOrder = ['Docs', 'Source', 'Other']
  const sortedCategories = categoryOrder.filter((c) => groups[c])

  return (
    <div className="search-view" role="search" aria-label="File Search">
      {/* Search input */}
      <div className="search-view__input-row">
        <input
          className="search-view__input"
          type="text"
          placeholder="Type and press Enter to search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
      </div>

      {/* Scope toggles */}
      <div className="search-view__scopes">
        {ALL_SCOPES.map((scope) => (
          <button
            key={scope}
            className={`search-view__scope-btn${scopes.has(scope) ? ' search-view__scope-btn--active' : ''}`}
            onClick={() => toggleScope(scope)}
          >
            {SCOPE_LABELS[scope]}
          </button>
        ))}
      </div>

      {/* Loading spinner */}
      {loading && (
        <div className="search-view__loading">
          <span className="search-view__spinner" />
          Searching...
        </div>
      )}

      {/* Results */}
      {!loading && searched && results.length === 0 && (
        <div className="search-view__empty">No results found</div>
      )}

      {!loading && results.length > 0 && (
        <div className="search-view__results">
          {sortedCategories.map((category) => {
            const categoryResults = groups[category]
            const matchCount = countMatches(categoryResults)
            const isCollapsed = collapsedCategories.has(category)
            return (
              <div key={category} className="search-view__category">
                <div
                  className="search-view__category-header"
                  onClick={() => toggleCategory(category)}
                >
                  <span className="search-view__category-arrow">{isCollapsed ? '▶' : '▼'}</span>
                  <span className="search-view__category-name">{category}</span>
                  <span className="search-view__category-count">{matchCount}</span>
                </div>
                {!isCollapsed && (
                  <div className="search-view__category-files">
                    {categoryResults.map((result) => (
                      <div key={result.filePath} className="search-view__file">
                        <div className="search-view__file-name">{result.fileName}</div>
                        {result.matches.map((match, idx) => (
                          <div
                            key={idx}
                            className="search-view__match"
                            onClick={() => openFile(result.filePath)}
                            title={result.filePath}
                          >
                            <span className="search-view__line-number">{match.lineNumber}</span>
                            <span className="search-view__line-content">
                              {highlightMatch(match.line, match.matchStart, match.matchEnd)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Replace section */}
      <div className="search-view__replace">
        <input
          className="search-view__input"
          type="text"
          placeholder="Replace text"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          disabled={replacing}
        />
        <button
          className="search-view__replace-btn"
          onClick={handleReplaceAll}
          disabled={!query.trim() || results.length === 0 || replacing}
        >
          {replacing ? 'Replacing...' : 'Replace All'}
        </button>
      </div>
    </div>
  )
}

export default SearchView
