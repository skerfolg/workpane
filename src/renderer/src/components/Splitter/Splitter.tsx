import React, { useCallback, useEffect, useRef, useState } from 'react'
import './Splitter.css'

interface SplitterProps {
  onResize: (delta: number) => void
  direction: 'vertical' | 'horizontal'
}

function Splitter({ onResize, direction }: SplitterProps): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const lastPos = useRef<number>(0)
  // Store onResize in a ref so useEffect doesn't re-register listeners when callback identity changes
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setDragging(true)
      lastPos.current = direction === 'vertical' ? e.clientX : e.clientY
    },
    [direction]
  )

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent): void => {
      const currentPos = direction === 'vertical' ? e.clientX : e.clientY
      const delta = currentPos - lastPos.current
      lastPos.current = currentPos
      onResizeRef.current(delta)
    }

    const handleMouseUp = (): void => {
      setDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, direction])

  return (
    <div
      className={`splitter splitter--${direction}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation={direction === 'vertical' ? 'vertical' : 'horizontal'}
      onMouseDown={handleMouseDown}
    />
  )
}

export default Splitter
