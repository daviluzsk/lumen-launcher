// Instance storage in Prism Launcher's on-disk format:
//   <instancesDir>/<id>/instance.cfg      (QSettings INI)
//   <instancesDir>/<id>/mmc-pack.json     (component list)
//   <instancesDir>/<id>/minecraft/        (game dir; ".minecraft" is also accepted)
//   <instancesDir>/instgroups.json        (groups)

import { shell } from 'electron'
import { EventEmitter } from 'events'
import { existsSync, promises as fs, watch, type FSWatcher } from 'fs'
import path from 'path'
import { type Component, type Instance, type InstancePatch, type InstanceSettings, type LoaderId, LOADER_UIDS, type NewInstanceRequest } from '@shared/types'
import { getIndex } from '../minecraft/meta'
import { paths, prismDataDir } from '../paths'
import { getSettings } from '../settings'
import { ensureDir, exists, readJson, safeFileName, writeFileAtomic, writeJson } from '../util/fsx'
import { type IniMap, iniBool, iniInt, parseIni, serializeIni } from '../util/ini'
import { mediaUrl } from '../media'

export const instanceEvents = new EventEmitter()

interface GroupsFile {
  formatVersion: string
  groups: Record<string, { hidden?: boolean; instances: string[] }>
}

export const instancesDir = (): string => getSettings().instancesDir

export function instanceDir(id: string): string {
  const dir = path.join(instancesDir(), id)
  if (path.dirname(dir) !== path.resolve(instancesDir())) throw new Error('ID de instância inválido')
  return dir
}

export function gameDirOf(dir: string): string {
  const dot = path.join(dir, '.minecraft')
  return existsSync(dot) ? dot : path.join(dir, 'minecraft')
}

const groupsPath = (): string => path.join(instancesDir(), 'instgroups.json')

async function readGroups(): Promise<GroupsFile> {
  const g = await readJson<GroupsFile>(groupsPath(), { formatVersion: '1', groups: {} })
  g.groups ??= {}
  return g
}

async function setGroup(id: string, group: string | null): Promise<void> {
  const g = await readGroups()
  for (const [name, entry] of Object.entries(g.groups)) {
    entry.instances = entry.instances.filter((i) => i !== id)
    if (!entry.instances.length) delete g.groups[name]
  }
  if (group) {
    g.groups[group] ??= { hidden: false, instances: [] }
    g.groups[group].instances.push(id)
  }
  await writeJson(groupsPath(), g)
}

const ICON_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']

async function iconUrlFor(key: string): Promise<string | null> {
  if (!key || key.startsWith('glass:')) return null
  const roots = [paths.icons]
  const prism = prismDataDir()
  if (prism) roots.push(path.join(prism, 'icons'))
  for (const root of roots) {
    for (const ext of ICON_EXTS) {
      const p = path.join(root, key + ext)
      if (existsSync(p)) return mediaUrl(p)
    }
  }
  return null
}

function detectLoader(components: Component[]): { loader: LoaderId; version: string | null } {
  for (const [loader, uid] of Object.entries(LOADER_UIDS) as [Exclude<LoaderId, 'vanilla'>, string][]) {
    const c = components.find((x) => x.uid === uid && !x.disabled)
    if (c) return { loader, version: c.version ?? null }
  }
  return { loader: 'vanilla', version: null }
}

function readSettings(cfg: IniMap): InstanceSettings {
  const g = getSettings()
  return {
    overrideMemory: iniBool(cfg, 'OverrideMemory'),
    minMem: iniInt(cfg, 'MinMemAlloc', g.minMem),
    maxMem: iniInt(cfg, 'MaxMemAlloc', g.maxMem),
    overrideJava: iniBool(cfg, 'OverrideJavaLocation') && !iniBool(cfg, 'AutomaticJava'),
    javaPath: cfg.get('JavaPath') ?? '',
    overrideJvmArgs: iniBool(cfg, 'OverrideJavaArgs'),
    jvmArgs: cfg.get('JvmArgs') ?? '',
    overrideWindow: iniBool(cfg, 'OverrideWindow'),
    width: iniInt(cfg, 'MinecraftWinWidth', g.width),
    height: iniInt(cfg, 'MinecraftWinHeight', g.height),
    maximized: iniBool(cfg, 'LaunchMaximized')
  }
}

function writeSettings(cfg: IniMap, s: Partial<InstanceSettings>): void {
  const set = (k: string, v: string | number | boolean | undefined): void => {
    if (v !== undefined) cfg.set(k, String(v))
  }
  set('OverrideMemory', s.overrideMemory)
  set('MinMemAlloc', s.minMem)
  set('MaxMemAlloc', s.maxMem)
  if (s.overrideJava !== undefined) {
    cfg.set('OverrideJavaLocation', String(s.overrideJava))
    cfg.set('AutomaticJava', String(!s.overrideJava))
  }
  set('JavaPath', s.javaPath)
  set('OverrideJavaArgs', s.overrideJvmArgs)
  set('JvmArgs', s.jvmArgs)
  set('OverrideWindow', s.overrideWindow)
  set('MinecraftWinWidth', s.width)
  set('MinecraftWinHeight', s.height)
  set('LaunchMaximized', s.maximized)
}

export async function readCfg(dir: string): Promise<IniMap> {
  return parseIni(await fs.readFile(path.join(dir, 'instance.cfg'), 'utf8').catch(() => ''))
}

export async function writeCfg(dir: string, mutate: (cfg: IniMap) => void): Promise<void> {
  const cfg = await readCfg(dir)
  mutate(cfg)
  await writeFileAtomic(path.join(dir, 'instance.cfg'), serializeIni(cfg))
}

export async function readComponents(dir: string): Promise<Component[]> {
  const pack = await readJson<{ components?: Component[] }>(path.join(dir, 'mmc-pack.json'), {})
  return pack.components ?? []
}

export async function writeComponents(dir: string, components: Component[]): Promise<void> {
  await writeJson(path.join(dir, 'mmc-pack.json'), { components, formatVersion: 1 })
}

async function loadInstance(id: string, groupOf: Map<string, string>): Promise<Instance | null> {
  const dir = path.join(instancesDir(), id)
  if (!(await exists(path.join(dir, 'instance.cfg')))) return null
  const cfg = await readCfg(dir)
  const components = await readComponents(dir)
  const { loader, version } = detectLoader(components)
  const iconKey = cfg.get('iconKey') ?? 'default'
  return {
    id,
    name: cfg.get('name') || id,
    group: groupOf.get(id) ?? null,
    iconKey,
    iconUrl: await iconUrlFor(iconKey),
    mcVersion: components.find((c) => c.uid === 'net.minecraft')?.version ?? null,
    loader,
    loaderVersion: version,
    components,
    lastLaunch: iniInt(cfg, 'lastLaunchTime'),
    totalPlayed: iniInt(cfg, 'totalTimePlayed'),
    notes: cfg.get('notes') ?? '',
    managedPack: iniBool(cfg, 'ManagedPack')
      ? {
          type: cfg.get('ManagedPackType') ?? '',
          id: cfg.get('ManagedPackID') ?? '',
          name: cfg.get('ManagedPackName') ?? '',
          versionId: cfg.get('ManagedPackVersionID') ?? '',
          versionName: cfg.get('ManagedPackVersionName') ?? ''
        }
      : null,
    settings: readSettings(cfg),
    accountId: cfg.get('PrismaAccountId') || null,
    dir,
    gameDir: gameDirOf(dir)
  }
}

export async function listInstances(): Promise<Instance[]> {
  const root = instancesDir()
  await ensureDir(root)
  const groups = await readGroups()
  const groupOf = new Map<string, string>()
  for (const [name, entry] of Object.entries(groups.groups)) for (const id of entry.instances) groupOf.set(id, name)
  const entries = await fs.readdir(root, { withFileTypes: true })
  const loaded = await Promise.all(
    entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')).map((e) => loadInstance(e.name, groupOf))
  )
  return loaded.filter((i): i is Instance => !!i)
}

export async function getInstance(id: string): Promise<Instance> {
  const groups = await readGroups()
  const groupOf = new Map<string, string>()
  for (const [name, entry] of Object.entries(groups.groups)) for (const i of entry.instances) groupOf.set(i, name)
  const inst = await loadInstance(path.basename(instanceDir(id)), groupOf)
  if (!inst) throw new Error('Instância não encontrada')
  return inst
}

async function uniqueId(name: string): Promise<string> {
  const base = safeFileName(name)
  let id = base
  for (let n = 2; await exists(path.join(instancesDir(), id)); n++) id = `${base} (${n})`
  return id
}

/** Component list for a fresh instance, mirroring what Prism writes. */
export async function buildComponents(mcVersion: string, loader: LoaderId, loaderVersion: string | null): Promise<Component[]> {
  const mc = (await getIndex('net.minecraft')).versions.find((v) => v.version === mcVersion)
  if (!mc) throw new Error(`Minecraft ${mcVersion} não existe`)
  const out: Component[] = []
  const lwjgl = mc.requires?.find((r) => r.uid.startsWith('org.lwjgl'))
  if (lwjgl) out.push({ uid: lwjgl.uid, version: lwjgl.equals ?? lwjgl.suggests, dependencyOnly: true, cachedVolatile: true })
  out.push({ uid: 'net.minecraft', version: mcVersion, important: true, cachedName: 'Minecraft', cachedVersion: mcVersion, cachedRequires: mc.requires })
  if (loader !== 'vanilla') {
    if (!loaderVersion) throw new Error('Escolha a versão do mod loader')
    if (loader === 'fabric' || loader === 'quilt') {
      out.push({ uid: 'net.fabricmc.intermediary', version: mcVersion, dependencyOnly: true, cachedName: 'Intermediary Mappings', cachedVersion: mcVersion })
    }
    out.push({ uid: LOADER_UIDS[loader], version: loaderVersion, cachedVersion: loaderVersion })
  }
  return out
}

export async function createInstance(req: NewInstanceRequest, extraCfg: Record<string, string> = {}): Promise<Instance> {
  const components = await buildComponents(req.mcVersion, req.loader, req.loaderVersion)
  const id = await uniqueId(req.name)
  const dir = path.join(instancesDir(), id)
  await ensureDir(path.join(dir, 'minecraft'))
  await writeComponents(dir, components)
  const cfg: IniMap = new Map([
    ['ConfigVersion', '1.3'],
    ['InstanceType', 'OneSix'],
    ['name', req.name.trim() || id],
    ['iconKey', req.iconKey || 'glass:grass'],
    ...Object.entries(extraCfg)
  ])
  await writeFileAtomic(path.join(dir, 'instance.cfg'), serializeIni(cfg))
  if (req.group) await setGroup(id, req.group)
  instanceEvents.emit('changed')
  return getInstance(id)
}

export async function changeVersion(id: string, mcVersion: string, loader: LoaderId, loaderVersion: string | null): Promise<Instance> {
  const dir = instanceDir(id)
  const managed = new Set(['net.minecraft', 'org.lwjgl', 'org.lwjgl3', 'net.fabricmc.intermediary', ...Object.values(LOADER_UIDS)])
  const keep = (await readComponents(dir)).filter((c) => !managed.has(c.uid))
  await writeComponents(dir, [...(await buildComponents(mcVersion, loader, loaderVersion)), ...keep])
  instanceEvents.emit('changed')
  return getInstance(id)
}

export async function updateInstance(id: string, patch: InstancePatch): Promise<Instance> {
  const dir = instanceDir(id)
  await writeCfg(dir, (cfg) => {
    if (patch.name !== undefined) cfg.set('name', patch.name.trim() || id)
    if (patch.iconKey !== undefined) cfg.set('iconKey', patch.iconKey)
    if (patch.notes !== undefined) cfg.set('notes', patch.notes)
    if (patch.accountId !== undefined) {
      if (patch.accountId) cfg.set('PrismaAccountId', patch.accountId)
      else cfg.delete('PrismaAccountId')
    }
    if (patch.settings) writeSettings(cfg, patch.settings)
  })
  if (patch.group !== undefined) await setGroup(id, patch.group?.trim() || null)
  instanceEvents.emit('changed')
  return getInstance(id)
}

export async function setInstanceIcon(id: string, file: string): Promise<Instance> {
  const ext = path.extname(file).toLowerCase()
  if (!ICON_EXTS.includes(ext)) throw new Error('Formato de imagem não suportado')
  const key = `prisma_${safeFileName(id).replace(/\s+/g, '_')}_${Date.now()}`
  await ensureDir(paths.icons)
  await fs.copyFile(file, path.join(paths.icons, key + ext))
  return updateInstance(id, { iconKey: key })
}

export async function deleteInstance(id: string): Promise<void> {
  const dir = instanceDir(id)
  // Recycle bin instead of a hard delete — worlds are precious.
  await shell.trashItem(dir)
  await setGroup(id, null)
  instanceEvents.emit('changed')
}

export async function duplicateInstance(id: string): Promise<Instance> {
  const src = await getInstance(id)
  const newId = await uniqueId(`${src.name} (cópia)`)
  const dir = path.join(instancesDir(), newId)
  await fs.cp(src.dir, dir, { recursive: true, filter: (p) => !/[\\/](natives|logs|crash-reports)$/.test(p) })
  await writeCfg(dir, (cfg) => {
    cfg.set('name', `${src.name} (cópia)`)
    cfg.delete('totalTimePlayed')
    cfg.delete('lastLaunchTime')
  })
  if (src.group) await setGroup(newId, src.group)
  instanceEvents.emit('changed')
  return getInstance(newId)
}

export async function recordPlaytime(id: string, startedAt: number): Promise<void> {
  const seconds = Math.round((Date.now() - startedAt) / 1000)
  await writeCfg(instanceDir(id), (cfg) => {
    cfg.set('lastLaunchTime', String(startedAt))
    cfg.set('lastTimePlayed', String(seconds))
    cfg.set('totalTimePlayed', String(iniInt(cfg, 'totalTimePlayed') + seconds))
  })
  instanceEvents.emit('changed')
}

export async function listGroups(): Promise<string[]> {
  return Object.keys((await readGroups()).groups).sort((a, b) => a.localeCompare(b))
}

export async function renameGroup(from: string, to: string): Promise<void> {
  const g = await readGroups()
  const entry = g.groups[from]
  if (!entry || !to.trim()) return
  delete g.groups[from]
  g.groups[to.trim()] = { ...entry, instances: [...(g.groups[to.trim()]?.instances ?? []), ...entry.instances] }
  await writeJson(groupsPath(), g)
  instanceEvents.emit('changed')
}

let watcher: FSWatcher | null = null
let debounce: NodeJS.Timeout | null = null

/** Picks up instances added/removed by other tools (or Prism itself). */
export function watchInstances(): void {
  watcher?.close()
  try {
    watcher = watch(instancesDir(), () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => instanceEvents.emit('changed'), 600)
    })
  } catch {
    watcher = null
  }
}
