// In-memory backend used only when the renderer runs in a plain browser (UI preview).
// Modrinth calls go to the real public API, everything else is simulated.

import type { Account, ContentItem, GameState, Instance, LogLine, MetaVersion, Settings, TaskInfo } from '@shared/types'

type Listener = (...args: unknown[]) => void
const listeners = new Map<string, Set<Listener>>()
const emit = (ch: string, ...args: unknown[]): void => listeners.get(ch)?.forEach((l) => l(...args))

const now = Date.now()
const H = 3600 * 1000
const base = { overrideMemory: false, minMem: 512, maxMem: 4096, overrideJava: false, javaPath: '', overrideJvmArgs: false, jvmArgs: '', overrideWindow: false, width: 1280, height: 720, maximized: false }

function inst(id: string, name: string, loader: Instance['loader'], mc: string, lv: string | null, icon: string, played: number, last: number, group: string | null): Instance {
  return {
    id, name, group, iconKey: icon, iconUrl: null, mcVersion: mc, loader, loaderVersion: lv, components: [{ uid: 'net.minecraft', version: mc, cachedName: 'Minecraft' }],
    lastLaunch: last, totalPlayed: played, notes: '', managedPack: null, settings: { ...base }, accountId: null, dir: `C:\\instances\\${id}`, gameDir: `C:\\instances\\${id}\\minecraft`
  }
}

let instances: Instance[] = [
  inst('Dontcry (Official)', 'Dontcry (Official)', 'forge', '1.20.1', '47.4.10', 'glass:flame', 3 * 3600 + 1200, now - 2 * H, 'Modpacks'),
  inst('Survival', 'Survival 1.21', 'fabric', '1.21.1', '0.16.9', 'glass:grass', 26 * 3600, now - 26 * H, null),
  inst('Create', 'Create: Above & Beyond', 'forge', '1.18.2', '40.2.0', 'glass:hammer', 11 * 3600, now - 5 * 24 * H, 'Modpacks'),
  inst('Snapshots', 'Snapshot Testing', 'vanilla', '26.4-snapshot-5', null, 'glass:flask', 1800, now - 9 * 24 * H, null),
  inst('Skyblock', 'Skyblock', 'fabric', '1.20.4', '0.15.11', 'glass:sun', 7 * 3600, now - 40 * 24 * H, 'Mapas'),
  inst('Hardcore', 'Hardcore', 'neoforge', '1.21.1', '21.1.77', 'glass:skull', 52 * 3600, 0, null)
]
instances[0].managedPack = { type: 'flame', id: '1582600', name: 'Dontcry (Official)', versionId: '9227019', versionName: '1.0.4' }

let accounts: Account[] = [{ id: 'a1', type: 'msa', name: 'Steve', uuid: '8667ba71b85a4004af54457a9734eed7', skinUrl: null, active: true, status: 'ok' }]

let settings: Settings = {
  theme: 'auto', windowMaterial: 'wallpaper', shareWithPrism: false, accent: 'blue', wallpaper: 'sequoia', customWallpaper: null, refraction: true, reduceTransparency: false, animatedWallpaper: true,
  instancesDir: 'C:\\Users\\voce\\AppData\\Roaming\\PrismaLauncher\\instances', javaPath: '', autoJava: true, minMem: 512, maxMem: 4096, jvmArgs: '',
  width: 1280, height: 720, maximized: false, onLaunch: 'keep', showConsoleOnLaunch: false, msaClientId: 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb', curseforgeApiKey: '', concurrentDownloads: 16, sort: 'lastPlayed', view: 'grid'
}

const mcVersions: MetaVersion[] = [
  ['26.4-snapshot-5', 'snapshot'], ['1.21.10', 'release'], ['1.21.8', 'release'], ['1.21.4', 'release'], ['1.21.1', 'release'], ['1.20.6', 'release'], ['1.20.4', 'release'],
  ['1.20.1', 'release'], ['1.19.4', 'release'], ['1.18.2', 'release'], ['1.16.5', 'release'], ['1.12.2', 'release'], ['1.8.9', 'release'], ['1.7.10', 'release'], ['b1.7.3', 'old_beta'], ['a1.2.6', 'old_alpha']
].map(([version, type], i) => ({ version, type, releaseTime: new Date(now - i * 60 * 24 * H).toISOString(), recommended: version === '1.21.10' }))

const games: Record<string, GameState> = {}
const logs: Record<string, LogLine[]> = {}

const mods: ContentItem[] = ['Sodium', 'Lithium', 'Iris Shaders', 'Fabric API', 'Mod Menu', 'Xaero\'s Minimap', 'JEI', 'Create', 'Better Fog'].map((name, i) => ({
  file: `${name.toLowerCase().replace(/\W+/g, '-')}.jar${i === 4 ? '.disabled' : ''}`, kind: 'mods', enabled: i !== 4, name, version: `${1 + (i % 3)}.${i}.0`,
  description: ['Renderização moderna e muito mais rápida', 'Otimizações gerais do servidor', 'Shaders com compatibilidade OptiFine', 'Biblioteca base para mods Fabric', 'Menu de mods no jogo', 'Minimapa', 'Ver receitas', 'Engenhocas e automação', 'Neblina mais bonita'][i],
  authors: [], iconUrl: null, size: 300_000 + i * 120_000, mtime: now, modrinthId: i < 3 ? 'x' : null
}))

function runTask(title: string, instanceId: string | undefined, steps: string[], then: () => void): void {
  const t: TaskInfo = { id: `m${Math.random()}`, title, detail: steps[0], progress: 0, state: 'running', instanceId, startedAt: Date.now() }
  let p = 0
  const tick = setInterval(() => {
    p += 0.07
    t.progress = Math.min(1, p)
    t.detail = steps[Math.min(steps.length - 1, Math.floor(p * steps.length))]
    emit('tasks:update', { ...t })
    if (p >= 1) {
      clearInterval(tick)
      t.state = 'done'
      emit('tasks:update', { ...t })
      then()
    }
  }, 160)
}

const MR = 'https://api.modrinth.com/v2'

const handlers: Record<string, (...a: never[]) => unknown> = {
  'app:info': () => ({ version: '1.0.0', platform: 'win32', dataDir: 'C:\\Users\\voce\\AppData\\Roaming\\PrismaLauncher', prismDataDir: 'C:\\Users\\voce\\AppData\\Roaming\\PrismLauncher', isMaximized: false, totalMemoryMb: 16384, supportsMaterial: false }),
  'settings:get': () => settings,
  'settings:set': (p: Partial<Settings>) => {
    settings = { ...settings, ...p }
    return settings
  },
  'instances:list': () => instances,
  'instances:get': (id: string) => instances.find((i) => i.id === id),
  'instances:groups': () => [...new Set(instances.map((i) => i.group).filter(Boolean))],
  'instances:create': (r: { name: string; mcVersion: string; loader: Instance['loader']; loaderVersion: string | null; iconKey: string; group: string | null }) => {
    const i = inst(r.name, r.name, r.loader, r.mcVersion, r.loaderVersion, r.iconKey, 0, 0, r.group)
    instances = [...instances, i]
    setTimeout(() => emit('instances:changed'), 10)
    return i
  },
  'instances:update': (id: string, patch: Partial<Instance>) => {
    instances = instances.map((i) => (i.id === id ? { ...i, ...patch, settings: { ...i.settings, ...(patch.settings ?? {}) } } : i))
    setTimeout(() => emit('instances:changed'), 10)
    return instances.find((i) => i.id === id)
  },
  'instances:delete': (id: string) => {
    instances = instances.filter((i) => i.id !== id)
    setTimeout(() => emit('instances:changed'), 10)
  },
  'meta:versions': () => mcVersions,
  'meta:loaderVersions': () => ['0.17.2', '0.16.14', '0.16.9', '0.15.11'].map((version, i) => ({ version, releaseTime: '', recommended: i === 0 })),
  'game:states': () => Object.values(games),
  'game:logs': (id: string) => logs[id] ?? [],
  'game:launch': (id: string) => {
    games[id] = { instanceId: id, state: 'launching', startedAt: Date.now() }
    emit('game:state', games[id])
    runTask(`Iniciando ${id}`, id, ['Resolvendo componentes…', 'Baixando bibliotecas (40/120)', 'Baixando assets (2311/4012)', 'Extraindo nativos…', 'Abrindo o Minecraft…'], () => {
      games[id] = { ...games[id], state: 'running', startedAt: Date.now() }
      emit('game:state', games[id])
      const lines: LogLine[] = ['[12:00:01] [main/INFO]: Loading Minecraft 1.20.1 with Fabric Loader 0.16.9', '[12:00:02] [main/WARN]: Mod sodium uses deprecated API', '[12:00:04] [Render thread/INFO]: Backend library: LWJGL version 3.3.1', '[12:00:05] [Render thread/ERROR]: Failed to load texture minecraft:missing'].map((text) => ({ t: Date.now(), level: /ERROR/.test(text) ? 'error' : /WARN/.test(text) ? 'warn' : 'info', text }))
      logs[id] = [...(logs[id] ?? []), ...lines]
      emit('game:log', id, lines)
    })
  },
  'game:kill': (id: string) => {
    if (games[id]) games[id] = { ...games[id], state: 'exited', exitCode: 0 }
    emit('game:state', games[id])
  },
  'tasks:list': () => [],
  'content:list': (_id: string, kind: string) => (kind === 'mods' ? mods : []),
  'content:worlds': () => [
    { folder: 'Novo Mundo', name: 'Novo Mundo', lastPlayed: now - 3 * H, size: 48_000_000, iconUrl: null },
    { folder: 'Creative', name: 'Criativo', lastPlayed: now - 80 * H, size: 12_000_000, iconUrl: null }
  ],
  'content:screenshots': () => [],
  'accounts:list': () => accounts,
  'accounts:setActive': (id: string) => {
    accounts = accounts.map((a) => ({ ...a, active: a.id === id }))
    setTimeout(() => emit('accounts:changed'), 10)
  },
  'accounts:loginMsa': () => {
    setTimeout(() => emit('accounts:login', { type: 'code', userCode: 'AB12-CD34', verificationUri: 'https://www.microsoft.com/link', expiresIn: 900 }), 600)
  },
  'accounts:cancelLogin': () => undefined,
  'java:list': () => [
    { path: 'C:\\Users\\voce\\AppData\\Roaming\\PrismaLauncher\\java\\java-runtime-gamma\\bin\\java.exe', version: '17.0.15', major: 17, arch: 'amd64', vendor: 'Microsoft', managed: true },
    { path: 'C:\\Program Files (x86)\\Common Files\\Oracle\\Java\\java8path\\java.exe', version: '1.8.0_501', major: 8, arch: 'x86', vendor: 'Oracle Corporation', managed: false }
  ],
  'mr:search': async (q: { query: string; projectType: string; loader?: string; gameVersion?: string; sort: string; offset: number; limit: number }) => {
    const facets = [[`project_type:${q.projectType}`]]
    if (q.loader) facets.push([`categories:${q.loader}`])
    if (q.gameVersion) facets.push([`versions:${q.gameVersion}`])
    const p = new URLSearchParams({ query: q.query, facets: JSON.stringify(facets), index: q.sort, offset: String(q.offset), limit: String(q.limit) })
    return (await fetch(`${MR}/search?${p}`)).json()
  },
  'mr:project': async (id: string) => (await fetch(`${MR}/project/${id}`)).json(),
  'mr:versions': async (id: string) => (await fetch(`${MR}/project/${id}/version`)).json(),
  'servers:list': () => [],
  'servers:states': () => [],
  'servers:net': () => ({ lanIps: ['192.168.0.10'] }),
  'servers:logs': () => [],
  'cf:search': () => ({ hits: [], totalCount: 0 }),
  'cf:files': () => [],
  'update:state': () => ({ state: 'disabled' })
}

export function installMock(): void {
  window.prisma = {
    async invoke(channel: string, ...args: unknown[]) {
      const h = handlers[channel]
      if (!h) return undefined
      return (h as (...a: unknown[]) => unknown)(...args)
    },
    on(channel: string, cb: (...a: never[]) => void) {
      const set = listeners.get(channel) ?? new Set()
      set.add(cb as Listener)
      listeners.set(channel, set)
      return () => set.delete(cb as Listener)
    },
    pathFor: (f: File) => f.name
  }
}
