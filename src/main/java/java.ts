// Java discovery, validation and automatic download of the runtimes Mojang/Prism publish.

import { execFile } from 'child_process'
import { app } from 'electron'
import { existsSync, promises as fs } from 'fs'
import path from 'path'
import type { JavaInstall } from '@shared/types'
import { downloadAll, downloadFile } from '../net/download'
import { getJson } from '../net/http'
import { paths, prismDataDir } from '../paths'
import type { Task } from '../tasks'
import { ensureDir, hashFile } from '../util/fsx'
import { extract } from '../util/zip'
import { getVersionFile } from '../minecraft/meta'

function run(file: string, args: string[], timeout = 10000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) =>
    execFile(file, args, { timeout, windowsHide: true }, (_err, stdout, stderr) => resolve({ stdout: String(stdout), stderr: String(stderr) }))
  )
}

export function majorOf(version: string): number {
  const m = version.match(/^(\d+)(?:\.(\d+))?/)
  if (!m) return 0
  const first = parseInt(m[1], 10)
  return first === 1 && m[2] ? parseInt(m[2], 10) : first
}

const checked = new Map<string, JavaInstall | null>()

/** Equivalent of Prism's JavaCheck: ask the JVM for its properties. */
export async function checkJava(javaPath: string): Promise<JavaInstall | null> {
  const exe = javaPath.replace(/javaw\.exe$/i, 'java.exe')
  if (checked.has(exe)) return checked.get(exe)!
  if (!existsSync(exe)) return null
  const { stderr, stdout } = await run(exe, ['-XshowSettings:properties', '-version'])
  const out = stderr + stdout
  const prop = (k: string): string => out.match(new RegExp(`^\\s*${k.replace('.', '\\.')} = (.*)$`, 'm'))?.[1]?.trim() ?? ''
  const version = prop('java.version')
  if (!version) {
    checked.set(exe, null)
    return null
  }
  const install: JavaInstall = {
    path: exe,
    version,
    major: majorOf(version),
    arch: prop('os.arch'),
    vendor: prop('java.vendor') || prop('java.vm.vendor'),
    managed: exe.toLowerCase().startsWith(paths.java.toLowerCase())
  }
  checked.set(exe, install)
  return install
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name))
  } catch {
    return []
  }
}

async function registryHomes(): Promise<string[]> {
  const keys = [
    'HKLM\\SOFTWARE\\JavaSoft',
    'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft',
    'HKLM\\SOFTWARE\\Eclipse Adoptium',
    'HKLM\\SOFTWARE\\Eclipse Foundation',
    'HKLM\\SOFTWARE\\Azul Systems\\Zulu',
    'HKLM\\SOFTWARE\\Microsoft\\JDK',
    'HKLM\\SOFTWARE\\BellSoft\\Liberica'
  ]
  const homes: string[] = []
  for (const key of keys) {
    const { stdout } = await run('reg', ['query', key, '/s'], 5000)
    for (const m of stdout.matchAll(/^\s+(?:JavaHome|InstallationPath|Path)\s+REG_SZ\s+(.+)$/gm)) homes.push(m[1].trim())
  }
  return homes
}

async function candidateHomes(): Promise<string[]> {
  const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[]
  const vendors = ['Java', 'Eclipse Adoptium', 'Eclipse Foundation', 'Zulu', 'Microsoft', 'BellSoft', 'Amazon Corretto', 'Semeru', 'GraalVM']
  const homes: string[] = []
  for (const p of pf) for (const v of vendors) homes.push(...(await subdirs(path.join(p, v))))
  homes.push(...(await subdirs(paths.java)))
  const prism = prismDataDir()
  if (prism) homes.push(...(await subdirs(path.join(prism, 'java'))))
  // Official launcher runtimes (classic and Microsoft Store).
  const mcRuntime = path.join(app.getPath('appData'), '.minecraft', 'runtime')
  for (const comp of await subdirs(mcRuntime)) for (const plat of await subdirs(comp)) homes.push(...(await subdirs(plat)))
  const pkgs = path.join(process.env['LOCALAPPDATA'] ?? '', 'Packages')
  for (const pkg of (await subdirs(pkgs)).filter((p) => /Microsoft\.4297127D64EC6/i.test(p))) {
    const rt = path.join(pkg, 'LocalCache', 'Local', 'runtime')
    for (const comp of await subdirs(rt)) for (const plat of await subdirs(comp)) homes.push(...(await subdirs(plat)))
  }
  if (process.env['JAVA_HOME']) homes.push(process.env['JAVA_HOME'])
  homes.push(...(await registryHomes()))
  return homes
}

let cache: JavaInstall[] | null = null

export async function detectJava(force = false): Promise<JavaInstall[]> {
  if (cache && !force) return cache
  if (force) checked.clear()
  const exes = new Set<string>()
  for (const home of await candidateHomes()) {
    const exe = path.join(home, 'bin', 'java.exe')
    if (existsSync(exe)) exes.add(path.normalize(exe))
  }
  const { stdout } = await run('where', ['java'], 4000)
  for (const line of stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) exes.add(path.normalize(line))
  const found = (await Promise.all([...exes].map(checkJava))).filter((j): j is JavaInstall => !!j)
  const byPath = new Map(found.map((j) => [j.path.toLowerCase(), j]))
  cache = [...byPath.values()].sort((a, b) => b.major - a.major || a.path.localeCompare(b.path))
  return cache
}

/** javaw.exe avoids an extra console window for the game. */
export function launcherExe(javaExe: string): string {
  const w = javaExe.replace(/java\.exe$/i, 'javaw.exe')
  return existsSync(w) ? w : javaExe
}

const RUNTIME_OS = process.arch === 'arm64' ? 'windows-arm64' : process.arch === 'ia32' ? 'windows-x86' : 'windows-x64'

interface MetaRuntime {
  name: string
  runtimeOS: string
  vendor: string
  downloadType: 'manifest' | 'archive'
  url: string
  checksum: { type: string; hash: string }
  version: { major: number; name?: string }
}

interface MojangManifest {
  files: Record<string, { type: 'file' | 'directory' | 'link'; executable?: boolean; downloads?: { raw: { url: string; sha1: string; size: number } } }>
}

/** Downloads a runtime of the requested major version into <data>/java (Prism's layout). */
export async function downloadJava(major: number, preferredName: string | undefined, task: Task): Promise<JavaInstall> {
  task.update(`Procurando Java ${major}…`, null)
  const meta = (await getVersionFile('net.minecraft.java', `java${major}`)) as unknown as { runtimes: MetaRuntime[] }
  const options = meta.runtimes.filter((r) => r.runtimeOS === RUNTIME_OS && r.version.major === major)
  const score = (r: MetaRuntime): number =>
    (r.vendor === 'mojang' ? 4 : r.vendor === 'azul' ? 2 : 1) + (r.name === preferredName ? 8 : 0) + (r.downloadType === 'manifest' ? 1 : 0)
  const pick = options.sort((a, b) => score(b) - score(a))[0]
  if (!pick) throw new Error(`Nenhum Java ${major} disponível para ${RUNTIME_OS}`)

  const dirName = pick.vendor === 'mojang' ? pick.name : `${pick.vendor}-${major}`
  const home = path.join(paths.java, dirName)
  await ensureDir(home)

  if (pick.downloadType === 'manifest') {
    const manifest = await getJson<MojangManifest>(pick.url)
    const items = Object.entries(manifest.files)
      .filter(([, f]) => f.type === 'file' && f.downloads)
      .map(([rel, f]) => ({ url: f.downloads!.raw.url, path: path.join(home, rel), sha1: f.downloads!.raw.sha1, size: f.downloads!.raw.size }))
    await downloadAll(items, (p) => task.update(`Baixando Java ${major} (${p.done}/${p.total})`, p.total ? p.done / p.total : null))
  } else {
    const zip = path.join(paths.cache, path.basename(new URL(pick.url).pathname))
    task.update(`Baixando Java ${major}…`, null)
    await downloadFile(pick.url, zip)
    if (pick.checksum.type === 'sha256' && (await hashFile(zip, 'sha256')) !== pick.checksum.hash) {
      await fs.rm(zip, { force: true })
      throw new Error('Checksum do Java inválido')
    }
    task.update(`Extraindo Java ${major}…`, null)
    // Archives wrap everything in a single top-level folder; strip it.
    await extract(zip, home, (n) => n.split('/').slice(1).join('/') || null)
    await fs.rm(zip, { force: true })
  }

  checked.clear()
  cache = null
  const install = await checkJava(path.join(home, 'bin', 'java.exe'))
  if (!install) throw new Error(`Java ${major} baixado, mas não pôde ser executado`)
  return install
}

/** Picks an installed Java matching one of the majors, downloading one if allowed. */
export async function resolveJava(majors: number[], preferredName: string | undefined, allowDownload: boolean, task: Task): Promise<JavaInstall> {
  const wanted = majors.length ? majors : [8]
  const installs = await detectJava()
  const is64 = (j: JavaInstall): boolean => /64/.test(j.arch)
  for (const major of wanted) {
    const match = installs.filter((j) => j.major === major).sort((a, b) => Number(is64(b)) - Number(is64(a)) || Number(b.managed) - Number(a.managed))[0]
    if (match) return match
  }
  if (!allowDownload) throw new Error(`Java ${wanted[0]} é necessário e não foi encontrado`)
  return downloadJava(wanted[0], preferredName, task)
}
