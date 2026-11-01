// Auto-update via electron-updater, pulling from the GitHub Releases feed configured in
// package.json ("publish"). Downloads in the background and installs on quit; the renderer
// shows progress and a "restart to update" prompt.

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@shared/types'

const { autoUpdater } = electronUpdater

let current: UpdateState = { state: 'idle' }
export const getUpdateState = (): UpdateState => current

export function initUpdater(emit: (s: UpdateState) => void): void {
  const set = (s: UpdateState): void => {
    current = s
    emit(s)
  }
  if (!app.isPackaged) {
    set({ state: 'disabled' })
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent), version: current.version }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => set({ state: 'error', message: e instanceof Error ? e.message : String(e) }))

  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 4000)
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), 6 * 60 * 60 * 1000)
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  if (current.state === 'downloading' || current.state === 'ready') return
  await autoUpdater.checkForUpdates().catch((e: Error) => {
    current = { state: 'error', message: e.message }
  })
}

export function installUpdate(): void {
  if (current.state === 'ready') autoUpdater.quitAndInstall()
}
