// Builds a launch profile out of an instance's component list, following the rules of
// Prism Launcher's PackProfile/LaunchProfile: components are applied in `order`, later
// components override main class / arguments, and libraries are de-duplicated by
// group:artifact:classifier keeping the highest version.

import path from 'path'
import type { Component, Requirement } from '@shared/types'
import { paths } from '../paths'
import { compareVersions } from '../util/version'
import { type AssetIndexRef, type Library, type VersionFile, getIndex, getVersionFile } from './meta'

const OS = 'windows'
const ARCH = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'arm64' : 'x86'
const LEGACY_ARCH = ARCH === 'x86_64' || ARCH === 'x86'

/** RuntimeContext::classifierMatches — "windows-arm64" style first, plain "windows" on x86/x64. */
export function classifierMatches(target: string): boolean {
  return target === `${OS}-${ARCH}` || (LEGACY_ARCH && target === OS)
}

export function libraryAllowed(lib: Pick<Library, 'rules'>): boolean {
  if (!lib.rules?.length) return true
  let result: 'allow' | 'disallow' = 'disallow'
  for (const rule of lib.rules) {
    if (rule.os?.name && !classifierMatches(rule.os.name)) continue
    result = rule.action
  }
  return result === 'allow'
}

export interface Gradle {
  group: string
  artifact: string
  version: string
  classifier: string
  ext: string
}

export function parseGradle(name: string): Gradle {
  const [coords, ext = 'jar'] = name.split('@')
  const [group = '', artifact = '', version = '', classifier = ''] = coords.split(':')
  return { group, artifact, version, classifier, ext }
}

export function gradlePath(g: Gradle, classifier = g.classifier): string {
  const file = `${g.artifact}-${g.version}${classifier ? `-${classifier}` : ''}.${g.ext}`
  return [...g.group.split('.'), g.artifact, g.version, file].join('/')
}

const nameKey = (name: string): string => {
  const g = parseGradle(name)
  return `${g.group}:${g.artifact}:${g.classifier}`
}

export interface LibFile {
  path: string
  url: string | null
  sha1?: string
  size?: number
  native: boolean
  exclude?: string[]
}

/** Library::getApplicableFiles for a single library on this machine. */
export function libraryFiles(lib: Library, instanceDir: string): LibFile[] {
  if (!libraryAllowed(lib)) return []
  const g = parseGradle(lib.name)
  const base = (lib.url ?? 'https://libraries.minecraft.net/').replace(/\/?$/, '/')

  if (lib['MMC-hint'] === 'local') {
    const file = lib['MMC-filename'] ?? path.basename(gradlePath(g))
    return [{ path: path.join(instanceDir, 'libraries', file), url: null, native: false }]
  }

  if (lib.natives) {
    const key = Object.keys(lib.natives).find(classifierMatches)
    if (!key) return []
    const classifier = lib.natives[key].replace('${arch}', '64')
    const art = lib.downloads?.classifiers?.[classifier]
    const rel = gradlePath(g, classifier)
    return [
      {
        path: path.join(paths.libraries, rel),
        url: art?.url ?? base + rel,
        sha1: art?.sha1,
        size: art?.size,
        native: true,
        exclude: lib.extract?.exclude
      }
    ]
  }

  const rel = gradlePath(g)
  const art = lib.downloads?.artifact
  const url = lib['MMC-absoluteUrl'] ?? art?.url ?? base + rel
  return [{ path: path.join(paths.libraries, rel), url: url || null, sha1: art?.sha1, size: art?.size, native: false }]
}

export interface LaunchProfile {
  mcVersion: string
  mainClass: string
  appletClass?: string
  minecraftArguments: string
  tweakers: string[]
  traits: Set<string>
  jvmArgs: string[]
  libraries: Library[]
  nativeLibraries: Library[]
  mavenFiles: Library[]
  agents: { lib: Library; argument?: string }[]
  mainJar?: Library
  assetIndex?: AssetIndexRef
  javaMajors: number[]
  javaName?: string
  hasJarMods: boolean
  components: { uid: string; version: string; name: string }[]
}

function satisfies(req: Requirement | undefined, version: string): boolean {
  return !req?.equals || req.equals === version
}

/** Fills in missing component versions and pulls in dependencies (ComponentUpdateTask). */
async function resolveVersions(input: Component[]): Promise<{ uid: string; version: string; file: VersionFile }[]> {
  const list = input.filter((c) => !c.disabled).map((c) => ({ uid: c.uid, version: c.version }))
  const resolved = new Map<string, VersionFile>()

  for (let guard = 0; guard < 12; guard++) {
    let changed = false
    for (const c of list) {
      if (resolved.has(c.uid)) continue
      if (!c.version) {
        const reqs = [...resolved.values()].flatMap((f) => f.requires ?? []).filter((r) => r.uid === c.uid)
        const pinned = reqs.find((r) => r.equals)?.equals ?? reqs.find((r) => r.suggests)?.suggests
        if (pinned) c.version = pinned
        else {
          // No explicit version: pick one whose own requirements match what we already have.
          const idx = await getIndex(c.uid)
          const pick =
            idx.versions.find((v) => v.recommended && (v.requires ?? []).every((r) => satisfies(r, versionOf(list, r.uid) ?? ''))) ??
            idx.versions.find((v) => (v.requires ?? []).every((r) => satisfies(r, versionOf(list, r.uid) ?? '')))
          if (!pick) throw new Error(`Nenhuma versão compatível de ${c.uid}`)
          c.version = pick.version
        }
      }
      resolved.set(c.uid, await getVersionFile(c.uid, c.version))
      changed = true
    }
    for (const file of [...resolved.values()]) {
      for (const req of file.requires ?? []) {
        if (!list.some((c) => c.uid === req.uid)) {
          list.push({ uid: req.uid, version: req.equals ?? req.suggests })
          changed = true
        }
      }
    }
    if (!changed) break
  }

  return list.map((c) => ({ uid: c.uid, version: c.version!, file: resolved.get(c.uid)! }))
}

function versionOf(list: { uid: string; version?: string }[], uid: string): string | undefined {
  return list.find((c) => c.uid === uid)?.version
}

export async function buildProfile(components: Component[]): Promise<LaunchProfile> {
  const resolved = await resolveVersions(components)
  const ordered = resolved
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => (a.file.order ?? 0) - (b.file.order ?? 0) || a.i - b.i)

  const profile: LaunchProfile = {
    mcVersion: resolved.find((r) => r.uid === 'net.minecraft')?.version ?? '',
    mainClass: '',
    minecraftArguments: '',
    tweakers: [],
    traits: new Set(),
    jvmArgs: [],
    libraries: [],
    nativeLibraries: [],
    mavenFiles: [],
    agents: [],
    javaMajors: [],
    hasJarMods: false,
    components: ordered.map((r) => ({ uid: r.uid, version: r.version, name: r.file.name }))
  }

  const applyLibrary = (lib: Library): void => {
    if (!libraryAllowed(lib)) return
    const list = lib.natives ? profile.nativeLibraries : profile.libraries
    const key = nameKey(lib.name)
    const idx = list.findIndex((l) => nameKey(l.name) === key)
    if (idx < 0) list.push(lib)
    else if (compareVersions(parseGradle(lib.name).version, parseGradle(list[idx].name).version) > 0) list[idx] = lib
  }

  for (const { file } of ordered) {
    if (file.mainClass) profile.mainClass = file.mainClass
    if (file.appletClass) profile.appletClass = file.appletClass
    if (file.minecraftArguments) profile.minecraftArguments = file.minecraftArguments
    if (file.mainJar) profile.mainJar = file.mainJar
    if (file.assetIndex) profile.assetIndex = file.assetIndex
    if (file.compatibleJavaMajors?.length) profile.javaMajors = file.compatibleJavaMajors
    if (file.compatibleJavaName) profile.javaName = file.compatibleJavaName
    for (const t of file['+tweakers'] ?? []) profile.tweakers.push(t)
    for (const t of file['+traits'] ?? []) profile.traits.add(t)
    for (const a of file['+jvmArgs'] ?? []) profile.jvmArgs.push(a)
    for (const lib of file.libraries ?? []) applyLibrary(lib)
    for (const lib of file.mavenFiles ?? []) if (libraryAllowed(lib) && !lib.natives) profile.mavenFiles.push(lib)
    for (const a of file['+agents'] ?? []) profile.agents.push({ lib: a as Library, argument: a.argument })
    if (file.jarMods?.length) profile.hasJarMods = true
  }

  if (!profile.mainClass) throw new Error('Perfil sem classe principal — verifique os componentes da instância.')
  return profile
}
