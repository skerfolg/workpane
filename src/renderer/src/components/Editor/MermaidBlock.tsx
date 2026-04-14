import React, { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, theme: 'dark' })

let mermaidIdCounter = 0

interface MermaidBlockProps {
  code: string
}

function MermaidBlock({ code }: MermaidBlockProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef<string>(`mermaid-${++mermaidIdCounter}`)

  useEffect(() => {
    if (!containerRef.current) return

    const id = idRef.current
    setError(null)

    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = svg
        }
      })
      .catch((err) => {
        setError(err?.message ?? 'Mermaid render failed')
      })
  }, [code])

  if (error) {
    return (
      <pre
        style={{
          background: '#2d2d2d',
          color: '#f8f8f2',
          padding: '1em',
          borderRadius: '4px',
          overflowX: 'auto'
        }}
      >
        <code>{code}</code>
      </pre>
    )
  }

  return <div ref={containerRef} className="mermaid-block" />
}

export default MermaidBlock
