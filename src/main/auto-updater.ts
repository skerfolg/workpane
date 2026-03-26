import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

export function initAutoUpdater(win: BrowserWindow): void {
  if (is.dev) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('updater:update-available', info)
  })

  autoUpdater.on('update-not-available', () => {
    // No action needed
  })

  autoUpdater.on('error', (err) => {
    win.webContents.send('updater:error', err.message)
  })

  autoUpdater.checkForUpdates()
}
