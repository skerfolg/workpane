import { webContents, WebContents } from 'electron'

interface BrowserInstance {
  id: string
  webContentsId: number
  consoleLogs: Array<{ level: string; message: string; timestamp: number }>
}

export class BrowserManager {
  private browsers: Map<string, BrowserInstance> = new Map()
  private readonly MAX_CONSOLE_LOGS = 500

  register(id: string, webContentsId: number): void {
    this.browsers.set(id, { id, webContentsId, consoleLogs: [] })
  }

  unregister(id: string): void {
    this.browsers.delete(id)
  }

  getWebContents(id: string): WebContents | null {
    const instance = this.browsers.get(id)
    if (!instance) return null
    return webContents.fromId(instance.webContentsId) ?? null
  }

  async navigate(id: string, url: string): Promise<void> {
    const wc = this.getWebContents(id)
    if (!wc) throw new Error(`Browser ${id} not found`)
    if (!url.match(/^https?:\/\//)) {
      url = 'https://' + url
    }
    await wc.loadURL(url)
  }

  goBack(id: string): void {
    this.getWebContents(id)?.goBack()
  }

  goForward(id: string): void {
    this.getWebContents(id)?.goForward()
  }

  reload(id: string): void {
    this.getWebContents(id)?.reload()
  }

  toggleDevTools(id: string): void {
    const wc = this.getWebContents(id)
    if (!wc) return
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools()
    } else {
      wc.openDevTools({ mode: 'detach' })
    }
  }

  async executeJavaScript(id: string, script: string): Promise<unknown> {
    const wc = this.getWebContents(id)
    if (!wc) throw new Error(`Browser ${id} not found`)
    return wc.executeJavaScript(script)
  }

  async captureScreenshot(id: string): Promise<string> {
    const wc = this.getWebContents(id)
    if (!wc) throw new Error(`Browser ${id} not found`)
    const image = await wc.capturePage()
    return image.toPNG().toString('base64')
  }

  appendConsoleLog(id: string, level: string, message: string): void {
    const instance = this.browsers.get(id)
    if (!instance) return
    instance.consoleLogs.push({ level, message, timestamp: Date.now() })
    if (instance.consoleLogs.length > this.MAX_CONSOLE_LOGS) {
      instance.consoleLogs = instance.consoleLogs.slice(-this.MAX_CONSOLE_LOGS)
    }
  }

  getConsoleLogs(id: string): Array<{ level: string; message: string; timestamp: number }> {
    const instance = this.browsers.get(id)
    if (!instance) return []
    const logs = [...instance.consoleLogs]
    instance.consoleLogs = []
    return logs
  }

  getAll(): string[] {
    return Array.from(this.browsers.keys())
  }

  close(id: string): void {
    this.unregister(id)
  }

  disposeAll(): void {
    this.browsers.clear()
  }
}
