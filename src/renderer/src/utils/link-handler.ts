function browserDirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? filePath.slice(0, idx) : ''
}

function browserResolve(base: string, rel: string): string {
  if (rel.startsWith('/')) return rel
  const parts = base.replace(/\\/g, '/').split('/')
  parts.pop()
  rel.split('/').forEach((seg) => {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  })
  return parts.join('/')
}

export function handleLinkClick(
  href: string,
  openFile: (path: string) => void,
  currentFilePath?: string
): void {
  if (!href) return

  if (href.startsWith('http://') || href.startsWith('https://')) {
    const shellApi = (window as any).shell
    if (shellApi?.openExternal) {
      shellApi.openExternal(href)
    }
    return
  }

  if (href.endsWith('.md')) {
    let resolvedPath = href
    if (currentFilePath && !href.startsWith('/')) {
      resolvedPath = browserResolve(browserDirname(currentFilePath), href)
    }
    openFile(resolvedPath)
    return
  }
}

export function attachLinkHandler(
  container: HTMLElement,
  openFile: (path: string) => void,
  currentFilePath?: string
): () => void {
  const onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a') as HTMLAnchorElement | null
    if (!anchor) return

    const href = anchor.getAttribute('href')
    if (!href) return

    e.preventDefault()
    handleLinkClick(href, openFile, currentFilePath)
  }

  container.addEventListener('click', onClick)
  return () => container.removeEventListener('click', onClick)
}
