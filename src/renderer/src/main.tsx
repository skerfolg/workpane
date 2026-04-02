// Startup timeline — must be first line
const __rendererStart = performance.now()
;(window as any).__rendererStart = __rendererStart
console.log(`[TIMELINE] 0ms — renderer JS entry`)

import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/global.css'
import './i18n'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

console.log(`[TIMELINE] ${(performance.now() - __rendererStart).toFixed(0)}ms — imports resolved`)

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

console.log(`[TIMELINE] ${(performance.now() - __rendererStart).toFixed(0)}ms — React.createRoot`)
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

// Measure when first paint / interactive
requestAnimationFrame(() => {
  console.log(`[TIMELINE] ${(performance.now() - __rendererStart).toFixed(0)}ms — first rAF (first paint)`)
  requestAnimationFrame(() => {
    console.log(`[TIMELINE] ${(performance.now() - __rendererStart).toFixed(0)}ms — second rAF (interactive)`)
  })
})
