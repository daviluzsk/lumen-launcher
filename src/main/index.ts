import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { type ContentKind, type InstancePatch, type LoaderId, LOADER_UIDS, type MrSearchQuery, type NewInstanceRequest, type NewServerRequest, type ServerPatch, type Settings } from '@shared/types'
import { accountEvents, addOffline, cancelLogin, listAccounts, loginMicrosoft, refreshAccount, removeAccount, setActive } from './auth/accounts'
import { addContentFiles, deleteScreenshot, deleteWorld, listContent, listScreenshots, listWorlds, removeContent, toggleContent } from './instances/content'
import {
  changeVersion,
  createInstance,
  deleteInstance,
  duplicateInstance,
  getInstance,
  instanceEvents,
  listGroups,
  listInstances,
  renameGroup,
  setInstanceIcon,
  updateInstance,
  watchInstances
} from './instances/instances'
import { checkJava, detectJava, downloadJava } from './java/java'
import { allowMediaRoot, handleMediaProtocol, mediaUrl, registerMediaScheme } from './media'
import { gameEvents, gameLogs, gameStates, killGame, launchInstance } from './minecraft/launch'
import { listLoaderVersions, listVersions } from './minecraft/meta'
import { getProject, getVersions, importArchive, installModpack, installVersion, search } from './modrinth/modrinth'
import { folderHasMeta, getModpackFiles, importFolder, importFromInput, importFromProject, importFromZip, isCurseforgeZip, resolveModpack, searchModpacks } from './curseforge/curseforge'
import { acceptEula, createServer, deleteServer, getServer, listServers, loaderVersionsForServer, netInfo, serverEvents, updateServer } from './servers/servers'
import { isServerBusy, killAllServers, sendCommand, serverLogs, serverRunEvents, serverStates, startServer, stopServer } from './servers/run'
import { applySharedCache, paths, prismDataDir } from './paths'
import { getSettings, loadSettings, settingsEvents, supportsMaterial, totalMemoryMb, updateSettings } from './settings'
import { checkForUpdates, getUpdateState, initUpdater, installUpdate } from './updater'
import { listTasks, runTask, taskEvents } from './tasks'
import { ensureDir, safeFileName } from './util/fsx'

registerMediaScheme()
app.setPath('userData', path.join(paths.root, 'electron'))

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
const capture = app.isPackaged ? undefined : process.argv.find((a) => a.startsWith('--capture='))?.slice('--capture='.length)
const route = process.argv.find((a) => a.startsWith('--route='))?.slice('--route='.length)

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

const materialOf = (s: Settings): 'acrylic' | 'mica' | 'none' => (s.windowMaterial === 'wallpaper' ? 'none' : s.windowMaterial)

function syncTheme(s: Settings): void {
  nativeTheme.themeSource = s.theme === 'auto' ? 'system' : s.theme
}

/** `--launch <instance id>` (used by desktop shortcuts) starts that instance right away. */
function launchFromArgs(argv: string[]): void {
  const i = argv.indexOf('--launch')
  const id = i >= 0 ? argv[i + 1] : undefined
  if (id) void launchInstance(id).catch((e) => console.error('launch', e))
}

function createWindow(): void {
  const s = getSettings()
  syncTheme(s)
  win = new BrowserWindow({
    width: 1160,
    height: 740,
    minWidth: 900,
    minHeight: 560,
    // Hidden (not removed) title bar keeps Windows' resize borders, snap layouts and shadow;
    // our own traffic lights replace the native buttons.
    titleBarStyle: 'hidden',
    backgroundMaterial: materialOf(s),
    show: false,
    backgroundColor: s.windowMaterial === 'wallpaper' ? '#0d0b1a' : '#00000000',
    title: 'Lumen',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => win?.show())
  win.on('maximize', () => send('win:maximized', true))
  win.on('unmaximize', () => send('win:maximized', false))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault()
  })

  const hash = route ? `#${route}` : ''
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + hash)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: route })

  if (capture) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}]`, e.message))
    // Dev helper: render the UI headlessly-ish and save a screenshot, then quit.
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage()
        await fs.writeFile(capture, img.toPNG())
        app.quit()
      }, Number(process.env['PRISMA_CAPTURE_DELAY'] ?? 3500))
    })
  }
}

type Handler = (...args: never[]) => unknown
const ipcLog = !app.isPackaged && process.env['PRISMA_DEV_IPCLOG'] === '1'

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    const t = Date.now()
    try {
      return await (fn as (...a: unknown[]) => unknown)(...args)
    } finally {
      if (ipcLog) console.log(`[ipc] ${channel} ${Date.now() - t}ms`)
    }
  })
}

async function loaderVersions(loader: LoaderId, mc: string): Promise<unknown> {
  if (loader === 'vanilla') return []
  const uid = LOADER_UIDS[loader]
  if (loader === 'fabric' || loader === 'quilt') {
    const inter = await listVersions('net.fabricmc.intermediary')
    if (!inter.some((v) => v.version === mc)) return []
    return listVersions(uid)
  }
  return listLoaderVersions(uid, mc)
}

function registerIpc(): void {
  // window / app
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: paths.root,
    prismDataDir: prismDataDir(),
    isMaximized: win?.isMaximized() ?? false,
    totalMemoryMb,
    supportsMaterial
  }))
  handle('app:minimize', () => win?.minimize())
  handle('app:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  handle('app:close', () => win?.close())
  handle('app:openExternal', (url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
  handle('app:openPath', (p: string) => shell.openPath(p))
  handle('app:pickFiles', async (opts: { title?: string; filters?: Electron.FileFilter[]; multi?: boolean }) => {
    const r = await dialog.showOpenDialog(win!, { title: opts.title, filters: opts.filters, properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'] })
    return r.canceled ? [] : r.filePaths
  })
  handle('app:pickFolder', async (title?: string) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('app:setWallpaper', async (file: string) => {
    const dir = await ensureDir(path.join(paths.root, 'wallpapers'))
    const dest = path.join(dir, `custom${path.extname(file).toLowerCase()}`)
    for (const f of await fs.readdir(dir)) await fs.rm(path.join(dir, f), { force: true })
    await fs.copyFile(file, dest)
    const url = `${mediaUrl(dest)}?v=${Date.now()}`
    await updateSettings({ customWallpaper: url, wallpaper: 'custom' })
    return url
  })

  // settings
  handle('settings:get', () => getSettings())
  handle('settings:set', async (patch: Partial<Settings>) => {
    const before = getSettings().instancesDir
    const beforeMaterial = getSettings().windowMaterial
    const s = await updateSettings(patch)
    applySharedCache(s.shareWithPrism)
    syncTheme(s)
    if (s.windowMaterial !== beforeMaterial && win) {
      win.setBackgroundColor(s.windowMaterial === 'wallpaper' ? '#0d0b1a' : '#00000000')
      win.setBackgroundMaterial(materialOf(s))
    }
    if (s.instancesDir !== before) {
      await ensureDir(s.instancesDir)
      allowMediaRoot(s.instancesDir)
      watchInstances()
      instanceEvents.emit('changed')
    }
    return s
  })

  // instances
  handle('instances:list', () => listInstances())
  handle('instances:get', (id: string) => getInstance(id))
  handle('instances:create', (req: NewInstanceRequest) => createInstance(req))
  handle('instances:update', (id: string, patch: InstancePatch) => updateInstance(id, patch))
  handle('instances:delete', (id: string) => deleteInstance(id))
  handle('instances:duplicate', (id: string) => runTask('Duplicando instância', () => duplicateInstance(id)))
  handle('instances:changeVersion', (id: string, mc: string, loader: LoaderId, lv: string | null) => changeVersion(id, mc, loader, lv))
  handle('instances:setIcon', (id: string, file: string) => setInstanceIcon(id, file))
  handle('instances:openFolder', async (id: string, sub?: string) => {
    const inst = await getInstance(id)
    const target = sub ? path.join(inst.gameDir, sub) : inst.dir
    await ensureDir(target)
    return shell.openPath(target)
  })
  handle('instances:shortcut', async (id: string) => {
    const inst = await getInstance(id)
    const file = path.join(app.getPath('desktop'), `${safeFileName(inst.name)}.lnk`)
    const args = [...(app.isPackaged ? [] : [`"${app.getAppPath()}"`]), '--launch', `"${inst.id}"`].join(' ')
    const ok = shell.writeShortcutLink(file, 'replace', { target: process.execPath, args, description: `Jogar ${inst.name} no Lumen`, cwd: path.dirname(process.execPath) })
    if (!ok) throw new Error('Não foi possível criar o atalho')
    return file
  })
  handle('instances:groups', () => listGroups())
  handle('instances:renameGroup', (from: string, to: string) => renameGroup(from, to))
  handle('instances:import', async (file: string) => {
    if (await isCurseforgeZip(file)) return { cf: await importFromZip(file) }
    return { instance: await importArchive(file) }
  })
  // curseforge
  handle('cf:search', (query: string, gameVersion: string | null, loader: LoaderId | null, offset?: number) => searchModpacks(query, gameVersion, loader, offset ?? 0))
  handle('cf:resolve', (input: string) => resolveModpack(input))
  handle('cf:files', (projectId: number) => getModpackFiles(projectId))
  handle('cf:import', (projectId: number, fileId: number | null) => importFromProject(projectId, fileId))
  handle('cf:importInput', (input: string) => importFromInput(input))
  handle('cf:importZip', (file: string) => importFromZip(file))
  handle('cf:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Pasta do modpack (do app CurseForge ou .minecraft)', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const dir = r.filePaths[0]
    const info = await folderHasMeta(dir)
    return { dir, ...info }
  })
  handle('cf:importFolder', (dir: string, override: { mcVersion: string; loader: LoaderId; loaderVersion: string | null; name?: string } | null) => importFolder(dir, override))

  // meta
  handle('meta:versions', (uid: string, force?: boolean) => listVersions(uid, force))
  handle('meta:loaderVersions', (loader: LoaderId, mc: string) => loaderVersions(loader, mc))

  // game
  handle('game:launch', (id: string) => launchInstance(id))
  handle('game:kill', (id: string) => killGame(id))
  handle('game:states', () => gameStates())
  handle('game:logs', (id: string) => gameLogs(id))
  handle('tasks:list', () => listTasks())

  // content
  handle('content:list', (id: string, kind: ContentKind) => listContent(id, kind))
  handle('content:toggle', (id: string, kind: ContentKind, file: string, enabled: boolean) => toggleContent(id, kind, file, enabled))
  handle('content:remove', (id: string, kind: ContentKind, files: string[]) => removeContent(id, kind, files))
  handle('content:add', (id: string, kind: ContentKind, files: string[]) => addContentFiles(id, kind, files))
  handle('content:worlds', (id: string) => listWorlds(id))
  handle('content:deleteWorld', (id: string, folder: string) => deleteWorld(id, folder))
  handle('content:screenshots', (id: string) => listScreenshots(id))
  handle('content:deleteScreenshot', (id: string, file: string) => deleteScreenshot(id, file))

  // accounts
  handle('accounts:list', () => listAccounts())
  handle('accounts:loginMsa', () => {
    void loginMicrosoft((e) => send('accounts:login', e))
  })
  handle('accounts:cancelLogin', () => cancelLogin())
  handle('accounts:addOffline', (name: string) => addOffline(name))
  handle('accounts:remove', (id: string) => removeAccount(id))
  handle('accounts:setActive', (id: string) => setActive(id))
  handle('accounts:refresh', (id: string) => refreshAccount(id))

  // java
  handle('java:list', (force?: boolean) => detectJava(force))
  handle('java:check', (p: string) => checkJava(p))
  handle('java:download', (major: number) => runTask(`Baixando Java ${major}`, (t) => downloadJava(major, undefined, t)))

  // modrinth
  handle('mr:search', (q: MrSearchQuery) => search(q))
  handle('mr:project', (id: string) => getProject(id))
  handle('mr:versions', (id: string, loaders?: string[], gameVersions?: string[]) => getVersions(id, loaders, gameVersions))
  handle('mr:install', (instanceId: string, versionId: string, kind: ContentKind) => installVersion(instanceId, versionId, kind))
  handle('mr:installModpack', (versionId: string, opts: { name?: string; group?: string | null }) => installModpack(versionId, opts))

  // servers (multiplayer)
  handle('servers:list', () => listServers())
  handle('servers:get', (id: string) => getServer(id))
  handle('servers:create', (req: NewServerRequest) => createServer(req))
  handle('servers:update', (id: string, patch: ServerPatch) => updateServer(id, patch))
  handle('servers:delete', (id: string) => deleteServer(id))
  handle('servers:loaderVersions', (loader: LoaderId, mc: string) => loaderVersionsForServer(loader, mc))
  handle('servers:start', (id: string) => startServer(id))
  handle('servers:stop', (id: string) => stopServer(id))
  handle('servers:command', (id: string, cmd: string) => sendCommand(id, cmd))
  handle('servers:acceptEula', (id: string) => acceptEula(id))
  handle('servers:states', () => serverStates())
  handle('servers:logs', (id: string) => serverLogs(id))
  handle('servers:busy', (id: string) => isServerBusy(id))
  handle('servers:net', () => netInfo())
  handle('servers:openFolder', async (id: string, sub?: string) => {
    const s = await getServer(id)
    const target = sub ? path.join(s.dir, sub) : s.dir
    await ensureDir(target)
    return shell.openPath(target)
  })

  instanceEvents.on('changed', () => send('instances:changed'))
  taskEvents.on('update', (t) => send('tasks:update', t))
  gameEvents.on('state', (s) => send('game:state', s))
  gameEvents.on('log', (id, lines) => send('game:log', id, lines))
  accountEvents.on('changed', () => send('accounts:changed'))
  settingsEvents.on('changed', (s) => send('settings:changed', s))
  serverEvents.on('changed', () => send('servers:changed'))
  serverRunEvents.on('state', (s) => send('servers:state', s))
  serverRunEvents.on('log', (id, lines) => send('servers:log', id, lines))

  // updates
  handle('update:state', () => getUpdateState())
  handle('update:check', () => checkForUpdates())
  handle('update:install', () => installUpdate())
}

app.on('second-instance', (_e, argv) => {
  launchFromArgs(argv)
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.whenReady().then(async () => {
  await ensureDir(paths.root)
  const s = await loadSettings()
  applySharedCache(s.shareWithPrism || process.env['PRISMA_SELFTEST_SHARE'] === '1')
  await ensureDir(s.instancesDir)
  allowMediaRoot(s.instancesDir)
  handleMediaProtocol()
  if (!app.isPackaged && process.env['PRISMA_SELFTEST']) {
    const { selfTest } = await import('./selftest')
    process.exitCode = (await selfTest()) ? 0 : 1
    app.quit()
    return
  }
  registerIpc()
  watchInstances()
  createWindow()
  initUpdater((s) => send('update:state', s))
  launchFromArgs(process.argv)
})

app.on('before-quit', () => killAllServers())
app.on('window-all-closed', () => app.quit())
