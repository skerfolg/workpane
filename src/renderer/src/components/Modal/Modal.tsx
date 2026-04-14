import React, { useEffect, useRef } from 'react'
import './Modal.css'

export interface ModalButton {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  buttons?: ModalButton[]
  width?: number
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  buttons,
  width = 400
}: ModalProps): React.JSX.Element | null {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleOverlayClick = (e: React.MouseEvent): void => {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="modal" style={{ width }}>
        <div className="modal__header">
          <span id="modal-title" className="modal__title">{title}</span>
          <button className="modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal__body">{children}</div>
        {buttons && buttons.length > 0 && (
          <div className="modal__footer">
            {buttons.map((btn, idx) => (
              <button
                key={idx}
                className={`modal__btn modal__btn--${btn.variant ?? 'secondary'}`}
                onClick={btn.onClick}
                disabled={btn.disabled}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Modal
