import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/global.css'
import './i18n'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

// --- Global error handlers for renderer diagnostics ---
window.addEventListener('error', (event) => {
  console.error(`[DEBUG][Renderer] Uncaught error: ${event.message}`, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error
  })
})

window.addEventListener('unhandledrejection', (event) => {
  console.error(`[DEBUG][Renderer] Unhandled promise rejection:`, event.reason)
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
