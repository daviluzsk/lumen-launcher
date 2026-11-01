// Client for Prism Launcher's metadata server (meta.prismlauncher.org), which publishes
// pre-processed component files for Minecraft, LWJGL, Java runtimes and every mod loader.
// Files are cached under <data>/meta/<uid>/ exactly like Prism does.

import { promises as fs } from 'fs'
import path from 'path'
import type { MetaVersion, Requirement } from '@shared/types'
import { HttpError, request } from '../net/http'
import { paths } from '../paths'
import { hashString, writeFileAtomic } from '../util/fsx'

export const META_URL = 'https://meta.prismlauncher.org/v1/'

export interface Artifact {
  url: string
  sha1?: string
  size?: number
  path?: string
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; version?: string }
}

export interface Library {
  name: string
  url?: string
  downloads?: { artifact?: Artifact; classifiers?: Record<string, Artifact> }
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  rules?: Rule[]
  'MMC-hint'?: string
  'MMC-absoluteUrl'?: string
  'MMC-filename'?: string
}

export interface AssetIndexRef {
  id: string
  sha1: string
  size: number
  totalSize?: number
  url: string
}

export interface VersionFile {
  formatVersion: number
  uid: string
  version: string
  name: string
  order?: number
  type?: string
  mainClass?: string
  appletClass?: string
  minecraftArguments?: string
  '+tweakers'?: string[]
  '+traits'?: string[]
  '+jvmArgs'?: string[]
  '+agents'?: { name: string; argument?: string; downloads?: Library['downloads']; url?: string }[]
  libraries?: Library[]
  mavenFiles?: Library[]
  jarMods?: Library[]
  mainJar?: Library
  assetIndex?: AssetIndexRef
  compatibleJavaMajors?: number[]
  compatibleJavaName?: string
  requires?: Requirement[]
  conflicts?: Requirement[]
  volatile?: boolean
}

interface MetaIndex {
  uid: string
  name: string
  versions: (MetaVersion & { sha256?: string })[]
}

const indexCache = new Map<string, { at: number; data: MetaIndex }>()
const INDEX_TTL = 30 * 60 * 1000

async function fetchText(url: string): Promise<string> {
  const res = await request(url)
  if (!res.ok) throw new HttpError(res.status, url, '')
  return res.text()
}

export async function getIndex(uid: string, force = false): Promise<MetaIndex> {
  const cached = indexCache.get(uid)
  if (!force && cached && Date.now() - cached.at < INDEX_TTL) return cached.data
  const file = path.join(paths.meta, uid, 'index.json')
  try {
    const text = await fetchText(`${META_URL}${uid}/index.json`)
    const data = JSON.parse(text) as MetaIndex
    await writeFileAtomic(file, text)
    indexCache.set(uid, { at: Date.now(), data })
    return data
  } catch (e) {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8')) as MetaIndex
      indexCache.set(uid, { at: Date.now() - INDEX_TTL + 60_000, data })
      return data
    } catch {
      throw new Error(`Não foi possível carregar a lista de versões de ${uid}: ${(e as Error).message}`)
    }
  }
}

export async function getVersionFile(uid: string, version: string): Promise<VersionFile> {
  const file = path.join(paths.meta, uid, `${version}.json`)
  let local: string | null = null
  try {
    local = await fs.readFile(file, 'utf8')
  } catch {
    /* not cached */
  }
  if (local) {
    try {
      const entry = (await getIndex(uid)).versions.find((v) => v.version === version)
      if (!entry?.sha256 || hashString(local, 'sha256') === entry.sha256) return JSON.parse(local)
    } catch {
      return JSON.parse(local)
    }
  }
  try {
    const text = await fetchText(`${META_URL}${uid}/${encodeURIComponent(version)}.json`)
    await writeFileAtomic(file, text)
    return JSON.parse(text)
  } catch (e) {
    if (local) return JSON.parse(local)
    throw new Error(`Não foi possível baixar ${uid} ${version}: ${(e as Error).message}`)
  }
}

export async function listVersions(uid: string, force = false): Promise<MetaVersion[]> {
  const idx = await getIndex(uid, force)
  return idx.versions.map(({ version, type, releaseTime, recommended, requires }) => ({ version, type, releaseTime, recommended, requires }))
}

/** Loader versions compatible with a Minecraft version, newest first. */
export async function listLoaderVersions(uid: string, mcVersion: string): Promise<MetaVersion[]> {
  const all = await listVersions(uid)
  return all.filter((v) => {
    const mc = v.requires?.find((r) => r.uid === 'net.minecraft')
    return !mc || mc.equals === mcVersion
  })
}
