import React, { useEffect, useRef, useState, useCallback } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, X, Code } from 'lucide-react'
import { useTerminals } from '../../contexts/TerminalContext'
import './BrowserPanel.css'

// Augment the existing webview type to add missing attributes
declare global {
  namespace React {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX {
      interface IntrinsicElements {
        webview: {
          ref?: React.Ref<HTMLElement>
          src?: string
          partition?: string
          preload?: string
          webpreferences?: string
          allowpopups?: string
          className?: string
          style?: React.CSSProperties
          id?: string
        }
      }
    }
  }
}

interface BrowserPanelProps {
  id: string
  isActive: boolean
}

const DEFAULT_URL = 'about:blank'

export default function BrowserPanel({ id, isActive }: BrowserPanelProps): React.JSX.Element {
  const { updateBrowserState } = useTerminals()
  const webviewRef = useRef<HTMLElement>(null)

  const [inputUrl, setInputUrl] = useState(DEFAULT_URL)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [registered, setRegistered] = useState(false)

  // Register webview with main process after dom-ready
  useEffect(() => {
    const webview = webviewRef.current as (HTMLElement & { getWebContentsId?: () => number }) | null
    if (!webview) return

    const handleDomReady = () => {
      if (registered) return
      const webContentsId = webview.getWebContentsId?.()
      if (webContentsId != null && window.browser) {
        window.browser.register(id, webContentsId).then(() => {
          setRegistered(true)
        }).catch(() => {})
      }
    }

    webview.addEventListener('dom-ready', handleDomReady)
    return () => {
      webview.removeEventListener('dom-ready', handleDomReady)
    }
  }, [id, registered])

  // Listen to browser IPC events
  useEffect(() => {
    if (!window.browser) return

    const removeNavigated = window.browser.onNavigated((browserId, url) => {
      if (browserId !== id) return
      setInputUrl(url)
      updateBrowserState(id, { url })
    })

    const removeTitleUpdated = window.browser.onTitleUpdated((browserId, title) => {
      if (browserId !== id) return
      updateBrowserState(id, { title })
    })

    const removeLoadingChanged = window.browser.onLoadingChanged((browserId, loading) => {
      if (browserId !== id) return
      setIsLoading(loading)
      updateBrowserState(id, { isLoading: loading })
    })

    const removeNavStateChanged = window.browser.onNavigationStateChanged(
      (browserId, back, forward) => {
        if (browserId !== id) return
        setCanGoBack(back)
        setCanGoForward(forward)
        updateBrowserState(id, { canGoBack: back, canGoForward: forward })
      }
    )

    return () => {
      removeNavigated()
      removeTitleUpdated()
      removeLoadingChanged()
      removeNavStateChanged()
    }
  }, [id, updateBrowserState])

  // F12 DevTools shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return
      if (e.key === 'F12') {
        e.preventDefault()
        window.browser?.toggleDevTools(id)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [id, isActive])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.browser?.close(id)
    }
  }, [id])

  const handleUrlKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        window.browser?.navigate(id, inputUrl)
      }
    },
    [id, inputUrl]
  )

  const goBack = useCallback(() => {
    window.browser?.goBack(id)
  }, [id])

  const goForward = useCallback(() => {
    window.browser?.goForward(id)
  }, [id])

  const reload = useCallback(() => {
    if (isLoading) {
      // Stop loading by navigating to same URL; webview stop is not exposed
      // best effort: reload cancels pending load in most cases
    }
    window.browser?.reload(id)
  }, [id, isLoading])

  const toggleDevTools = useCallback(() => {
    window.browser?.toggleDevTools(id)
  }, [id])

  return (
    <div className="browser-panel">
      <div className="browser-toolbar">
        <button
          className="browser-nav-btn"
          onClick={goBack}
          disabled={!canGoBack}
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          className="browser-nav-btn"
          onClick={goForward}
          disabled={!canGoForward}
          title="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button
          className="browser-nav-btn"
          onClick={reload}
          title={isLoading ? 'Stop' : 'Reload'}
        >
          {isLoading ? <X size={14} /> : <RotateCw size={14} />}
        </button>
        <input
          className="browser-url-bar"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={handleUrlKeyDown}
          placeholder="Enter URL..."
          spellCheck={false}
        />
        <button
          className="browser-nav-btn"
          onClick={toggleDevTools}
          title="DevTools (F12)"
        >
          <Code size={14} />
        </button>
      </div>
      <webview
        ref={webviewRef}
        src={DEFAULT_URL}
        partition="persist:browser"
        className="browser-webview"
      />
    </div>
  )
}
