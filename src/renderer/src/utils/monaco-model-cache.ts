import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

const modelCache = new Map<string, monaco.editor.ITextModel>()

export function getOrCreateModel(
  filePath: string,
  content: string,
  language: string
): monaco.editor.ITextModel {
  const existing = modelCache.get(filePath)
  if (existing && !existing.isDisposed()) return existing
  const model = monaco.editor.createModel(content, language)
  modelCache.set(filePath, model)
  return model
}

export function disposeModel(filePath: string): void {
  const model = modelCache.get(filePath)
  if (model) {
    model.dispose()
    modelCache.delete(filePath)
  }
}

export function updateModelContent(filePath: string, content: string): void {
  const model = modelCache.get(filePath)
  if (model && !model.isDisposed() && model.getValue() !== content) {
    model.setValue(content)
  }
}
