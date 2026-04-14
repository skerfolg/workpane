import React, { Suspense, useState, useCallback } from 'react'
import MarkdownEditor from './MarkdownEditor'
import type { BaseEditorProps } from './editorTypes'

const CodeEditor = React.lazy(() => import('./CodeEditor'))

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'scss':
      return 'scss'
    case 'less':
      return 'less'
    case 'html':
    case 'htm':
      return 'html'
    case 'cs':
      return 'csharp'
    case 'py':
      return 'python'
    case 'xml':
    case 'svg':
      return 'xml'
    case 'xaml':
      return 'xaml'
    case 'csproj':
    case 'fsproj':
    case 'vbproj':
    case 'sln':
    case 'props':
    case 'targets':
      return 'xml'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'c':
    case 'h':
    case 'hpp':
    case 'hxx':
      return 'cpp'
    case 'java':
      return 'java'
    case 'go':
      return 'go'
    case 'rs':
      return 'rust'
    case 'sql':
      return 'sql'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell'
    case 'ps1':
    case 'psm1':
    case 'psd1':
      return 'ps1'
    case 'bat':
    case 'cmd':
      return 'bat'
    default:
      return 'plaintext'
  }
}

function isMarkdownFile(filePath: string): boolean {
  return /\.md$/i.test(filePath)
}

interface EditorRouterProps extends BaseEditorProps {
  isDirty: boolean
  onOpenFile?: (path: string) => void
}

function EditorRouter({
  tabId,
  content,
  filePath,
  isDirty,
  onChange,
  onSave,
  onOpenFile
}: EditorRouterProps): React.JSX.Element {
  const [markdownMode, setMarkdownMode] = useState<'wysiwyg' | 'source'>('wysiwyg')

  const handleMarkdownChange = useCallback(
    (_id: string, newContent: string) => {
      onChange(newContent)
    },
    [onChange]
  )

  const handleMarkdownSave = useCallback(
    (_id: string) => {
      onSave()
    },
    [onSave]
  )

  if (isMarkdownFile(filePath)) {
    return (
      <MarkdownEditor
        tabId={tabId}
        content={content}
        filePath={filePath}
        isDirty={isDirty}
        onChange={handleMarkdownChange}
        onSave={handleMarkdownSave}
        onOpenFile={onOpenFile}
        externalMode={markdownMode}
        onModeChange={setMarkdownMode}
      />
    )
  }

  const language = getLanguageFromPath(filePath)

  return (
    <Suspense fallback={<div style={{ padding: '1em', color: 'var(--text-2)' }}>Loading editor...</div>}>
      <CodeEditor
        tabId={tabId}
        content={content}
        filePath={filePath}
        onChange={onChange}
        onSave={onSave}
        language={language}
      />
    </Suspense>
  )
}

export { getLanguageFromPath }
export default EditorRouter
