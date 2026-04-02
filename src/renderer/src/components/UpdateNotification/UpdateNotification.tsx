import { useState, useEffect, useCallback } from 'react'
import './UpdateNotification.css'

interface UpdateInfo {
  version: string
  releaseNotes?: string
}

type UpdateState = 'idle' | 'available' | 'downloading' | 'ready' | 'error'

export default function UpdateNotification(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState>('idle')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.updater.onUpdateAvailable((raw) => {
      const updateInfo = raw as UpdateInfo
      setInfo(updateInfo)
      setState('available')
      setDismissed(false)
    })

    window.updater.onDownloadProgress((raw) => {
      const p = raw as { percent: number }
      setProgress(Math.round(p.percent))
    })

    window.updater.onUpdateDownloaded(() => {
      setState('ready')
    })

    window.updater.onUpdateError((err) => {
      const msg = typeof err === 'string' ? err : (err as Error)?.message ?? 'Update failed'
      setErrorMsg(msg)
      setState('error')
    })
  }, [])

  const handleDownload = useCallback(() => {
    setState('downloading')
    setProgress(0)
    window.updater.download()
  }, [])

  const handleInstall = useCallback(() => {
    window.updater.install()
  }, [])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  if (dismissed || state === 'idle') return null

  return (
    <div className="update-notification">
      {state === 'available' && (
        <>
          <span className="update-notification__text">
            v{info?.version} available
          </span>
          <button className="update-notification__btn update-notification__btn--primary" onClick={handleDownload}>
            Update
          </button>
          <button className="update-notification__btn update-notification__btn--dismiss" onClick={handleDismiss}>
            Later
          </button>
        </>
      )}

      {state === 'downloading' && (
        <>
          <span className="update-notification__text">
            Downloading... {progress}%
          </span>
          <div className="update-notification__progress">
            <div className="update-notification__progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </>
      )}

      {state === 'ready' && (
        <>
          <span className="update-notification__text">
            Update ready
          </span>
          <button className="update-notification__btn update-notification__btn--primary" onClick={handleInstall}>
            Restart
          </button>
          <button className="update-notification__btn update-notification__btn--dismiss" onClick={handleDismiss}>
            Later
          </button>
        </>
      )}

      {state === 'error' && (
        <>
          <span className="update-notification__text update-notification__text--error">
            Update failed: {errorMsg}
          </span>
          <button className="update-notification__btn update-notification__btn--dismiss" onClick={handleDismiss}>
            Dismiss
          </button>
        </>
      )}
    </div>
  )
}
