// "media://" protocol: lets the renderer show local images (icons, screenshots, world
// thumbnails, wallpapers) without exposing the whole filesystem.

import { net, protocol } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { paths, prismDataDir } from './paths'
import { getSettings } from './settings'
import { isInside } from './util/fsx'

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
}

export function mediaUrl(file: string): string {
  return `media://file/${encodeURIComponent(file)}`
}

const extraRoots = new Set<string>()
export function allowMediaRoot(dir: string): void {
  extraRoots.add(path.resolve(dir))
}

function allowed(file: string): boolean {
  const roots = [paths.root, getSettings().instancesDir, ...extraRoots]
  const prism = prismDataDir()
  if (prism) roots.push(prism)
  return roots.some((r) => isInside(file, path.resolve(r)))
}

export function handleMediaProtocol(): void {
  protocol.handle('media', (req) => {
    const url = new URL(req.url)
    const file = path.resolve(decodeURIComponent(url.pathname.replace(/^\//, '')))
    if (!allowed(file)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
