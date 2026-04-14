const contentStore = new Map<string, string>()

export function getContent(filePath: string): string {
  return contentStore.get(filePath) ?? ''
}

export function setContent(filePath: string, content: string): void {
  contentStore.set(filePath, content)
}

export function removeContent(filePath: string): void {
  contentStore.delete(filePath)
}

export function hasContent(filePath: string): boolean {
  return contentStore.has(filePath)
}
