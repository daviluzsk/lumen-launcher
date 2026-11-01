// Modrinth integration: search, project/version lookup, content install with required
// dependencies, and .mrpack modpack import (https://support.modrinth.com/en/articles/8802351).

import { promises as fs } from 'fs'
import path from 'path'
import { type ContentKind, type Instance, type LoaderId, type MrProject, type MrSearchQuery, type MrSearchResult, type MrVersion, LOADER_NAMES } from '@shared/types'
import { downloadAll, downloadFile } from '../net/download'
import { getJson } from '../net/http'
import { paths } from '../paths'
import { runTask } from '../tasks'
import { ensureDir, isInside, safeFileName } from '../util/fsx'
import { extract, readEntries } from '../util/zip'
import { readModIndex } from '../instances/content'
import { createInstance, getInstance, instanceDir, instanceEvents, writeCfg } from '../instances/instances'

const API = 'https://api.modrinth.com/v2'

export async function search(q: MrSearchQuery): Promise<MrSearchResult> {
  const facets: string[][] = [[`project_type:${q.projectType}`]]
  if (q.loader && q.projectType !== 'resourcepack') facets.push([`categories:${q.loader}`])
  if (q.gameVersion) facets.push([`versions:${q.gameVersion}`])
  const params = new URLSearchParams({
    query: q.query,
    facets: JSON.stringify(facets),
    index: q.sort,
    offset: String(q.offset),
    limit: String(q.limit)
  })
  return getJson(`${API}/search?${params}`)
}

export const getProject = (idOrSlug: string): Promise<MrProject> => getJson(`${API}/project/${encodeURIComponent(idOrSlug)}`)

export async function getVersions(projectId: string, loaders?: string[], gameVersions?: string[]): Promise<MrVersion[]> {
  const params = new URLSearchParams()
  if (loaders?.length) params.set('loaders', JSON.stringify(loaders))
  if (gameVersions?.length) params.set('game_versions', JSON.stringify(gameVersions))
  return getJson(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`)
}

const getVersion = (id: string): Promise<MrVersion> => getJson(`${API}/version/${encodeURIComponent(id)}`)

/** Loader names Modrinth uses for each content kind on a given instance. */
function loadersFor(inst: Instance, kind: ContentKind): string[] | undefined {
  if (kind === 'mods') return inst.loader === 'vanilla' ? undefined : [inst.loader]
  if (kind === 'shaderpacks') return ['iris', 'optifine', 'canvas', 'vanilla']
  return undefined
}

function pwToml(v: MrVersion, file: MrVersion['files'][number], title: string, inst: Instance): string {
  const q = (s: string): string => JSON.stringify(s)
  return [
    `filename = ${q(file.filename)}`,
    `name = ${q(title)}`,
    'side = "both"',
    `x-prismlauncher-loaders = [ ${v.loaders.map(q).join(', ')} ]`,
    `x-prismlauncher-mc-versions = [ ${inst.mcVersion ? q(inst.mcVersion) : ''} ]`,
    `x-prismlauncher-release-type = ${q(v.version_type)}`,
    '',
    '[download]',
    `hash = ${q(file.hashes.sha512)}`,
    'hash-format = "sha512"',
    'mode = "url"',
    `url = ${q(file.url)}`,
    '',
    '[update.modrinth]',
    `mod-id = ${q(v.project_id)}`,
    `version = ${q(v.id)}`,
    ''
  ].join('\n')
}

/** Installs a version (and, for mods, its required dependencies). Returns installed file names. */
export async function installVersion(instanceId: string, versionId: string, kind: ContentKind): Promise<string[]> {
  const inst = await getInstance(instanceId)
  const dir = path.join(inst.gameDir, kind)
  await ensureDir(dir)
  const installed: string[] = []
  const seen = new Set<string>()

  return runTask(`Instalando em ${inst.name}`, async (task) => {
    const index = kind === 'mods' ? await readModIndex(dir) : new Map()
    const present = new Set([...index.values()].map((v) => v.projectId))

    const installOne = async (v: MrVersion, depth: number): Promise<void> => {
      if (seen.has(v.project_id) || depth > 6) return
      seen.add(v.project_id)
      const file = v.files.find((f) => f.primary) ?? v.files[0]
      if (!file) return
      const project = await getProject(v.project_id).catch(() => null)
      const title = project?.title ?? file.filename
      task.update(`Baixando ${title}…`, null)

      // Replace an older file of the same project (update / reinstall).
      for (const [fname, meta] of index) {
        if (meta.projectId === v.project_id && fname !== file.filename) {
          await fs.rm(path.join(dir, fname), { force: true })
          await fs.rm(path.join(dir, `${fname}.disabled`), { force: true })
          await fs.rm(meta.toml, { force: true })
        }
      }
      const target = path.join(dir, path.basename(file.filename))
      if (!isInside(target, dir)) throw new Error('Nome de arquivo inválido')
      await downloadFile(file.url, target, file.hashes.sha1)
      if (kind === 'mods') {
        const slug = safeFileName(project?.slug ?? v.project_id)
        await ensureDir(path.join(dir, '.index'))
        await fs.writeFile(path.join(dir, '.index', `${slug}.pw.toml`), pwToml(v, file, title, inst))
      }
      installed.push(title)

      if (kind !== 'mods') return
      for (const dep of v.dependencies.filter((d) => d.dependency_type === 'required')) {
        if (dep.project_id && (present.has(dep.project_id) || seen.has(dep.project_id))) continue
        let depVersion: MrVersion | undefined
        if (dep.version_id) depVersion = await getVersion(dep.version_id).catch(() => undefined)
        else if (dep.project_id) {
          depVersion = (await getVersions(dep.project_id, loadersFor(inst, kind), inst.mcVersion ? [inst.mcVersion] : undefined).catch(() => []))[0]
        }
        if (depVersion) await installOne(depVersion, depth + 1)
      }
    }

    await installOne(await getVersion(versionId), 0)
    return installed
  }, instanceId)
}

interface MrIndex {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files: { path: string; hashes: { sha1: string; sha512?: string }; env?: { client?: string; server?: string }; downloads: string[]; fileSize: number }[]
  dependencies: Record<string, string>
}

const ALLOWED_HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com']

function packLoader(deps: Record<string, string>): { loader: LoaderId; version: string | null } {
  if (deps['neoforge']) return { loader: 'neoforge', version: deps['neoforge'] }
  if (deps['forge']) return { loader: 'forge', version: deps['forge'] }
  if (deps['quilt-loader']) return { loader: 'quilt', version: deps['quilt-loader'] }
  if (deps['fabric-loader']) return { loader: 'fabric', version: deps['fabric-loader'] }
  return { loader: 'vanilla', version: null }
}

async function cacheIcon(url: string | null | undefined, key: string): Promise<string | null> {
  if (!url) return null
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase() || '.png'
    await downloadFile(url, path.join(paths.icons, key + (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.png')))
    return key
  } catch {
    return null
  }
}

/** Creates an instance from an .mrpack file (local or downloaded). */
export async function importMrpack(file: string, opts: { name?: string; group?: string | null; iconKey?: string | null; project?: { id: string; title: string; versionId: string; versionName: string } } = {}): Promise<Instance> {
  return runTask('Importando modpack', async (task) => {
    task.update('Lendo modrinth.index.json…', null)
    const entries = await readEntries(file, (n) => n === 'modrinth.index.json', 64 * 1024 * 1024)
    const raw = entries.get('modrinth.index.json')
    if (!raw) throw new Error('Arquivo .mrpack inválido')
    const index = JSON.parse(raw.toString('utf8')) as MrIndex
    const mc = index.dependencies['minecraft']
    if (!mc) throw new Error('O modpack não declara a versão do Minecraft')
    const { loader, version } = packLoader(index.dependencies)

    task.update(`Criando instância (${LOADER_NAMES[loader]} ${mc})…`, null)
    const extra: Record<string, string> = {}
    if (opts.project) {
      Object.assign(extra, {
        ManagedPack: 'true',
        ManagedPackType: 'modrinth',
        ManagedPackID: opts.project.id,
        ManagedPackName: opts.project.title,
        ManagedPackVersionID: opts.project.versionId,
        ManagedPackVersionName: opts.project.versionName
      })
    }
    const inst = await createInstance(
      { name: opts.name || index.name, group: opts.group ?? null, iconKey: opts.iconKey || 'glass:box', mcVersion: mc, loader, loaderVersion: version },
      extra
    )

    const items = index.files
      .filter((f) => f.env?.client !== 'unsupported')
      .map((f) => {
        const target = path.resolve(inst.gameDir, f.path)
        if (!isInside(target, inst.gameDir)) throw new Error(`Caminho inválido no modpack: ${f.path}`)
        const url = f.downloads.find((u) => ALLOWED_HOSTS.includes(new URL(u).host))
        if (!url) throw new Error(`Download não permitido no modpack: ${f.path}`)
        return { url, path: target, sha1: f.hashes.sha1, size: f.fileSize }
      })
    await downloadAll(items, (p) => task.update(`Baixando arquivos do modpack (${p.done}/${p.total})`, p.total ? p.done / p.total : 1))

    task.update('Aplicando overrides…', null)
    for (const prefix of ['overrides/', 'client-overrides/']) {
      await extract(file, inst.gameDir, (n) => (n.startsWith(prefix) && n.length > prefix.length ? n.slice(prefix.length) : null))
    }
    return getInstance(inst.id)
  })
}

export async function installModpack(versionId: string, opts: { name?: string; group?: string | null }): Promise<Instance> {
  const v = await getVersion(versionId)
  const project = await getProject(v.project_id)
  const file = v.files.find((f) => f.primary && f.filename.endsWith('.mrpack')) ?? v.files.find((f) => f.filename.endsWith('.mrpack'))
  if (!file) throw new Error('Esta versão não tem um arquivo .mrpack')
  const tmp = path.join(paths.cache, 'mrpack', `${v.id}.mrpack`)
  await runTask(`Baixando ${project.title}`, async (task) => {
    task.update(`${file.filename}`, null)
    await downloadFile(file.url, tmp, file.hashes.sha1)
  })
  const iconKey = await cacheIcon(project.icon_url, `modrinth_${project.id}`)
  try {
    return await importMrpack(tmp, {
      name: opts.name || project.title,
      group: opts.group,
      iconKey,
      project: { id: project.id, title: project.title, versionId: v.id, versionName: v.version_number }
    })
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
  }
}

/** Imports a Prism/MultiMC exported .zip (instance.cfg inside) or a Modrinth .mrpack. */
export async function importArchive(file: string): Promise<Instance> {
  if (file.toLowerCase().endsWith('.mrpack')) return importMrpack(file)
  return runTask('Importando instância', async (task) => {
    const names = await readEntries(file, (n) => n.endsWith('instance.cfg'), 1024 * 1024)
    const cfgPath = [...names.keys()].sort((a, b) => a.length - b.length)[0]
    if (!cfgPath) {
      if ((await readEntries(file, (n) => n === 'modrinth.index.json', 64 * 1024 * 1024)).size) return importMrpack(file)
      throw new Error('O arquivo não parece ser uma instância do Prism/MultiMC nem um .mrpack')
    }
    const prefix = cfgPath.slice(0, -'instance.cfg'.length)
    const name = path.basename(file).replace(/\.zip$/i, '')
    let id = safeFileName(name)
    for (let n = 2; await fs.access(instanceDir(id)).then(() => true, () => false); n++) id = `${safeFileName(name)} (${n})`
    const dir = instanceDir(id)
    task.update('Extraindo…', null)
    await extract(file, dir, (n) => (n.startsWith(prefix) && n.length > prefix.length ? n.slice(prefix.length) : null))
    await writeCfg(dir, (cfg) => {
      if (!cfg.get('name')) cfg.set('name', name)
    })
    instanceEvents.emit('changed')
    return getInstance(id)
  })
}
