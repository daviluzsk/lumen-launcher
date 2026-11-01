// Local Minecraft servers ("Multiplayer" tab). Each server lives in <data>/servers/<id>/,
// which is a normal Minecraft server directory (server.properties, world/, mods/, eula.txt…)
// plus a server.json with Lumen's own metadata. Vanilla, Fabric, Forge and NeoForge are
// supported; a server can be created fresh or cloned from an instance (world + mods + config).

import { execFile } from 'child_process'
import { EventEmitter } from 'events'
import { existsSync, promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { type GameServer, type LoaderId, LOADER_UIDS, type NewServerRequest, type NetInfo, type ServerPatch, type ServerProps } from '@shared/types'
import { downloadFile } from '../net/download'
import { getJson } from '../net/http'
import { resolveJava } from '../java/java'
import { getInstance } from '../instances/instances'
import { getVersionFile, listLoaderVersions, listVersions } from '../minecraft/meta'
import { mediaUrl } from '../media'
import { paths } from '../paths'
import { type Task, runTask } from '../tasks'
import { ensureDir, exists, readJson, safeFileName, writeJson } from '../util/fsx'

export const serverEvents = new EventEmitter()

interface ServerMeta {
  name: string
  iconKey: string
  mcVersion: string
  loader: LoaderId
  loaderVersion: string | null
  minMem: number
  maxMem: number
  ready: boolean
  sourceInstanceId: string | null
  lastStarted: number
}

export const DEFAULT_PROPS: ServerProps = {
  motd: 'Servidor Lumen',
  maxPlayers: 10,
  gamemode: 'survival',
  difficulty: 'normal',
  onlineMode: false,
  pvp: true,
  whitelist: false,
  port: 25565,
  viewDistance: 10,
  spawnProtection: 0,
  allowFlight: true,
  commandBlocks: true
}

// ServerProps field  ->  server.properties key
const PROP_KEYS: Record<keyof ServerProps, string> = {
  motd: 'motd',
  maxPlayers: 'max-players',
  gamemode: 'gamemode',
  difficulty: 'difficulty',
  onlineMode: 'online-mode',
  pvp: 'pvp',
  whitelist: 'white-list',
  port: 'server-port',
  viewDistance: 'view-distance',
  spawnProtection: 'spawn-protection',
  allowFlight: 'allow-flight',
  commandBlocks: 'enable-command-block'
}

export const serverDir = (id: string): string => {
  const dir = path.join(paths.servers, id)
  if (path.dirname(dir) !== path.resolve(paths.servers)) throw new Error('ID de servidor inválido')
  return dir
}

async function iconUrlFor(key: string): Promise<string | null> {
  if (!key || key.startsWith('glass:')) return null
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const p = path.join(paths.icons, key + ext)
    if (existsSync(p)) return mediaUrl(p)
  }
  return null
}

// --- server.properties (flat key=value, Java .properties escaping is loose enough to ignore) ---

function parseProps(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq > 0) map.set(line.slice(0, eq).trim(), line.slice(eq + 1))
  }
  return map
}

async function readProps(dir: string): Promise<ServerProps> {
  const raw = await fs.readFile(path.join(dir, 'server.properties'), 'utf8').catch(() => '')
  const m = parseProps(raw)
  const str = (k: string, d: string): string => m.get(k) ?? d
  const num = (k: string, d: number): number => {
    const n = parseInt(m.get(k) ?? '', 10)
    return Number.isFinite(n) ? n : d
  }
  const bool = (k: string, d: boolean): boolean => (m.has(k) ? m.get(k) === 'true' : d)
  return {
    motd: str('motd', DEFAULT_PROPS.motd),
    maxPlayers: num('max-players', DEFAULT_PROPS.maxPlayers),
    gamemode: (str('gamemode', DEFAULT_PROPS.gamemode) as ServerProps['gamemode']) || 'survival',
    difficulty: (str('difficulty', DEFAULT_PROPS.difficulty) as ServerProps['difficulty']) || 'normal',
    onlineMode: bool('online-mode', DEFAULT_PROPS.onlineMode),
    pvp: bool('pvp', DEFAULT_PROPS.pvp),
    whitelist: bool('white-list', DEFAULT_PROPS.whitelist),
    port: num('server-port', DEFAULT_PROPS.port),
    viewDistance: num('view-distance', DEFAULT_PROPS.viewDistance),
    spawnProtection: num('spawn-protection', DEFAULT_PROPS.spawnProtection),
    allowFlight: bool('allow-flight', DEFAULT_PROPS.allowFlight),
    commandBlocks: bool('enable-command-block', DEFAULT_PROPS.commandBlocks)
  }
}

async function writeProps(dir: string, props: ServerProps): Promise<void> {
  const file = path.join(dir, 'server.properties')
  const existing = parseProps(await fs.readFile(file, 'utf8').catch(() => ''))
  for (const [field, key] of Object.entries(PROP_KEYS) as [keyof ServerProps, string][]) {
    existing.set(key, String(props[field]))
  }
  existing.set('level-name', existing.get('level-name') || 'world')
  existing.set('enable-rcon', 'false')
  const out = ['#Minecraft server properties — Lumen', `#${new Date().toUTCString()}`]
  for (const [k, v] of existing) out.push(`${k}=${v}`)
  await fs.writeFile(file, out.join('\n') + '\n')
}

// --- metadata ---

async function readMeta(dir: string): Promise<ServerMeta | null> {
  if (!(await exists(path.join(dir, 'server.json')))) return null
  return readJson<ServerMeta>(path.join(dir, 'server.json'), null as unknown as ServerMeta)
}

async function writeMeta(dir: string, meta: ServerMeta): Promise<void> {
  await writeJson(path.join(dir, 'server.json'), meta, 2)
}

async function countMods(dir: string): Promise<number> {
  try {
    return (await fs.readdir(path.join(dir, 'mods'))).filter((f) => f.endsWith('.jar')).length
  } catch {
    return 0
  }
}

async function toPublic(id: string): Promise<GameServer | null> {
  const dir = serverDir(id)
  const meta = await readMeta(dir)
  if (!meta) return null
  return {
    id,
    name: meta.name,
    iconKey: meta.iconKey,
    iconUrl: await iconUrlFor(meta.iconKey),
    mcVersion: meta.mcVersion,
    loader: meta.loader,
    loaderVersion: meta.loaderVersion,
    props: await readProps(dir),
    minMem: meta.minMem,
    maxMem: meta.maxMem,
    ready: meta.ready,
    modCount: await countMods(dir),
    sourceInstanceId: meta.sourceInstanceId,
    dir,
    lastStarted: meta.lastStarted
  }
}

export async function listServers(): Promise<GameServer[]> {
  await ensureDir(paths.servers)
  const entries = await fs.readdir(paths.servers, { withFileTypes: true })
  const loaded = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => toPublic(e.name)))
  return loaded.filter((s): s is GameServer => !!s).sort((a, b) => b.lastStarted - a.lastStarted || a.name.localeCompare(b.name))
}

export async function getServer(id: string): Promise<GameServer> {
  const s = await toPublic(path.basename(serverDir(id)))
  if (!s) throw new Error('Servidor não encontrado')
  return s
}

export async function updateServer(id: string, patch: ServerPatch): Promise<GameServer> {
  const dir = serverDir(id)
  const meta = await readMeta(dir)
  if (!meta) throw new Error('Servidor não encontrado')
  if (patch.name !== undefined) meta.name = patch.name.trim() || meta.name
  if (patch.iconKey !== undefined) meta.iconKey = patch.iconKey
  if (patch.minMem !== undefined) meta.minMem = patch.minMem
  if (patch.maxMem !== undefined) meta.maxMem = patch.maxMem
  await writeMeta(dir, meta)
  if (patch.props) await writeProps(dir, { ...(await readProps(dir)), ...patch.props })
  serverEvents.emit('changed')
  return getServer(id)
}

export async function deleteServer(id: string): Promise<void> {
  const { shell } = await import('electron')
  await shell.trashItem(serverDir(id))
  serverEvents.emit('changed')
}

export function acceptEula(id: string): Promise<void> {
  return fs.writeFile(path.join(serverDir(id), 'eula.txt'), `#Lumen\neula=true\n`)
}

export async function hasEula(id: string): Promise<boolean> {
  const t = await fs.readFile(path.join(serverDir(id), 'eula.txt'), 'utf8').catch(() => '')
  return /eula\s*=\s*true/i.test(t)
}

// --- jar provisioning per loader ---

interface MojangManifest {
  versions: { id: string; url: string }[]
}

async function installVanilla(dir: string, mc: string, task: Task): Promise<void> {
  task.update('Procurando o servidor do Minecraft…', null)
  const manifest = await getJson<MojangManifest>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
  const entry = manifest.versions.find((v) => v.id === mc)
  if (!entry) throw new Error(`Versão ${mc} não encontrada no manifesto da Mojang`)
  const detail = await getJson<{ downloads?: { server?: { url: string; sha1: string; size: number } } }>(entry.url)
  const server = detail.downloads?.server
  if (!server) throw new Error(`A versão ${mc} não tem servidor dedicado`)
  task.update('Baixando server.jar…', null)
  await downloadFile(server.url, path.join(dir, 'server.jar'), server.sha1)
}

async function installFabric(dir: string, mc: string, loaderVersion: string | null, task: Task): Promise<string> {
  const loaders = await getJson<{ loader: { version: string; stable: boolean } }[]>(`https://meta.fabricmc.net/v2/versions/loader/${mc}`)
  const loader = loaderVersion ?? loaders.find((l) => l.loader.stable)?.loader.version ?? loaders[0]?.loader.version
  if (!loader) throw new Error(`Fabric não disponível para ${mc}`)
  const installers = await getJson<{ version: string; stable: boolean }[]>('https://meta.fabricmc.net/v2/versions/installer')
  const installer = installers.find((i) => i.stable)?.version ?? installers[0]?.version
  task.update('Baixando servidor Fabric…', null)
  await downloadFile(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/${installer}/server/jar`, path.join(dir, 'fabric-server-launch.jar'))
  return loader
}

async function runInstaller(installerJar: string, dir: string, javaExe: string, task: Task): Promise<void> {
  task.update('Instalando o servidor (pode demorar)…', null)
  await new Promise<void>((resolve, reject) => {
    const child = execFile(javaExe, ['-jar', installerJar, '--installServer'], { cwd: dir, maxBuffer: 64 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve()))
    child.stdout?.on('data', (d: Buffer) => {
      const line = d.toString().trim().split(/\r?\n/).pop()
      if (line) task.update(line.slice(0, 80), null)
    })
  })
}

/** Path to the Forge/NeoForge @argfile the installer generates (1.17+ modular launch). */
function modArgFile(dir: string, loader: 'forge' | 'neoforge', mc: string, version: string): string | null {
  const base = loader === 'forge' ? path.join(dir, 'libraries', 'net', 'minecraftforge', 'forge', `${mc}-${version}`) : path.join(dir, 'libraries', 'net', 'neoforged', 'neoforge', version)
  for (const name of ['win_args.txt', 'unix_args.txt']) {
    if (existsSync(path.join(base, name))) return path.join(base, name)
  }
  return null
}

async function installForge(dir: string, mc: string, version: string, javaExe: string, task: Task): Promise<void> {
  const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${version}/forge-${mc}-${version}-installer.jar`
  const jar = path.join(paths.cache, 'servers', `forge-${mc}-${version}-installer.jar`)
  task.update('Baixando instalador do Forge…', null)
  await downloadFile(url, jar)
  await runInstaller(jar, dir, javaExe, task)
  if (!modArgFile(dir, 'forge', mc, version)) throw new Error('O instalador do Forge não gerou os arquivos do servidor')
}

async function installNeoForge(dir: string, version: string, javaExe: string, task: Task): Promise<void> {
  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
  const jar = path.join(paths.cache, 'servers', `neoforge-${version}-installer.jar`)
  task.update('Baixando instalador do NeoForge…', null)
  await downloadFile(url, jar)
  await runInstaller(jar, dir, javaExe, task)
}

/** Builds the java command for a provisioned server (without memory args, which run.ts adds). */
export function launchArgs(server: GameServer): string[] {
  if (server.loader === 'vanilla') return ['-jar', 'server.jar', 'nogui']
  if (server.loader === 'fabric' || server.loader === 'quilt') return ['-jar', 'fabric-server-launch.jar', 'nogui']
  const argFile = modArgFile(server.dir, server.loader as 'forge' | 'neoforge', server.mcVersion, server.loaderVersion ?? '')
  if (!argFile) throw new Error('Arquivos do servidor ausentes — recrie o servidor.')
  return [`@${argFile}`, 'nogui']
}

export async function serverJavaMajors(mc: string): Promise<number[]> {
  try {
    const f = await getVersionFile('net.minecraft', mc)
    return f.compatibleJavaMajors ?? []
  } catch {
    return []
  }
}

// --- create ---

async function uniqueId(name: string): Promise<string> {
  const base = safeFileName(name)
  let id = base
  for (let n = 2; await exists(path.join(paths.servers, id)); n++) id = `${base}-${n}`
  return id
}

async function cloneFromInstance(dir: string, req: NewServerRequest, task: Task): Promise<void> {
  if (!req.fromInstanceId) return
  const inst = await getInstance(req.fromInstanceId)
  if (req.worldFolder) {
    task.update('Copiando o mundo…', null)
    const src = path.join(inst.gameDir, 'saves', req.worldFolder)
    if (await exists(src)) await fs.cp(src, path.join(dir, 'world'), { recursive: true })
  }
  if (req.copyMods && req.loader !== 'vanilla') {
    task.update('Copiando os mods…', null)
    const src = path.join(inst.gameDir, 'mods')
    if (await exists(src)) {
      await ensureDir(path.join(dir, 'mods'))
      for (const f of await fs.readdir(src)) {
        if (f.endsWith('.jar')) await fs.copyFile(path.join(src, f), path.join(dir, 'mods', f))
      }
    }
  }
  if (req.copyConfig) {
    const src = path.join(inst.gameDir, 'config')
    if (await exists(src)) await fs.cp(src, path.join(dir, 'config'), { recursive: true })
  }
}

export async function createServer(req: NewServerRequest): Promise<GameServer> {
  if (req.loader === 'quilt') throw new Error('Servidores Quilt ainda não são suportados. Use Fabric.')
  const id = await uniqueId(req.name)
  const dir = serverDir(id)
  await ensureDir(dir)
  await ensureDir(path.join(paths.cache, 'servers'))

  return runTask(`Criando servidor ${req.name}`, async (task) => {
    const meta: ServerMeta = {
      name: req.name.trim() || id,
      iconKey: 'glass:castle',
      mcVersion: req.mcVersion,
      loader: req.loader,
      loaderVersion: req.loaderVersion,
      minMem: 1024,
      maxMem: 4096,
      ready: false,
      sourceInstanceId: req.fromInstanceId,
      lastStarted: 0
    }
    await writeMeta(dir, meta)

    const majors = await serverJavaMajors(req.mcVersion)
    const java = req.loader === 'forge' || req.loader === 'neoforge' ? await resolveJava(majors, undefined, true, task) : null

    let loaderVersion = req.loaderVersion
    if (loaderVersion == null && (req.loader === 'forge' || req.loader === 'neoforge')) {
      loaderVersion = (await loaderVersionsForServer(req.loader, req.mcVersion))[0] ?? null
      if (!loaderVersion) throw new Error(`Nenhuma versão de ${req.loader} para ${req.mcVersion}`)
    }
    if (req.loader === 'vanilla') await installVanilla(dir, req.mcVersion, task)
    else if (req.loader === 'fabric') loaderVersion = await installFabric(dir, req.mcVersion, req.loaderVersion, task)
    else if (req.loader === 'forge') await installForge(dir, req.mcVersion, loaderVersion!, java!.path, task)
    else if (req.loader === 'neoforge') await installNeoForge(dir, loaderVersion!, java!.path, task)

    await cloneFromInstance(dir, req, task)

    const props: ServerProps = { ...DEFAULT_PROPS, onlineMode: req.onlineMode, motd: `${req.name} · Lumen` }
    await writeProps(dir, props)

    meta.loaderVersion = loaderVersion
    meta.ready = true
    await writeMeta(dir, meta)
    serverEvents.emit('changed')
    return getServer(id)
  })
}

export async function loaderVersionsForServer(loader: LoaderId, mc: string): Promise<string[]> {
  if (loader === 'vanilla') return []
  if (loader === 'fabric') {
    const list = await getJson<{ loader: { version: string; stable: boolean } }[]>(`https://meta.fabricmc.net/v2/versions/loader/${mc}`).catch(() => [])
    return list.map((l) => l.loader.version)
  }
  if (loader === 'neoforge') return (await listVersions(LOADER_UIDS.neoforge)).filter((v) => v.version.startsWith(mcToNeo(mc))).map((v) => v.version)
  return (await listLoaderVersions(LOADER_UIDS[loader as 'forge'], mc)).map((v) => v.version)
}

// NeoForge versions look like 21.1.x for MC 1.21.1 → prefix "<minor>.<patch>".
function mcToNeo(mc: string): string {
  const m = mc.match(/^1\.(\d+)(?:\.(\d+))?/)
  return m ? `${m[1]}.${m[2] ?? '0'}` : ''
}

export function netInfo(): NetInfo {
  const ips: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address)
    }
  }
  return { lanIps: ips }
}
