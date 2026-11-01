import { app } from 'electron'
import { EventEmitter } from 'events'
import { existsSync, readdirSync } from 'fs'
import os from 'os'
import { join } from 'path'
import type { Settings } from '@shared/types'
import { paths, prismDataDir } from './paths'
import { readJson, writeJson } from './util/fsx'

// Same public MSA client id that Prism Launcher's CMakeLists ships for its builds.
// Users can override it in Settings with their own Azure application.
export const PRISM_MSA_CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb'

const totalMb = Math.floor(os.totalmem() / 1024 / 1024)

/** Acrylic/Mica window backdrops need Windows 11 22H2 (build 22621) or newer. */
export const supportsMaterial = process.platform === 'win32' && Number(os.release().split('.')[2] ?? 0) >= 22621

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  windowMaterial: supportsMaterial ? 'acrylic' : 'wallpaper',
  accent: 'blue',
  wallpaper: 'sequoia',
  customWallpaper: null,
  refraction: true,
  reduceTransparency: false,
  animatedWallpaper: true,
  instancesDir: paths.defaultInstances,
  shareWithPrism: false,
  javaPath: '',
  autoJava: true,
  minMem: 512,
  maxMem: Math.min(4096, Math.max(1024, Math.floor(totalMb / 4 / 512) * 512)),
  jvmArgs: '',
  width: 1280,
  height: 720,
  maximized: false,
  onLaunch: 'keep',
  showConsoleOnLaunch: false,
  msaClientId: PRISM_MSA_CLIENT_ID,
  curseforgeApiKey: '',
  concurrentDownloads: 16,
  sort: 'lastPlayed',
  view: 'grid'
}

let current: Settings = { ...DEFAULT_SETTINGS }
export const settingsEvents = new EventEmitter()

export async function loadSettings(): Promise<Settings> {
  const firstRun = !existsSync(paths.settings)
  const stored = await readJson<Partial<Settings>>(paths.settings, {})
  current = { ...DEFAULT_SETTINGS, ...stored }
  if (!supportsMaterial) current.windowMaterial = 'wallpaper'
  // First run: if Lumen has no instances of its own but Prism Launcher is installed, use its
  // instances folder so the user's existing modpacks appear right away (and can be hosted).
  if (firstRun && !current.instancesDir.startsWith(prismDataDir() ?? '\0')) {
    const prism = prismDataDir()
    const lumenHasInstances = existsSync(paths.defaultInstances) && readdirSync(paths.defaultInstances).some((n) => existsSync(join(paths.defaultInstances, n, 'instance.cfg')))
    if (prism && !lumenHasInstances) {
      current.instancesDir = join(prism, 'instances')
      current.shareWithPrism = true
      await writeJson(paths.settings, current, 2)
    }
  }
  // Dev-only: browse another instances folder without persisting it.
  if (!app.isPackaged && process.env['PRISMA_DEV_INSTANCES']) current.instancesDir = process.env['PRISMA_DEV_INSTANCES']
  if (!app.isPackaged && process.env['PRISMA_DEV_MATERIAL']) current.windowMaterial = process.env['PRISMA_DEV_MATERIAL'] as Settings['windowMaterial']
  return current
}

export function getSettings(): Settings {
  return current
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  current = { ...current, ...patch }
  if (!current.msaClientId.trim()) current.msaClientId = PRISM_MSA_CLIENT_ID
  await writeJson(paths.settings, current, 2)
  settingsEvents.emit('changed', current)
  return current
}

export const totalMemoryMb = totalMb
