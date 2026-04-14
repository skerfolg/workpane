import katex from 'katex'
import 'katex/dist/katex.min.css'

export function renderInlineLatex(html: string): string {
  return html.replace(/\$([^$\n]+?)\$/g, (_match, tex) => {
    try {
      return katex.renderToString(tex, { throwOnError: false, displayMode: false })
    } catch {
      return _match
    }
  })
}

export function renderBlockLatex(html: string): string {
  return html.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex) => {
    try {
      return katex.renderToString(tex, { throwOnError: false, displayMode: true })
    } catch {
      return _match
    }
  })
}

export function renderLatex(html: string): string {
  // Block first to avoid double-processing
  return renderInlineLatex(renderBlockLatex(html))
}
