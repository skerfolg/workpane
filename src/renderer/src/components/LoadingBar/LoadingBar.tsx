import React from 'react'
import './LoadingBar.css'

interface LoadingBarProps {
  active: boolean
}

export default function LoadingBar({ active }: LoadingBarProps): React.JSX.Element | null {
  if (!active) return null

  return (
    <div className="loading-bar">
      <div className="loading-bar__indicator" />
    </div>
  )
}
