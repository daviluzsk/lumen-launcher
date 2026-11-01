import { app } from 'electron'
import { existsSync } from 'fs'
import path from 'path'

// Data layout follows Prism Launcher (libraries/, assets/, meta/, java/, icons/),
// which keeps maven-style library paths that ForgeWrapper relies on.
const root = path.join(app.getPath('appData'), 'PrismaLauncher')

export const paths = {
  root,
  libraries: path.join(root, 'libraries'),
  assets: path.join(root, 'assets'),
  meta: path.join(root, 'meta'),
  java: path.join(root, 'java'),
  icons: path.join(root, 'icons'),
  cache: path.join(root, 'cache'),
  logs: path.join(root, 'logs'),
  defaultInstances: path.join(root, 'instances'),
  servers: path.join(root, 'servers'),
  settings: path.join(root, 'prisma.json'),
  accounts: path.join(root, 'accounts.json')
}

/**
 * Optionally reuse Prism Launcher's libraries/ and assets/ (same maven/hash layout),
 * so both launchers share one copy of the game files.
 */
export function applySharedCache(enabled: boolean): void {
  const prism = enabled ? prismDataDir() : null
  paths.libraries = prism ? path.join(prism, 'libraries') : path.join(root, 'libraries')
  paths.assets = prism ? path.join(prism, 'assets') : path.join(root, 'assets')
}

/** Prism Launcher's own data dir, if installed — used to offer importing/sharing its instances. */
export function prismDataDir(): string | null {
  const candidates = [
    path.join(app.getPath('appData'), 'PrismLauncher'),
    path.join(app.getPath('appData'), 'PolyMC'),
    path.join(app.getPath('appData'), 'MultiMC')
  ]
  return candidates.find((p) => existsSync(path.join(p, 'instances'))) ?? null
}
