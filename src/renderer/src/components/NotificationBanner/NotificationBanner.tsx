import React from 'react'
import './NotificationBanner.css'
import type { NotificationItem } from '../../contexts/NotificationContext'

interface NotificationBannerProps {
  notifications: NotificationItem[]
  onClickNotification: (notification: NotificationItem) => void
  onDismiss: (id: string) => void
}

export default function NotificationBanner({
  notifications,
  onClickNotification,
  onDismiss
}: NotificationBannerProps): React.JSX.Element | null {
  if (notifications.length === 0) return null

  return (
    <div className="notification-banner-container">
      {notifications.map((n) => (
        <div
          key={n.id}
          className="notification-banner"
          role="alert"
          aria-live="polite"
        >
          <button
            className="notification-banner__body"
            onClick={() => onClickNotification(n)}
            title={`Go to ${n.workspaceName}`}
          >
            <div className="notification-banner__text">
              <span className="notification-banner__title">Action required</span>
              <span className="notification-banner__detail">
                {n.analysisSummary || n.matchedText || n.patternName}
              </span>
              <span className="notification-banner__workspace">{n.workspaceName}</span>
            </div>
          </button>
          <button
            className="notification-banner__dismiss"
            onClick={() => onDismiss(n.id)}
            aria-label="Dismiss notification"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  )
}
