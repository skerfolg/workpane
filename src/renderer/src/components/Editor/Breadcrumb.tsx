import React from 'react'
import './Breadcrumb.css'

interface BreadcrumbProps {
  filePath: string
}

function Breadcrumb({ filePath }: BreadcrumbProps): React.JSX.Element {
  // Normalize separators and split into segments
  const normalized = filePath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)

  return (
    <div className="breadcrumb" aria-label="파일 경로">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1
        return (
          <React.Fragment key={index}>
            <span className={`breadcrumb__segment${isLast ? ' breadcrumb__segment--last' : ''}`}>
              {segment}
            </span>
            {!isLast && <span className="breadcrumb__separator">›</span>}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default Breadcrumb
