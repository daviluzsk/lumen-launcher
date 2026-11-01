// Mods, resource packs, shader packs, worlds and screenshots of an instance.

import { shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { gunzipSync } from 'zlib'
import type { ContentItem, ContentKind, Screenshot, WorldInfo } from '@shared/types'
import { mediaUrl } from '../media'
import { dirSize, ensureDir, exists, isInside } from '../util/fsx'
import { readEntries } from '../util/zip'
import { getInstance } from './instances'

const EXTS: Record<ContentKind, string[]> = {
  mods: ['.jar', '.zip', '.litemod'],
  resourcepacks: ['.zip'],
  shaderpacks: ['.zip']
}

type Meta = Pick<ContentItem, 'name' | 'version' | 'description' | 'authors' | 'iconUrl'>
const metaCache = new Map<string, Meta>()

const stripFormatting = (s: string): string => s.replace(/§./g, '').trim()

function textOf(component: unknown): string {
  if (typeof component === 'string') return component
  if (Array.isArray(component)) return component.map(textOf).join('')
  if (component && typeof component === 'object') {
    const c = component as { text?: string; extra?: unknown[]; translate?: string }
    return (c.text ?? c.translate ?? '') + (c.extra ? textOf(c.extra) : '')
  }
  return ''
}

function tomlValue(block: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(?:'''([\\s\\S]*?)'''|"""([\\s\\S]*?)"""|"((?:[^"\\\\]|\\\\.)*)"|'([^']*)')`, 'm')
  const m = block.match(re)
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim() : null
}

function lenientJson(buf: Buffer): unknown {
  const text = buf.toString('utf8').replace(/^﻿/, '')
  try {
    return JSON.parse(text)
  } catch {
    // Some mods ship raw newlines inside strings.
    return JSON.parse(text.replace(/[\r\n\t]+/g, ' '))
  }
}

const toDataUrl = (buf: Buffer | undefined): string | null =>
  buf && buf.length < 400_000 ? `data:image/png;base64,${buf.toString('base64')}` : null

async function readArchiveMeta(file: string, fallbackName: string): Promise<Meta> {
  const wanted = new Set(['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml', 'mcmod.info', 'META-INF/MANIFEST.MF', 'pack.mcmeta', 'pack.png'])
  const files = await readEntries(file, (n) => wanted.has(n))
  const meta: Meta = { name: fallbackName, version: null, description: null, authors: [], iconUrl: null }
  let iconPath: string | null = null

  const fabric = files.get('fabric.mod.json')
  const quilt = files.get('quilt.mod.json')
  const forge = files.get('META-INF/neoforge.mods.toml') ?? files.get('META-INF/mods.toml')
  const mcmod = files.get('mcmod.info')
  try {
    if (fabric) {
      const j = lenientJson(fabric) as { name?: string; id?: string; version?: string; description?: string; authors?: (string | { name: string })[]; icon?: string | Record<string, string> }
      meta.name = j.name ?? j.id ?? meta.name
      meta.version = j.version ?? null
      meta.description = j.description ?? null
      meta.authors = (j.authors ?? []).map((a) => (typeof a === 'string' ? a : a.name))
      iconPath = typeof j.icon === 'string' ? j.icon : j.icon ? Object.values(j.icon).pop() ?? null : null
    } else if (quilt) {
      const j = lenientJson(quilt) as { quilt_loader?: { id?: string; version?: string; metadata?: { name?: string; description?: string; contributors?: Record<string, string>; icon?: string | Record<string, string> } } }
      const md = j.quilt_loader?.metadata
      meta.name = md?.name ?? j.quilt_loader?.id ?? meta.name
      meta.version = j.quilt_loader?.version ?? null
      meta.description = md?.description ?? null
      meta.authors = Object.keys(md?.contributors ?? {})
      iconPath = typeof md?.icon === 'string' ? md.icon : md?.icon ? Object.values(md.icon).pop() ?? null : null
    } else if (forge) {
      const text = forge.toString('utf8')
      const block = text.split(/^\s*\[\[mods\]\]\s*$/m)[1]?.split(/^\s*\[/m)[0] ?? text
      meta.name = tomlValue(block, 'displayName') ?? tomlValue(block, 'modId') ?? meta.name
      meta.version = tomlValue(block, 'version')
      meta.description = tomlValue(block, 'description')
      const authors = tomlValue(block, 'authors') ?? tomlValue(text, 'authors')
      meta.authors = authors ? authors.split(/,\s*/) : []
      iconPath = tomlValue(block, 'logoFile') ?? tomlValue(text, 'logoFile')
      if (meta.version?.includes('${file.jarVersion}')) {
        const mf = files.get('META-INF/MANIFEST.MF')?.toString('utf8')
        meta.version = mf?.match(/^Implementation-Version:\s*(.+)$/m)?.[1]?.trim() ?? null
      }
    } else if (mcmod) {
      const j = lenientJson(mcmod) as { modList?: unknown[] } | unknown[]
      const first = (Array.isArray(j) ? j[0] : j.modList?.[0]) as { name?: string; version?: string; description?: string; authorList?: string[]; logoFile?: string } | undefined
      if (first) {
        meta.name = first.name ?? meta.name
        meta.version = first.version ?? null
        meta.description = first.description ?? null
        meta.authors = first.authorList ?? []
        iconPath = first.logoFile || null
      }
    } else if (files.get('pack.mcmeta')) {
      const j = lenientJson(files.get('pack.mcmeta')!) as { pack?: { description?: unknown } }
      meta.description = stripFormatting(textOf(j.pack?.description)) || null
      meta.iconUrl = toDataUrl(files.get('pack.png'))
    }
  } catch {
    /* unreadable metadata — keep the file name */
  }

  if (iconPath) {
    const clean = iconPath.replace(/^\.?\//, '')
    const icon = await readEntries(file, (n) => n === clean).catch(() => new Map<string, Buffer>())
    meta.iconUrl = toDataUrl(icon.get(clean))
  }
  return meta
}

async function readFolderMeta(dir: string, fallbackName: string): Promise<Meta> {
  const meta: Meta = { name: fallbackName, version: null, description: null, authors: [], iconUrl: null }
  try {
    const j = JSON.parse(await fs.readFile(path.join(dir, 'pack.mcmeta'), 'utf8')) as { pack?: { description?: unknown } }
    meta.description = stripFormatting(textOf(j.pack?.description)) || null
  } catch {
    /* no metadata */
  }
  if (await exists(path.join(dir, 'pack.png'))) meta.iconUrl = mediaUrl(path.join(dir, 'pack.png'))
  return meta
}

export async function contentDir(id: string, kind: ContentKind): Promise<string> {
  return path.join((await getInstance(id)).gameDir, kind)
}

/** filename → Modrinth project id, read from Prism/packwiz style mods/.index/*.pw.toml. */
export async function readModIndex(dir: string): Promise<Map<string, { projectId: string; toml: string }>> {
  const map = new Map<string, { projectId: string; toml: string }>()
  const idx = path.join(dir, '.index')
  let files: string[] = []
  try {
    files = (await fs.readdir(idx)).filter((f) => f.endsWith('.pw.toml'))
  } catch {
    return map
  }
  for (const f of files) {
    const text = await fs.readFile(path.join(idx, f), 'utf8').catch(() => '')
    const filename = tomlValue(text, 'filename')
    const projectId = text.match(/\[update\.modrinth\][^[]*?mod-id\s*=\s*"([^"]+)"/)?.[1]
    if (filename && projectId) map.set(filename, { projectId, toml: path.join(idx, f) })
  }
  return map
}

export async function listContent(id: string, kind: ContentKind): Promise<ContentItem[]> {
  const dir = await contentDir(id, kind)
  await ensureDir(dir)
  const index = await readModIndex(dir)
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const items = await Promise.all(
    entries.map(async (e): Promise<ContentItem | null> => {
      const enabled = !e.name.endsWith('.disabled')
      const base = enabled ? e.name : e.name.slice(0, -'.disabled'.length)
      const full = path.join(dir, e.name)
      const isDir = e.isDirectory()
      if (isDir && kind === 'mods') return null
      if (!isDir && !EXTS[kind].includes(path.extname(base).toLowerCase())) return null
      if (e.name.startsWith('.')) return null
      const st = await fs.stat(full)
      const key = `${full}|${st.size}|${st.mtimeMs}`
      let meta = metaCache.get(key)
      if (!meta) {
        const fallback = base.replace(/\.(jar|zip|litemod)$/i, '')
        meta = isDir ? await readFolderMeta(full, fallback) : await readArchiveMeta(full, fallback).catch(() => ({ name: fallback, version: null, description: null, authors: [], iconUrl: null }))
        metaCache.set(key, meta)
      }
      return { file: e.name, kind, enabled, size: st.size, mtime: st.mtimeMs, modrinthId: index.get(base)?.projectId ?? null, ...meta }
    })
  )
  return items.filter((i): i is ContentItem => !!i).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

function within(dir: string, file: string): string {
  const full = path.join(dir, file)
  if (!isInside(full, dir)) throw new Error('Caminho inválido')
  return full
}

export async function toggleContent(id: string, kind: ContentKind, file: string, enabled: boolean): Promise<void> {
  const dir = await contentDir(id, kind)
  const full = within(dir, file)
  const isDisabled = file.endsWith('.disabled')
  if (enabled && isDisabled) await fs.rename(full, full.slice(0, -'.disabled'.length))
  if (!enabled && !isDisabled) await fs.rename(full, `${full}.disabled`)
}

export async function removeContent(id: string, kind: ContentKind, files: string[]): Promise<void> {
  const dir = await contentDir(id, kind)
  const index = await readModIndex(dir)
  for (const f of files) {
    await shell.trashItem(within(dir, f))
    const meta = index.get(f.replace(/\.disabled$/, ''))
    if (meta) await fs.rm(meta.toml, { force: true })
  }
}

export async function addContentFiles(id: string, kind: ContentKind, sources: string[]): Promise<number> {
  const dir = await contentDir(id, kind)
  await ensureDir(dir)
  let n = 0
  for (const src of sources) {
    const st = await fs.stat(src)
    const dest = path.join(dir, path.basename(src))
    if (st.isDirectory()) {
      if (kind === 'mods') continue
      await fs.cp(src, dest, { recursive: true })
    } else {
      if (!EXTS[kind].includes(path.extname(src).toLowerCase())) continue
      await fs.copyFile(src, dest)
    }
    n++
  }
  return n
}

/** Pulls a named TAG_String / TAG_Long out of uncompressed NBT without a full parser. */
function nbtString(buf: Buffer, name: string): string | null {
  const needle = Buffer.concat([Buffer.from([8, 0, name.length]), Buffer.from(name)])
  const at = buf.indexOf(needle)
  if (at < 0) return null
  const len = buf.readUInt16BE(at + needle.length)
  return buf.toString('utf8', at + needle.length + 2, at + needle.length + 2 + len)
}

function nbtLong(buf: Buffer, name: string): number | null {
  const needle = Buffer.concat([Buffer.from([4, 0, name.length]), Buffer.from(name)])
  const at = buf.indexOf(needle)
  return at < 0 ? null : Number(buf.readBigInt64BE(at + needle.length))
}

export async function listWorlds(id: string): Promise<WorldInfo[]> {
  const saves = path.join((await getInstance(id)).gameDir, 'saves')
  let entries: import('fs').Dirent[] = []
  try {
    entries = (await fs.readdir(saves, { withFileTypes: true })).filter((e) => e.isDirectory())
  } catch {
    return []
  }
  const worlds = await Promise.all(
    entries.map(async (e): Promise<WorldInfo | null> => {
      const dir = path.join(saves, e.name)
      const levelDat = path.join(dir, 'level.dat')
      if (!(await exists(levelDat))) return null
      let name = e.name
      let lastPlayed = (await fs.stat(levelDat)).mtimeMs
      try {
        const nbt = gunzipSync(await fs.readFile(levelDat))
        name = nbtString(nbt, 'LevelName') || name
        lastPlayed = nbtLong(nbt, 'LastPlayed') || lastPlayed
      } catch {
        /* corrupt or uncompressed level.dat */
      }
      const icon = path.join(dir, 'icon.png')
      return { folder: e.name, name, lastPlayed, size: await dirSize(dir, 5000), iconUrl: (await exists(icon)) ? mediaUrl(icon) : null }
    })
  )
  return worlds.filter((w): w is WorldInfo => !!w).sort((a, b) => b.lastPlayed - a.lastPlayed)
}

export async function deleteWorld(id: string, folder: string): Promise<void> {
  const saves = path.join((await getInstance(id)).gameDir, 'saves')
  await shell.trashItem(within(saves, folder))
}

export async function listScreenshots(id: string): Promise<Screenshot[]> {
  const dir = path.join((await getInstance(id)).gameDir, 'screenshots')
  let files: string[] = []
  try {
    files = (await fs.readdir(dir)).filter((f) => /\.(png|jpe?g)$/i.test(f))
  } catch {
    return []
  }
  const shots = await Promise.all(
    files.map(async (f) => {
      const full = path.join(dir, f)
      return { file: f, url: mediaUrl(full), mtime: (await fs.stat(full)).mtimeMs }
    })
  )
  return shots.sort((a, b) => b.mtime - a.mtime)
}

export async function deleteScreenshot(id: string, file: string): Promise<void> {
  const dir = path.join((await getInstance(id)).gameDir, 'screenshots')
  await shell.trashItem(within(dir, file))
}
