import React, { useEffect, useRef, useState, useCallback } from 'react'

// editor.api — exports the monaco namespace (editor, languages, etc.) without side-effects.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
// NOTE: Do NOT import editor.all separately — each language contribution below
// already imports _.contribution.js which contains the full editor UI (find, folding,
// hover, semantic tokens, token color CSS). Importing both causes Vite to create
// duplicate module instances, breaking the languages singleton used by registerLanguage.

// Language contributions — these register Monarch tokenizers for syntax highlighting
// and transitively load all editor UI features via _.contribution.js.
import 'monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution'
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution'
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution'
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution'
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution'
import 'monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution'
import 'monaco-editor/esm/vs/basic-languages/bat/bat.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution'
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution'
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'

// Language service workers — imported via Vite's ?worker syntax for Electron compatibility.
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

import type { CodeEditorProps } from './editorTypes'
import { getOrCreateModel, updateModelContent } from '../../utils/monaco-model-cache'
import './CodeEditor.css'

const MAX_FILE_SIZE = 5 * 1024 * 1024
const WARN_FILE_SIZE = 1 * 1024 * 1024

function isBinaryContent(content: string): boolean {
  const sample = content.slice(0, 8192)
  return sample.includes('\x00')
}

function getMonacoLanguage(language: string): string {
  switch (language) {
    case 'typescript':
    case 'typescriptreact':
      return 'typescript'
    case 'javascript':
    case 'javascriptreact':
      return 'javascript'
    case 'csharp':
      return 'csharp'
    case 'python':
      return 'python'
    case 'cpp':
    case 'c':
    case 'h':
    case 'hpp':
      return 'cpp'
    case 'java':
      return 'java'
    case 'json':
      return 'json'
    case 'css':
    case 'scss':
    case 'less':
      return language
    case 'html':
      return 'html'
    case 'xml':
    case 'xaml':
    case 'csproj':
    case 'fsproj':
    case 'sln':
    case 'svg':
      return 'xml'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'markdown':
      return 'markdown'
    case 'sql':
      return 'sql'
    case 'shell':
    case 'bash':
    case 'sh':
      return 'shell'
    case 'ps1':
      return 'powershell'
    case 'bat':
    case 'cmd':
      return 'bat'
    case 'go':
      return 'go'
    case 'rust':
      return 'rust'
    default:
      return 'plaintext'
  }
}

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') !== 'light'
}

/** Define a custom Monaco theme from CSS variables */
function defineAppTheme(themeName: string, isDark: boolean): void {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string, fallback: string) => style.getPropertyValue(v).trim() || fallback

  const bg1 = get('--bg-1', isDark ? '#1a1b24' : '#ffffff')
  const bg2 = get('--bg-2', isDark ? '#1e1f2a' : '#f7f8fa')
  const bg3 = get('--bg-3', isDark ? '#252637' : '#ebedf0')
  const text1 = get('--text-1', isDark ? '#d4d4d4' : '#333333')
  const text3 = get('--text-3', isDark ? '#555555' : '#999999')
  const accent = get('--accent', isDark ? '#4c8dff' : '#0066db')
  const border = get('--border', isDark ? '#333333' : '#e0e0e0')

  monaco.editor.defineTheme(themeName, {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg1,
      'editor.foreground': text1,
      'editor.lineHighlightBackground': bg3,
      'editor.selectionBackground': isDark ? '#264f7844' : '#add6ff80',
      'editorLineNumber.foreground': text3,
      'editorLineNumber.activeForeground': text1,
      'editorGutter.background': bg2,
      'editorCursor.foreground': accent,
      'editorWidget.background': bg2,
      'editorWidget.border': border,
      'minimap.background': bg2,
      'editorOverviewRuler.border': border,
      'scrollbarSlider.background': text3 + '40',
      'scrollbarSlider.hoverBackground': text3 + '60',
      'scrollbarSlider.activeBackground': text3 + '80',
    }
  })
}

let themesInitialized = false
function ensureThemes(): void {
  if (themesInitialized) return
  defineAppTheme('workpane-dark', true)
  defineAppTheme('workpane-light', false)
  themesInitialized = true
}

function CodeEditor({ tabId, content, filePath, onChange, onSave, language }: CodeEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const contentListenerRef = useRef<monaco.IDisposable | null>(null)
  const isInternalEditRef = useRef(false)
  const [showWarning, setShowWarning] = useState(false)
  const [warningDismissed, setWarningDismissed] = useState(false)

  onChangeRef.current = onChange
  onSaveRef.current = onSave

  const handleDismissWarning = useCallback(() => {
    setWarningDismissed(true)
  }, [])

  const binary = isBinaryContent(content)
  const tooLarge = content.length > MAX_FILE_SIZE
  const shouldSkip = binary || tooLarge
  const shouldWarn = content.length > WARN_FILE_SIZE && !warningDismissed

  // Create editor instance once (mount/unmount only)
  useEffect(() => {
    if (shouldSkip || !containerRef.current) return

    ensureThemes()
    const dark = isDarkTheme()
    const themeName = dark ? 'workpane-dark' : 'workpane-light'

    const editor = monaco.editor.create(containerRef.current, {
      theme: themeName,
      automaticLayout: false,
      minimap: { enabled: true, renderCharacters: false },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Consolas, monospace",
      lineHeight: 20,
      padding: { top: 8 },
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      renderWhitespace: 'selection',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true,
      },
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      overviewRulerLanes: 3,
      fixedOverflowWidgets: true,
    })

    editorRef.current = editor

    // Ctrl+S save — registered once on the persistent editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current()
    })

    return () => {
      contentListenerRef.current?.dispose()
      contentListenerRef.current = null
      editor.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldSkip])

  // Switch model when tab/file/language changes
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || shouldSkip) return

    const monacoLang = getMonacoLanguage(language)
    const model = getOrCreateModel(filePath, content, monacoLang)
    editor.setModel(model)

    // Re-attach content change listener for the new model
    contentListenerRef.current?.dispose()
    contentListenerRef.current = editor.onDidChangeModelContent(() => {
      isInternalEditRef.current = true
      onChangeRef.current(editor.getValue())
    })

    if (content.length > WARN_FILE_SIZE) {
      setShowWarning(true)
    }

    return () => {
      contentListenerRef.current?.dispose()
      contentListenerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, filePath, language, shouldSkip])

  // Handle external content updates (e.g. conflict resolution) without feedback loop
  useEffect(() => {
    if (isInternalEditRef.current) {
      isInternalEditRef.current = false
      return
    }
    updateModelContent(filePath, content)
  }, [content, filePath])

  // ResizeObserver for smooth layout updates (prevents minimap flicker)
  useEffect(() => {
    if (shouldSkip || !containerRef.current) return

    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        editorRef.current?.layout()
        rafId = null
      })
    })

    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [shouldSkip])

  // Theme change listener
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          const dark = isDarkTheme()
          defineAppTheme('workpane-dark', true)
          defineAppTheme('workpane-light', false)
          monaco.editor.setTheme(dark ? 'workpane-dark' : 'workpane-light')
        }
      }
    })

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  if (binary) {
    return (
      <div className="code-editor">
        <div className="code-editor__placeholder">Binary file — cannot be displayed</div>
      </div>
    )
  }

  if (tooLarge) {
    return (
      <div className="code-editor">
        <div className="code-editor__placeholder">
          File too large to display ({(content.length / (1024 * 1024)).toFixed(1)} MB)
        </div>
      </div>
    )
  }

  return (
    <div className="code-editor">
      {showWarning && shouldWarn && (
        <div className="code-editor__warning">
          <span>Large file ({(content.length / (1024 * 1024)).toFixed(1)} MB) — editing may be slow</span>
          <button onClick={handleDismissWarning} style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit' }}>
            Dismiss
          </button>
        </div>
      )}
      <div className="code-editor__container" ref={containerRef} />
    </div>
  )
}

export default CodeEditor
