export interface BaseEditorProps {
  tabId: string
  content: string
  filePath: string
  onChange: (content: string) => void
  onSave: () => void
}

export interface CodeEditorProps extends BaseEditorProps {
  language: string
}
