import React, { useEffect, useRef, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import MermaidBlock from './MermaidBlock'
import { attachLinkHandler } from '../../utils/link-handler'
import './MarkdownEditor.css'

// Milkdown types — imported statically only for type references
import type { Editor } from '@milkdown/core'

// Module-level singleton: Milkdown dynamic imports execute only once
let milkdownModulesPromise: ReturnType<typeof loadMilkdownModules> | null = null

function loadMilkdownModules(): Promise<[
  typeof import('@milkdown/core'),
  typeof import('@milkdown/preset-commonmark'),
  typeof import('@milkdown/preset-gfm'),
  typeof import('@milkdown/plugin-history'),
  typeof import('@milkdown/plugin-listener'),
]> {
  return Promise.all([
    import('@milkdown/core'),
    import('@milkdown/preset-commonmark'),
    import('@milkdown/preset-gfm'),
    import('@milkdown/plugin-history'),
    import('@milkdown/plugin-listener'),
  ])
}

function getMilkdownModules(): ReturnType<typeof loadMilkdownModules> {
  if (!milkdownModulesPromise) {
    milkdownModulesPromise = loadMilkdownModules()
  }
  return milkdownModulesPromise
}

interface MarkdownEditorProps {
  tabId: string
  content: string
  filePath: string
  isDirty: boolean
  onChange: (id: string, content: string) => void
  onSave: (id: string) => void
  onOpenFile?: (path: string) => void
  externalMode?: 'wysiwyg' | 'source'
  onModeChange?: (mode: 'wysiwyg' | 'source') => void
}

function MarkdownEditor({
  tabId,
  content,
  filePath,
  isDirty: _isDirty,
  onChange,
  onSave,
  onOpenFile,
  externalMode,
  onModeChange
}: MarkdownEditorProps): React.JSX.Element {
  const editorRef = useRef<HTMLDivElement>(null)
  const milkdownRef = useRef<Editor | null>(null)
  const [internalMode, setInternalMode] = useState<'wysiwyg' | 'source'>('wysiwyg')
  const [sourceContent, setSourceContent] = useState(content)

  // Use external mode if provided, otherwise internal
  const mode = externalMode ?? internalMode

  const setMode = (m: 'wysiwyg' | 'source'): void => {
    if (onModeChange) {
      onModeChange(m)
    } else {
      setInternalMode(m)
    }
  }

  const handleSave = useCallback(() => {
    onSave(tabId)
  }, [tabId, onSave])

  // Keyboard shortcut Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  // Sync source content when switching to source mode
  useEffect(() => {
    if (mode === 'source') {
      setSourceContent(content)
    }
  }, [mode, content])

  // Initialize Milkdown editor — dynamic import defers Milkdown bundle until first use
  useEffect(() => {
    if (mode !== 'wysiwyg' || !editorRef.current) return

    let destroyed = false
    const milkdownStart = performance.now()

    getMilkdownModules().then(([
      { Editor, rootCtx, defaultValueCtx },
      { commonmark },
      { gfm },
      { history },
      { listener, listenerCtx },
    ]) => {
      if (destroyed) return
      console.log(`[PERF][Renderer] MarkdownEditor Milkdown dynamic import: ${(performance.now() - milkdownStart).toFixed(1)}ms`)
      return Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, editorRef.current!)
          ctx.set(defaultValueCtx, content)
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            if (!destroyed) onChange(tabId, markdown)
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener)
        .create()
        .then((editor) => {
          if (!destroyed) {
            milkdownRef.current = editor
            console.log(`[PERF][Renderer] MarkdownEditor Milkdown init: ${(performance.now() - milkdownStart).toFixed(1)}ms`)
          } else {
            editor.destroy()
          }
        })
    }).catch((err) => console.error('Milkdown init error:', err))

    return () => {
      destroyed = true
      milkdownRef.current?.destroy().catch(() => {})
      milkdownRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tabId])

  // Render mermaid code blocks and attach link handler after editor mounts
  useEffect(() => {
    if (mode !== 'wysiwyg' || !editorRef.current) return

    const container = editorRef.current

    // MutationObserver: watch for code blocks with language "mermaid"
    const renderMermaidBlocks = (): void => {
      const codeBlocks = container.querySelectorAll('code.language-mermaid')
      codeBlocks.forEach((block) => {
        const pre = block.parentElement
        if (!pre || pre.dataset.mermaidRendered === '1') return
        pre.dataset.mermaidRendered = '1'
        const code = block.textContent ?? ''
        const wrapper = document.createElement('div')
        pre.replaceWith(wrapper)
        const root = createRoot(wrapper)
        root.render(<MermaidBlock code={code} />)
      })
    }

    const observer = new MutationObserver(renderMermaidBlocks)
    observer.observe(container, { childList: true, subtree: true })
    // Run once immediately in case content already exists
    renderMermaidBlocks()

    // Attach link click handler
    const openFile = onOpenFile ?? (() => {})
    const detachLinks = attachLinkHandler(container, openFile, filePath)

    return () => {
      observer.disconnect()
      detachLinks()
    }
  }, [mode, tabId, filePath, onOpenFile])

  const handleSourceChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    setSourceContent(val)
    onChange(tabId, val)
  }

  return (
    <div className="markdown-editor">
      {mode === 'wysiwyg' ? (
        <div className="markdown-editor__wysiwyg" ref={editorRef} />
      ) : (
        <textarea
          className="markdown-editor__source"
          value={sourceContent}
          onChange={handleSourceChange}
          spellCheck={false}
        />
      )}
    </div>
  )
}

export default MarkdownEditor
