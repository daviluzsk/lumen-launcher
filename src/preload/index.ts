import { contextBridge, ipcRenderer, webUtils } from 'electron'

const ALLOWED = /^(app|settings|instances|meta|game|tasks|content|accounts|java|mr|servers|cf|update|win):/

contextBridge.exposeInMainWorld('prisma', {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!ALLOWED.test(channel)) return Promise.reject(new Error(`Canal bloqueado: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel: string, cb: (...args: unknown[]) => void): () => void {
    if (!ALLOWED.test(channel)) return () => undefined
    const handler = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  /** Absolute path of a file dropped onto the window (File.path was removed from Electron). */
  pathFor(file: File): string {
    return webUtils.getPathForFile(file)
  }
})
