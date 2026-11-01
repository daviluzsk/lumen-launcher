// Prepares and starts an instance: resolve components → pick Java → download libraries,
// client jar and assets → extract natives → build the command line → spawn and stream logs.

import { app, BrowserWindow } from 'electron'
import { type ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import path from 'path'
import type { GameState, Instance, JavaInstall, LogLevel, LogLine } from '@shared/types'
import { getLaunchSession, type LaunchSession } from '../auth/accounts'
import { checkJava, launcherExe, resolveJava } from '../java/java'
import { downloadAll, downloadFile, type DownloadItem } from '../net/download'
import { getInstance, recordPlaytime } from '../instances/instances'
import { paths } from '../paths'
import { getSettings } from '../settings'
import { runTask, type Task } from '../tasks'
import { ensureDir, exists, writeFileAtomic } from '../util/fsx'
import { extract } from '../util/zip'
import { buildProfile, type LaunchProfile, libraryFiles } from './profile'

export const gameEvents = new EventEmitter()

interface Running {
  child: ChildProcess | null
  state: GameState
  logs: LogLine[]
  pending: LogLine[]
  killed: boolean
}

const games = new Map<string, Running>()
const MAX_LOG = 12000

function pushLog(r: Running, level: LogLevel, text: string): void {
  const line = { t: Date.now(), level, text }
  r.logs.push(line)
  if (r.logs.length > MAX_LOG) r.logs.splice(0, r.logs.length - MAX_LOG)
  r.pending.push(line)
}

setInterval(() => {
  for (const [id, r] of games) {
    if (!r.pending.length) continue
    gameEvents.emit('log', id, r.pending)
    r.pending = []
  }
}, 150)

function setState(r: Running, patch: Partial<GameState>): void {
  Object.assign(r.state, patch)
  gameEvents.emit('state', { ...r.state })
}

export const gameStates = (): GameState[] => [...games.values()].map((r) => ({ ...r.state }))
export const gameLogs = (id: string): LogLine[] => games.get(id)?.logs ?? []

export function killGame(id: string): void {
  const r = games.get(id)
  if (r?.child && r.child.exitCode === null) {
    r.killed = true
    r.child.kill()
  }
}

function classify(text: string, stderr: boolean): LogLevel {
  const m = text.match(/\/(FATAL|ERROR|WARN|INFO|DEBUG|TRACE)\]/) ?? text.match(/\[(FATAL|ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\]/)
  const lvl = m?.[1]
  if (lvl === 'FATAL' || lvl === 'ERROR') return 'error'
  if (lvl === 'WARN' || lvl === 'WARNING') return 'warn'
  if (lvl === 'DEBUG' || lvl === 'TRACE') return 'debug'
  if (lvl === 'INFO') return 'info'
  // Stack traces only — installer output lists plenty of "*Exception.class" names that are fine.
  if (/^\s+at [\w$.<>/]+\(|^Caused by: |^Exception in thread|^[\w$.]+(?:Exception|Error)(?::|$)|^\s*\.\.\. \d+ more/.test(text)) return 'error'
  return stderr ? 'warn' : 'info'
}

function splitArgs(s: string): string[] {
  return (s.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"(.*)"$/, '$1'))
}

interface Prepared {
  classpath: string[]
  nativesDir: string
  mainJarPath: string | null
  installerPath: string | null
  agents: string[]
  assetsRoot: string
  gameAssets: string
}

async function prepareAssets(profile: LaunchProfile, gameDir: string, task: Task): Promise<{ root: string; virtual: string }> {
  const ref = profile.assetIndex
  if (!ref) return { root: paths.assets, virtual: paths.assets }
  const idxPath = path.join(paths.assets, 'indexes', `${ref.id}.json`)
  task.update('Baixando índice de assets…', null)
  await downloadFile(ref.url, idxPath, ref.sha1)
  const idx = JSON.parse(await fs.readFile(idxPath, 'utf8')) as {
    objects: Record<string, { hash: string; size: number }>
    virtual?: boolean
    map_to_resources?: boolean
  }
  const objectPath = (hash: string): string => path.join(paths.assets, 'objects', hash.slice(0, 2), hash)
  const items: DownloadItem[] = Object.values(idx.objects).map((o) => ({
    url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`,
    path: objectPath(o.hash),
    sha1: o.hash,
    size: o.size
  }))
  await downloadAll(items, (p) => task.update(`Baixando assets (${p.done}/${p.total})`, p.total ? p.done / p.total : 1))

  if (idx.virtual || idx.map_to_resources) {
    // Pre-1.7 versions read assets by name instead of hash.
    const target = idx.map_to_resources ? path.join(gameDir, 'resources') : path.join(paths.assets, 'virtual', ref.id)
    task.update('Organizando assets legados…', null)
    for (const [name, o] of Object.entries(idx.objects)) {
      const dest = path.join(target, name)
      if (await exists(dest)) continue
      await ensureDir(path.dirname(dest))
      await fs.copyFile(objectPath(o.hash), dest)
    }
    return { root: idx.map_to_resources ? paths.assets : target, virtual: target }
  }
  return { root: paths.assets, virtual: path.join(paths.assets, 'virtual', ref.id) }
}

async function prepareFiles(inst: Instance, profile: LaunchProfile, task: Task): Promise<Prepared> {
  const classpath: string[] = []
  const natives: { path: string; exclude?: string[] }[] = []
  const downloads: DownloadItem[] = []
  const missingLocal: string[] = []

  const want = (f: ReturnType<typeof libraryFiles>[number]): void => {
    if (f.url) downloads.push({ url: f.url, path: f.path, sha1: f.sha1, size: f.size })
    else missingLocal.push(f.path)
  }

  for (const lib of profile.libraries) for (const f of libraryFiles(lib, inst.dir)) {
    want(f)
    if (f.native) natives.push(f)
    else classpath.push(f.path)
  }
  let mainJarPath: string | null = null
  if (profile.mainJar) {
    for (const f of libraryFiles(profile.mainJar, inst.dir)) {
      want(f)
      mainJarPath = f.path
      classpath.push(f.path)
    }
  }
  for (const lib of profile.nativeLibraries) for (const f of libraryFiles(lib, inst.dir)) {
    want(f)
    natives.push(f)
  }
  let installerPath: string | null = null
  for (const lib of profile.mavenFiles) for (const f of libraryFiles(lib, inst.dir)) {
    want(f)
    if (lib.name.endsWith(':installer')) installerPath = f.path
  }
  const agents: string[] = []
  for (const a of profile.agents) for (const f of libraryFiles(a.lib, inst.dir)) {
    want(f)
    agents.push(`-javaagent:${f.path}${a.argument ? `=${a.argument}` : ''}`)
  }

  for (const p of missingLocal) if (!(await exists(p))) throw new Error(`Biblioteca local ausente: ${path.basename(p)}`)

  await downloadAll(downloads, (p) => task.update(`Baixando bibliotecas (${p.done}/${p.total})`, p.total ? p.done / p.total : 1))

  const nativesDir = path.join(inst.dir, 'natives')
  await fs.rm(nativesDir, { recursive: true, force: true })
  await ensureDir(nativesDir)
  if (natives.length) task.update('Extraindo nativos…', null)
  for (const n of natives) {
    const excludes = ['META-INF/', ...(n.exclude ?? [])]
    await extract(n.path, nativesDir, (name) => (excludes.some((e) => name.startsWith(e)) ? null : name))
  }

  const assets = await prepareAssets(profile, inst.gameDir, task)
  return { classpath, nativesDir, mainJarPath, installerPath, agents, assetsRoot: assets.root, gameAssets: assets.virtual }
}

function buildCommand(inst: Instance, profile: LaunchProfile, prep: Prepared, session: LaunchSession, java: JavaInstall): { jvm: string[]; game: string[] } {
  const s = getSettings()
  const mem = inst.settings.overrideMemory ? inst.settings : s
  const min = Math.min(mem.minMem, mem.maxMem)
  const max = Math.max(mem.minMem, mem.maxMem)
  const jvm: string[] = [
    '-Duser.language=en',
    `-Xms${min}m`,
    `-Xmx${max}m`,
    '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump',
    `-Djava.library.path=${prep.nativesDir}`,
    '-Dminecraft.launcher.brand=prisma',
    `-Dminecraft.launcher.version=${app.getVersion()}`
  ]
  if (java.major <= 7) jvm.push('-XX:PermSize=128m')
  if (profile.mainClass.startsWith('io.github.zekerzhayard.forgewrapper')) {
    jvm.push(`-Dforgewrapper.librariesDir=${paths.libraries}`)
    if (prep.installerPath) jvm.push(`-Dforgewrapper.installer=${prep.installerPath}`)
    if (prep.mainJarPath) jvm.push(`-Dforgewrapper.minecraft=${prep.mainJarPath}`)
  }
  jvm.push(...profile.jvmArgs, ...prep.agents)
  jvm.push(...splitArgs(inst.settings.overrideJvmArgs ? inst.settings.jvmArgs : s.jvmArgs))

  const tokens: Record<string, string> = {
    auth_player_name: session.name,
    auth_session: `token:${session.accessToken}:${session.uuid}`,
    auth_access_token: session.accessToken,
    auth_uuid: session.uuid,
    auth_xuid: '0',
    clientid: '',
    user_type: session.userType,
    user_properties: '{}',
    version_name: profile.mcVersion,
    version_type: 'release',
    game_directory: inst.gameDir,
    assets_root: prep.assetsRoot,
    game_assets: prep.gameAssets,
    assets_index_name: profile.assetIndex?.id ?? 'legacy',
    profile_name: inst.name
  }
  const game = profile.minecraftArguments
    .split(' ')
    .filter(Boolean)
    .map((a) => a.replace(/\$\{([a-z_]+)\}/g, (m, k: string) => tokens[k] ?? m))
  for (const t of profile.tweakers) game.push('--tweakClass', t)
  const win = inst.settings.overrideWindow ? inst.settings : s
  if (!game.includes('--width') && !win.maximized) game.push('--width', String(win.width), '--height', String(win.height))
  return { jvm, game }
}

function cleanEnv(inst: Instance, java: JavaInstall): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of ['JAVA_ARGS', 'CLASSPATH', 'CONFIGPATH', 'JAVA_HOME', 'JRE_HOME', '_JAVA_OPTIONS', 'JAVA_OPTIONS', 'JAVA_TOOL_OPTIONS']) delete env[k]
  return { ...env, INST_NAME: inst.name, INST_ID: inst.id, INST_DIR: inst.dir, INST_MC_DIR: inst.gameDir, INST_JAVA: java.path, NO_COLOR: '1' }
}

export async function launchInstance(id: string): Promise<void> {
  const prev = games.get(id)
  if (prev && prev.state.state !== 'exited') throw new Error('Esta instância já está em execução')
  const r: Running = { child: null, state: { instanceId: id, state: 'launching', startedAt: Date.now() }, logs: [], pending: [], killed: false }
  games.set(id, r)
  setState(r, {})
  const log = (text: string, level: LogLevel = 'launcher'): void => pushLog(r, level, text)

  try {
    const inst = await getInstance(id)
    log(`Lumen ${app.getVersion()} — preparando "${inst.name}"`)
    await runTask(`Iniciando ${inst.name}`, async (task) => {
      task.update('Resolvendo componentes…', null)
      const profile = await buildProfile(inst.components)
      log(`Componentes: ${profile.components.map((c) => `${c.name} ${c.version}`).join(', ')}`)
      if (profile.hasJarMods) throw new Error('Esta instância usa "jar mods", que o Lumen ainda não suporta.')

      task.update('Verificando conta…', null)
      const session = await getLaunchSession(inst.accountId)
      log(`Conta: ${session.name} (${session.userType === 'msa' ? 'Microsoft' : 'offline'})`)

      const s = getSettings()
      const manual = inst.settings.overrideJava ? inst.settings.javaPath : !s.autoJava ? s.javaPath : ''
      let java: JavaInstall
      if (manual) {
        const checked = await checkJava(manual)
        if (!checked) throw new Error(`Java inválido: ${manual}`)
        java = checked
      } else {
        java = await resolveJava(profile.javaMajors, profile.javaName, true, task)
      }
      if (profile.javaMajors.length && !profile.javaMajors.includes(java.major)) {
        log(`Aviso: Minecraft ${profile.mcVersion} espera Java ${profile.javaMajors.join('/')}, usando Java ${java.major}`, 'warn')
      }
      log(`Java ${java.version} (${java.arch}) — ${java.path}`)

      await ensureDir(inst.gameDir)
      const prep = await prepareFiles(inst, profile, task)
      const { jvm, game } = buildCommand(inst, profile, prep, session, java)

      // Windows caps command lines at 32k chars; Java 9+ accepts an @argfile instead.
      let cpArgs = ['-cp', prep.classpath.join(path.delimiter)]
      if (cpArgs[1].length > 24000 && java.major >= 9) {
        const argfile = path.join(inst.dir, '.prisma-classpath.txt')
        await writeFileAtomic(argfile, `-cp "${cpArgs[1].replace(/\\/g, '/')}"\n`)
        cpArgs = [`@${argfile}`]
      }
      const args = [...jvm, ...cpArgs, profile.mainClass, ...game]
      log(`Classe principal: ${profile.mainClass}`)
      log(`Argumentos: ${game.map((a, i) => (game[i - 1] === '--accessToken' ? '<oculto>' : a)).join(' ')}`)

      task.update('Abrindo o Minecraft…', null)
      const child = spawn(launcherExe(java.path), args, { cwd: inst.gameDir, env: cleanEnv(inst, java), windowsHide: false })
      r.child = child
      r.state.startedAt = Date.now()
      const pipe = (stream: NodeJS.ReadableStream | null, stderr: boolean): void => {
        let buf = ''
        stream?.setEncoding('utf8')
        stream?.on('data', (chunk: string) => {
          buf += chunk
          const lines = buf.split(/\r?\n/)
          buf = lines.pop() ?? ''
          for (const l of lines) if (l.length) pushLog(r, classify(l, stderr), l)
        })
      }
      pipe(child.stdout, false)
      pipe(child.stderr, true)
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve())
        child.once('error', reject)
      })
      setState(r, { state: 'running' })
      log('Jogo iniciado.')
      afterLaunch(s.onLaunch)

      child.once('exit', (code) => {
        const crashed = !r.killed && code !== 0
        log(r.killed ? 'Jogo encerrado pelo usuário.' : `O jogo foi fechado (código ${code}).`, crashed ? 'error' : 'launcher')
        setState(r, { state: 'exited', exitCode: code, crashed })
        void recordPlaytime(id, r.state.startedAt).catch(() => undefined)
        restoreWindow(crashed)
      })
    }, id)
  } catch (e) {
    log(`Erro: ${(e as Error).message}`, 'error')
    setState(r, { state: 'exited', exitCode: null, crashed: true })
    throw e
  }
}

function afterLaunch(mode: 'keep' | 'minimize' | 'hide'): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (mode === 'minimize') win.minimize()
  if (mode === 'hide') win.hide()
}

function restoreWindow(crashed: boolean): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  const anyRunning = [...games.values()].some((g) => g.state.state === 'running')
  if (!win.isVisible() && (!anyRunning || crashed)) win.show()
  if (crashed) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
}
