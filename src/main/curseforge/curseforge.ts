// CurseForge modpack import (by project id / slug / URL, or an exported .zip).
// Uses the official CurseForge API (api.curseforge.com), which needs a free API key the user
// creates at console.curseforge.com — stored in Settings. A CurseForge pack is a .zip whose
// manifest.json lists project+file ids; some authors block third‑party downloads, and those are
// reported back so the user can grab them by hand.

import { promises as fs } from 'fs'
import path from 'path'
import { type CfFile, type CfHit, type CfImportResult, type CfSearchResult, type LoaderId } from '@shared/types'
import { downloadAll, downloadFile, type DownloadItem } from '../net/download'
import { request } from '../net/http'
import { createInstance, instanceEvents } from '../instances/instances'
import { search as mrSearch, getVersions as mrVersions } from '../modrinth/modrinth'
import { paths } from '../paths'
import { getSettings } from '../settings'
import { runTask, type Task } from '../tasks'
import { ensureDir, exists, isInside } from '../util/fsx'
import { extract, readEntries } from '../util/zip'

const API = 'https://api.curseforge.com/v1'
const GAME_MINECRAFT = 432
const CLASS_MODPACK = 4471
const CLASS_RESOURCEPACK = 12
const CLASS_SHADER = 6552
const ALLOWED_HOSTS = ['edge.forgecdn.net', 'mediafilez.forgecdn.net', 'media.forgecdn.net', 'edge-service.overwolf.wtf']

// CurseForge modLoaderType → our loader id
const CF_LOADER: Record<number, LoaderId> = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' }

function key(): string {
  const k = getSettings().curseforgeApiKey.trim()
  if (!k) throw new Error('CF_KEY_REQUIRED')
  return k
}

async function cf<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
  const res = await request(`${API}${endpoint}`, { ...init, headers: { 'x-api-key': key(), Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as Record<string, string>) } }, 1)
  if (res.status === 403) throw new Error('Chave de API do CurseForge inválida ou sem permissão.')
  if (!res.ok) throw new Error(`CurseForge respondeu ${res.status}`)
  return (await res.json()) as T
}

interface CfModProject {
  id: number
  name: string
  slug: string
  summary: string
  classId: number
  downloadCount: number
  authors: { name: string }[]
  logo?: { url: string }
  categories?: { name: string }[]
  links?: { websiteUrl?: string }
  latestFilesIndexes?: { gameVersion: string }[]
}

interface CfFileObj {
  id: number
  modId: number
  displayName: string
  fileName: string
  releaseType: 1 | 2 | 3
  gameVersions: string[]
  fileDate: string
  downloadCount: number
  downloadUrl: string | null
  hashes?: { value: string; algo: number }[]
}

const toHit = (p: CfModProject): CfHit => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  summary: p.summary,
  logoUrl: p.logo?.url ?? null,
  downloadCount: p.downloadCount,
  author: p.authors?.[0]?.name ?? '',
  categories: (p.categories ?? []).map((c) => c.name),
  gameVersions: [...new Set((p.latestFilesIndexes ?? []).map((f) => f.gameVersion))]
})

export async function searchModpacks(query: string, gameVersion: string | null, loader: LoaderId | null, offset = 0): Promise<CfSearchResult> {
  const params = new URLSearchParams({ gameId: String(GAME_MINECRAFT), classId: String(CLASS_MODPACK), searchFilter: query, sortField: query ? '6' : '2', sortOrder: 'desc', pageSize: '30', index: String(offset) })
  if (gameVersion) params.set('gameVersion', gameVersion)
  const loaderType = loader ? Object.entries(CF_LOADER).find(([, v]) => v === loader)?.[0] : null
  if (loaderType) params.set('modLoaderType', loaderType)
  const res = await cf<{ data: CfModProject[]; pagination: { totalCount: number } }>(`/mods/search?${params}`)
  return { hits: res.data.map(toHit), totalCount: Math.min(res.pagination.totalCount, 10000) }
}

export async function getModpackFiles(projectId: number): Promise<CfFile[]> {
  const res = await cf<{ data: CfFileObj[] }>(`/mods/${projectId}/files?pageSize=50`)
  return res.data.map((f) => ({ id: f.id, displayName: f.displayName, fileName: f.fileName, releaseType: f.releaseType, gameVersions: f.gameVersions, fileDate: f.fileDate, downloadCount: f.downloadCount }))
}

/** Accepts a numeric id, a slug, or a curseforge.com modpack URL. */
export async function resolveModpack(input: string): Promise<CfHit> {
  const trimmed = input.trim()
  const idMatch = trimmed.match(/^\d+$/) ?? trimmed.match(/\/(\d{4,})\b/)
  if (idMatch) {
    const res = await cf<{ data: CfModProject }>(`/mods/${idMatch[1] ?? idMatch[0]}`)
    return toHit(res.data)
  }
  const slug = trimmed.match(/modpacks\/([a-z0-9-]+)/i)?.[1] ?? trimmed.replace(/^https?:\/\/\S+\//, '').replace(/\/.*$/, '')
  const res = await cf<{ data: CfModProject[] }>(`/mods/search?gameId=${GAME_MINECRAFT}&classId=${CLASS_MODPACK}&slug=${encodeURIComponent(slug)}`)
  const hit = res.data[0]
  if (!hit) throw new Error(`Modpack não encontrado: "${input}"`)
  return toHit(hit)
}

function parseLoader(manifest: CfManifest): { loader: LoaderId; version: string | null } {
  const primary = manifest.minecraft.modLoaders.find((l) => l.primary) ?? manifest.minecraft.modLoaders[0]
  if (!primary) return { loader: 'vanilla', version: null }
  const [name, ...rest] = primary.id.split('-')
  const version = rest.join('-') || null
  const map: Record<string, LoaderId> = { forge: 'forge', fabric: 'fabric', quilt: 'quilt', neoforge: 'neoforge' }
  return { loader: map[name] ?? 'vanilla', version }
}

interface CfManifest {
  minecraft: { version: string; modLoaders: { id: string; primary?: boolean }[] }
  manifestType?: string
  name: string
  version?: string
  author?: string
  files: { projectID: number; fileID: number; required?: boolean }[]
  overrides?: string
}

function folderForClass(classId: number | undefined, fileName: string): string {
  if (classId === CLASS_RESOURCEPACK) return 'resourcepacks'
  if (classId === CLASS_SHADER) return 'shaderpacks'
  if (!fileName.endsWith('.jar') && (fileName.endsWith('.zip') || fileName.endsWith('.zip.disabled'))) return 'resourcepacks'
  return 'mods'
}

/** POSTs in chunks because the CurseForge batch endpoints cap the body size. */
async function batch<T>(endpoint: string, idsField: string, ids: number[]): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const res = await cf<{ data: T[] }>(endpoint, { method: 'POST', body: JSON.stringify({ [idsField]: ids.slice(i, i + 200) }) })
    out.push(...res.data)
  }
  return out
}

async function buildFromManifest(zipPath: string, task: Task, managed: { id: number; name: string; versionName: string } | null, iconKey: string | null): Promise<CfImportResult> {
  task.update('Lendo manifest.json…', null)
  const entries = await readEntries(zipPath, (n) => n === 'manifest.json' || n.endsWith('/manifest.json'), 8 * 1024 * 1024)
  const raw = [...entries.values()][0]
  if (!raw) throw new Error('Arquivo do CurseForge inválido (sem manifest.json)')
  const manifest = JSON.parse(raw.toString('utf8')) as CfManifest
  const mc = manifest.minecraft.version
  const { loader, version } = parseLoader(manifest)

  task.update(`Criando instância (${loader} ${mc})…`, null)
  const extra: Record<string, string> = managed
    ? { ManagedPack: 'true', ManagedPackType: 'flame', ManagedPackID: String(managed.id), ManagedPackName: managed.name, ManagedPackVersionName: managed.versionName }
    : {}
  const inst = await createInstance({ name: manifest.name || 'Modpack CurseForge', group: null, iconKey: iconKey || 'glass:box', mcVersion: mc, loader, loaderVersion: version }, extra)

  // Resolve every file + project in two batch calls, then route and download.
  task.update('Consultando os mods…', null)
  const fileIds = manifest.files.map((f) => f.fileID)
  const projectIds = [...new Set(manifest.files.map((f) => f.projectID))]
  const [fileObjs, projects] = await Promise.all([batch<CfFileObj>('/mods/files', 'fileIds', fileIds), batch<CfModProject>('/mods', 'modIds', projectIds)])
  const projById = new Map(projects.map((p) => [p.id, p]))

  const items: DownloadItem[] = []
  const blocked: CfImportResult['blocked'] = []
  for (const obj of fileObjs) {
    const proj = projById.get(obj.modId)
    const folder = folderForClass(proj?.classId, obj.fileName)
    const target = path.join(inst.gameDir, folder, path.basename(obj.fileName))
    if (!isInside(target, inst.gameDir)) continue
    let url = obj.downloadUrl
    if (!url) {
      // Author disabled third‑party downloads → CF returns no URL. Try the explicit endpoint once.
      url = await cf<{ data: string | null }>(`/mods/${obj.modId}/files/${obj.id}/download-url`).then((r) => r.data).catch(() => null)
    }
    if (!url || !ALLOWED_HOSTS.includes(new URL(url).host)) {
      blocked.push({ name: proj?.name ?? obj.fileName, pageUrl: proj?.links?.websiteUrl ? `${proj.links.websiteUrl}/download/${obj.id}` : 'https://www.curseforge.com' })
      continue
    }
    const sha1 = obj.hashes?.find((h) => h.algo === 1)?.value
    items.push({ url, path: target, sha1 })
  }

  task.update(`Baixando ${items.length} arquivos…`, 0)
  await downloadAll(items, (p) => task.update(`Baixando mods (${p.done}/${p.total})`, p.total ? p.done / p.total : 1))

  task.update('Aplicando overrides…', null)
  const prefix = (manifest.overrides || 'overrides').replace(/\/?$/, '/')
  await extract(zipPath, inst.gameDir, (n) => (n.startsWith(prefix) && n.length > prefix.length ? n.slice(prefix.length) : null))

  instanceEvents.emit('changed')
  return { instanceId: inst.id, name: inst.name, blocked }
}

async function cacheIcon(url: string | null, id: number): Promise<string | null> {
  if (!url) return null
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase() || '.png'
    const kkey = `curseforge_${id}`
    await downloadFile(url, path.join(paths.icons, kkey + (['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png')))
    return kkey
  } catch {
    return null
  }
}

/** Import by a resolved project + chosen file id (or latest file). */
export async function importFromProject(projectId: number, fileId: number | null): Promise<CfImportResult> {
  return runTask('Importando modpack do CurseForge', async (task) => {
    const proj = (await cf<{ data: CfModProject }>(`/mods/${projectId}`)).data
    const files = await cf<{ data: CfFileObj[] }>(`/mods/${projectId}/files?pageSize=50`)
    const file = (fileId ? files.data.find((f) => f.id === fileId) : null) ?? files.data[0]
    if (!file) throw new Error('Este modpack não tem arquivos para baixar')
    const url = file.downloadUrl ?? (await cf<{ data: string | null }>(`/mods/${projectId}/files/${file.id}/download-url`).then((r) => r.data).catch(() => null))
    if (!url) throw new Error('O autor do modpack bloqueou o download por terceiros. Baixe o .zip no site do CurseForge e importe pelo arquivo.')
    const tmp = path.join(paths.cache, 'curseforge', `${file.id}.zip`)
    await ensureDir(path.dirname(tmp))
    task.update(`Baixando ${proj.name}…`, null)
    await downloadFile(url, tmp)
    const icon = await cacheIcon(proj.logo?.url ?? null, proj.id)
    try {
      return await buildFromManifest(tmp, task, { id: proj.id, name: proj.name, versionName: file.displayName }, icon)
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined)
    }
  })
}

export async function importFromInput(input: string): Promise<CfImportResult> {
  const hit = await resolveModpack(input)
  return importFromProject(hit.id, null)
}

/** Pulls "Name → CurseForge page" pairs out of a pack's modlist.html (present in every CF export). */
function parseModlist(html: string): { name: string; pageUrl: string }[] {
  const out: { name: string; pageUrl: string }[] = []
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const url = m[1]
    const name = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (name && /curseforge\.com/.test(url)) out.push({ name, pageUrl: url })
  }
  return out
}

const cleanName = (s: string): string =>
  s
    .replace(/\(by [^)]*\)/gi, '')
    .replace(/\((?:forge|fabric|neoforge|quilt)[^)]*\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const cfSlugOf = (url: string): string | null => url.match(/mc-mods\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() ?? null

// Token matching tolerates articles, "&", loader words and word order so "The Twilight Forest"
// matches Modrinth's "Twilight Forest" without matching unrelated mods.
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'mod', 'forge', 'fabric', 'neoforge', 'quilt', 'for', 'minecraft', 'edition', 'reforged', 'continued', 'remastered'])
const tokens = (s: string): string[] =>
  cleanName(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
const sameSet = (a: string[], b: string[]): boolean => a.length > 0 && a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
const subset = (a: string[], b: string[]): boolean => a.length > 0 && a.every((t) => b.includes(t))

/**
 * Tries to fetch each listed mod from Modrinth (open API, no key). Matches conservatively — exact
 * normalized title or matching slug — to avoid installing the wrong mod. Returns what it installed
 * and what it couldn't find (for manual download from CurseForge).
 */
async function resolveViaModrinth(
  mods: { name: string; pageUrl: string }[],
  mc: string,
  loader: LoaderId,
  modsDir: string,
  task: Task
): Promise<{ installed: number; missing: { name: string; pageUrl: string }[] }> {
  await ensureDir(modsDir)
  const loaders = loader === 'vanilla' ? undefined : [loader]
  const missing: { name: string; pageUrl: string }[] = []
  let installed = 0
  let done = 0

  const one = async (mod: { name: string; pageUrl: string }): Promise<void> => {
    const q = cleanName(mod.name)
    const qt = tokens(mod.name)
    const cfSlug = cfSlugOf(mod.pageUrl)
    try {
      // No gameVersion facet in the search (it buries exact-name mods behind addons); the version
      // check below (mrVersions filtered to mc+loader) still guarantees compatibility.
      const res = await mrSearch({ query: q, projectType: 'mod', loader: loaders?.[0] ?? null, gameVersion: null, sort: 'relevance', offset: 0, limit: 12 })
      // Only confident matches: exact slug, exact token set (title or slug), or a hit whose name
      // is a LESS-specific prefix of the query (its tokens ⊆ query). We never match a MORE-specific
      // hit (query ⊆ hit) — that grabs the wrong addon (e.g. "Twilight Forest: The Lost Blocks").
      const hit =
        (cfSlug ? res.hits.find((h) => h.slug === cfSlug) : undefined) ??
        res.hits.find((h) => sameSet(qt, tokens(h.title))) ??
        res.hits.find((h) => sameSet(qt, tokens(h.slug.replace(/-/g, ' ')))) ??
        res.hits.find((h) => qt.length >= 2 && subset(tokens(h.title), qt))
      if (!hit) {
        missing.push(mod)
        return
      }
      if (process.env['PRISMA_SELFTEST']) console.log(`[match] ${mod.name}  ->  ${hit.title} (${hit.slug})`)
      const versions = await mrVersions(hit.project_id, loaders, [mc])
      const v = versions.find((x) => x.version_type === 'release') ?? versions[0]
      const file = v?.files.find((f) => f.primary) ?? v?.files[0]
      if (!file) {
        missing.push(mod)
        return
      }
      await downloadFile(file.url, path.join(modsDir, path.basename(file.filename)), file.hashes.sha1)
      installed++
    } catch {
      missing.push(mod)
    } finally {
      done++
      task.update(`Buscando mods no Modrinth (${done}/${mods.length})`, mods.length ? done / mods.length : 1)
    }
  }

  // Bounded pool so we don't hammer Modrinth.
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < mods.length) await one(mods[next++])
  }
  await Promise.all(Array.from({ length: Math.min(8, mods.length) }, worker))
  return { installed, missing }
}

/**
 * Keyless import of a CurseForge pack .zip: a CF export contains only the mod LIST (ids in
 * manifest.json) plus overrides — never the mod jars. Without an API key we create the instance,
 * apply the overrides/configs, then pull every mod we can from Modrinth (open, no key). Whatever
 * isn't on Modrinth comes back as a manual list (CurseForge links).
 */
async function buildKeyless(zipPath: string, task: Task): Promise<CfImportResult> {
  task.update('Lendo o modpack…', null)
  const entries = await readEntries(zipPath, (n) => n === 'manifest.json' || n === 'modlist.html', 8 * 1024 * 1024)
  const raw = entries.get('manifest.json')
  if (!raw) throw new Error('Arquivo do CurseForge inválido (sem manifest.json)')
  const manifest = JSON.parse(raw.toString('utf8')) as CfManifest
  const mc = manifest.minecraft.version
  const { loader, version } = parseLoader(manifest)

  task.update(`Criando instância (${loader} ${mc})…`, null)
  const inst = await createInstance({ name: manifest.name || 'Modpack CurseForge', group: null, iconKey: 'glass:box', mcVersion: mc, loader, loaderVersion: version })

  task.update('Aplicando configs (overrides)…', null)
  const prefix = (manifest.overrides || 'overrides').replace(/\/?$/, '/')
  await extract(zipPath, inst.gameDir, (n) => (n.startsWith(prefix) && n.length > prefix.length ? n.slice(prefix.length) : null))

  const modlist = entries.get('modlist.html')
  let listed = modlist ? parseModlist(modlist.toString('utf8')) : manifest.files.map((f) => ({ name: `Projeto ${f.projectID}`, pageUrl: `https://www.curseforge.com/minecraft/search?search=${f.projectID}` }))
  const limit = Number(process.env['PRISMA_SELFTEST_LIMIT'] ?? 0)
  if (limit > 0) listed = listed.slice(0, limit)
  const { installed, missing } = await resolveViaModrinth(listed, mc, loader, path.join(inst.gameDir, 'mods'), task)
  task.update(`${installed} mods via Modrinth · ${missing.length} manuais`, 1)
  instanceEvents.emit('changed')
  return { instanceId: inst.id, name: inst.name, blocked: missing }
}

/** Import an exported CurseForge pack .zip chosen from disk (keyless when no API key is set). */
export async function importFromZip(file: string): Promise<CfImportResult> {
  const hasKey = !!getSettings().curseforgeApiKey.trim()
  return runTask('Importando modpack do CurseForge', (task) => (hasKey ? buildFromManifest(file, task, null, null) : buildKeyless(file, task)))
}

// ---- keyless import from a local folder (a CurseForge-app instance, or any .minecraft) ----

interface CfInstanceJson {
  name?: string
  gameVersion?: string
  minecraftVersion?: string
  baseModLoader?: { name?: string; forgeVersion?: string; minecraftVersion?: string }
  installedModpack?: { addonID?: number; name?: string; installedFile?: { displayName?: string } }
}

interface FolderMeta {
  name: string
  mcVersion: string
  loader: LoaderId
  loaderVersion: string | null
  managed: { id: number; name: string; versionName: string } | null
}

const LOADER_PREFIX: Record<string, LoaderId> = { forge: 'forge', fabric: 'fabric', quilt: 'quilt', neoforge: 'neoforge' }

/** Reads a CurseForge-app instance folder's minecraftinstance.json, when present. */
async function readFolderMeta(dir: string): Promise<FolderMeta | null> {
  const raw = await fs.readFile(path.join(dir, 'minecraftinstance.json'), 'utf8').catch(() => null)
  if (!raw) return null
  let j: CfInstanceJson
  try {
    j = JSON.parse(raw)
  } catch {
    return null
  }
  const bml = j.baseModLoader
  const loaderName = bml?.name?.split('-')[0]?.toLowerCase() ?? ''
  const loader = LOADER_PREFIX[loaderName] ?? 'vanilla'
  const loaderVersion = loader === 'vanilla' ? null : bml?.forgeVersion ?? bml?.name?.split('-').slice(1).join('-') ?? null
  const mcVersion = bml?.minecraftVersion ?? j.minecraftVersion ?? j.gameVersion ?? ''
  if (!mcVersion) return null
  return {
    name: j.name ?? j.installedModpack?.name ?? path.basename(dir),
    mcVersion,
    loader,
    loaderVersion,
    managed: j.installedModpack?.addonID ? { id: j.installedModpack.addonID, name: j.installedModpack.name ?? j.name ?? 'Modpack', versionName: j.installedModpack.installedFile?.displayName ?? '' } : null
  }
}

const COPY_SKIP = new Set(['minecraftinstance.json', 'logs', 'crash-reports', '.git', '.fabric', 'manifest.json', 'modlist.html', '.index'])

async function copyGame(from: string, to: string, task: Task): Promise<void> {
  task.update('Copiando arquivos do modpack…', null)
  await fs.cp(from, to, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(from, src)
      if (!rel) return true
      const top = rel.split(path.sep)[0]
      return !COPY_SKIP.has(top)
    }
  })
}

/** Imports a local modpack folder. Needs mcVersion+loader (from minecraftinstance.json or `override`). */
export async function importFolder(dir: string, override: { mcVersion: string; loader: LoaderId; loaderVersion: string | null; name?: string } | null): Promise<CfImportResult> {
  return runTask('Importando modpack (pasta)', async (task) => {
    // The game folder is usually the picked folder itself; some layouts nest it under .minecraft.
    const gameSrc = (await exists(path.join(dir, 'minecraftinstance.json'))) || (await exists(path.join(dir, 'mods'))) ? dir : (await exists(path.join(dir, '.minecraft'))) ? path.join(dir, '.minecraft') : dir
    const detected = await readFolderMeta(dir)
    const meta = override ? { name: override.name ?? detected?.name ?? path.basename(dir), mcVersion: override.mcVersion, loader: override.loader, loaderVersion: override.loaderVersion, managed: detected?.managed ?? null } : detected
    if (!meta) throw new Error('CF_FOLDER_NO_META')

    const extra: Record<string, string> = meta.managed
      ? { ManagedPack: 'true', ManagedPackType: 'flame', ManagedPackID: String(meta.managed.id), ManagedPackName: meta.managed.name, ManagedPackVersionName: meta.managed.versionName }
      : {}
    task.update(`Criando instância (${meta.loader} ${meta.mcVersion})…`, null)
    const inst = await createInstance({ name: meta.name, group: null, iconKey: 'glass:box', mcVersion: meta.mcVersion, loader: meta.loader, loaderVersion: meta.loaderVersion }, extra)
    // createInstance already made an empty gameDir; copy the pack's files over it.
    await fs.rm(inst.gameDir, { recursive: true, force: true })
    await copyGame(gameSrc, inst.gameDir, task)
    instanceEvents.emit('changed')
    return { instanceId: inst.id, name: inst.name, blocked: [] }
  })
}

/** True if a folder looks like a CurseForge/MultiMC/plain Minecraft instance we can import. */
export async function folderHasMeta(dir: string): Promise<{ ok: boolean; meta: FolderMeta | null }> {
  const meta = await readFolderMeta(dir)
  if (meta) return { ok: true, meta }
  const looksLikeGame = (await exists(path.join(dir, 'mods'))) || (await exists(path.join(dir, 'saves'))) || (await exists(path.join(dir, '.minecraft')))
  return { ok: looksLikeGame, meta: null }
}

/** True if a .zip is a CurseForge modpack (so the generic importer can route to here). */
export async function isCurseforgeZip(file: string): Promise<boolean> {
  const m = await readEntries(file, (n) => n === 'manifest.json', 4 * 1024 * 1024).catch(() => new Map<string, Buffer>())
  const raw = m.get('manifest.json')
  if (!raw) return false
  try {
    return (JSON.parse(raw.toString('utf8')) as CfManifest).manifestType === 'minecraftModpack'
  } catch {
    return false
  }
}
