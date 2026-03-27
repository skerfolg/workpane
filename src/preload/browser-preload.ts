// Minimal preload for <webview> — no node access, no contextBridge needed
// This file runs inside the webview's isolated renderer process
// Keep it minimal for security
console.log('[WorkPane Browser] preload loaded')
