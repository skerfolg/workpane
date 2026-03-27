import { BrowserWindow } from 'electron'
import { BrowserManager } from './browser-manager'

function validateUrl(url: string): void {
  if (!url.match(/^https?:\/\//)) {
    throw new Error(`Invalid URL protocol. Only http/https allowed: ${url}`)
  }
}

function validateSelector(selector: string): void {
  if (selector.length > 500) {
    throw new Error('Selector too long (max 500 characters)')
  }
}

export class McpBrowserHandler {
  private browserManager: BrowserManager
  private mainWindow: BrowserWindow | null = null

  constructor(browserManager: BrowserManager) {
    this.browserManager = browserManager
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async handleRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'browser.open': {
        const { url } = params as { url?: string }
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
          throw new Error('Main window not available')
        }
        const targetUrl = url || 'about:blank'
        if (targetUrl !== 'about:blank') {
          validateUrl(targetUrl)
        }
        const id = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        this.mainWindow.webContents.send('browser:open-requested', { id, url: targetUrl })
        return { id, url: targetUrl }
      }

      case 'browser.navigate': {
        const { id, url } = params as { id: string; url: string }
        if (!id) throw new Error('Missing required param: id')
        if (!url) throw new Error('Missing required param: url')
        validateUrl(url)
        await this.browserManager.navigate(id, url)
        return { ok: true }
      }

      case 'browser.click': {
        const { id, selector } = params as { id: string; selector: string }
        if (!id) throw new Error('Missing required param: id')
        if (!selector) throw new Error('Missing required param: selector')
        validateSelector(selector)
        const script = `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
          el.click();
          return true;
        })()`
        await this.browserManager.executeJavaScript(id, script)
        return { ok: true }
      }

      case 'browser.fill': {
        const { id, selector, value } = params as { id: string; selector: string; value: string }
        if (!id) throw new Error('Missing required param: id')
        if (!selector) throw new Error('Missing required param: selector')
        if (value === undefined || value === null) throw new Error('Missing required param: value')
        validateSelector(selector)
        const script = `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`
        await this.browserManager.executeJavaScript(id, script)
        return { ok: true }
      }

      case 'browser.screenshot': {
        const { id } = params as { id: string }
        if (!id) throw new Error('Missing required param: id')
        const base64 = await this.browserManager.captureScreenshot(id)
        return { image: base64, format: 'png' }
      }

      case 'browser.console': {
        const { id } = params as { id: string }
        if (!id) throw new Error('Missing required param: id')
        const logs = this.browserManager.getConsoleLogs(id)
        return { logs }
      }

      case 'browser.close': {
        const { id } = params as { id: string }
        if (!id) throw new Error('Missing required param: id')
        this.browserManager.close(id)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('browser:close-requested', { id })
        }
        return { ok: true }
      }

      default:
        return null
    }
  }
}
