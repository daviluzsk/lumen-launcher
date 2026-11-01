// Types shared between the Electron main process and the renderer.
// The on-disk formats (instance.cfg, mmc-pack.json, instgroups.json) mirror Prism Launcher's,
// so instances created by either launcher can be opened by the other.

export type LoaderId = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export const LOADER_UIDS: Record<Exclude<LoaderId, 'vanilla'>, string> = {
  fabric: 'net.fabricmc.fabric-loader',
  quilt: 'org.quiltmc.quilt-loader',
  forge: 'net.minecraftforge',
  neoforge: 'net.neoforged'
}

export const LOADER_NAMES: Record<LoaderId, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

export interface Requirement {
  uid: string
  equals?: string
  suggests?: string
}

export interface Component {
  uid: string
  version?: string
  cachedName?: string
  cachedVersion?: string
  cachedRequires?: Requirement[]
  cachedVolatile?: boolean
  important?: boolean
  dependencyOnly?: boolean
  disabled?: boolean
}

export interface InstanceSettings {
  overrideMemory: boolean
  minMem: number
  maxMem: number
  overrideJava: boolean
  javaPath: string
  overrideJvmArgs: boolean
  jvmArgs: string
  overrideWindow: boolean
  width: number
  height: number
  maximized: boolean
}

export interface ManagedPack {
  type: string
  id: string
  name: string
  versionId: string
  versionName: string
}

export interface Instance {
  id: string
  name: string
  group: string | null
  iconKey: string
  iconUrl: string | null
  mcVersion: string | null
  loader: LoaderId
  loaderVersion: string | null
  components: Component[]
  lastLaunch: number
  totalPlayed: number
  notes: string
  managedPack: ManagedPack | null
  settings: InstanceSettings
  // Account pinned to this instance (id). null = use whichever account is active.
  accountId: string | null
  dir: string
  gameDir: string
}

export interface InstancePatch {
  name?: string
  group?: string | null
  iconKey?: string
  notes?: string
  accountId?: string | null
  settings?: Partial<InstanceSettings>
}

export interface NewInstanceRequest {
  name: string
  group: string | null
  iconKey: string
  mcVersion: string
  loader: LoaderId
  loaderVersion: string | null
}

export interface MetaVersion {
  version: string
  type?: string
  releaseTime: string
  recommended?: boolean
  requires?: Requirement[]
}

export type TaskState = 'running' | 'done' | 'error'

export interface TaskInfo {
  id: string
  title: string
  detail: string
  progress: number | null
  state: TaskState
  error?: string
  instanceId?: string
  startedAt: number
}

export interface GameState {
  instanceId: string
  state: 'launching' | 'running' | 'exited'
  startedAt: number
  exitCode?: number | null
  crashed?: boolean
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'launcher'

export interface LogLine {
  t: number
  level: LogLevel
  text: string
}

// ---- Local servers (Multiplayer) ----

export type ServerStatus = 'stopped' | 'installing' | 'starting' | 'running' | 'stopping'

export interface ServerProps {
  motd: string
  maxPlayers: number
  gamemode: 'survival' | 'creative' | 'adventure' | 'spectator'
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard'
  onlineMode: boolean
  pvp: boolean
  whitelist: boolean
  port: number
  viewDistance: number
  spawnProtection: number
  allowFlight: boolean
  commandBlocks: boolean
}

export interface GameServer {
  id: string
  name: string
  iconKey: string
  iconUrl: string | null
  mcVersion: string
  loader: LoaderId
  loaderVersion: string | null
  props: ServerProps
  minMem: number
  maxMem: number
  ready: boolean
  modCount: number
  sourceInstanceId: string | null
  dir: string
  lastStarted: number
}

export interface NewServerRequest {
  name: string
  mcVersion: string
  loader: LoaderId
  loaderVersion: string | null
  onlineMode: boolean
  fromInstanceId: string | null
  worldFolder: string | null
  copyMods: boolean
  copyConfig: boolean
}

export interface ServerPatch {
  name?: string
  iconKey?: string
  minMem?: number
  maxMem?: number
  props?: Partial<ServerProps>
}

export interface ServerState {
  serverId: string
  status: ServerStatus
  startedAt: number
  players: string[]
  exitCode?: number | null
}

export interface NetInfo {
  lanIps: string[]
}

export interface UpdateState {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'none' | 'error' | 'disabled'
  version?: string
  percent?: number
  message?: string
}

export const SERVER_LOADERS: LoaderId[] = ['vanilla', 'fabric', 'forge', 'neoforge']

export interface Account {
  id: string
  type: 'msa' | 'offline'
  name: string
  uuid: string
  skinUrl: string | null
  active: boolean
  status: 'ok' | 'expired' | 'error'
}

export type LoginEvent =
  | { type: 'code'; userCode: string; verificationUri: string; expiresIn: number }
  | { type: 'progress'; step: string }
  | { type: 'done'; account: Account }
  | { type: 'error'; message: string }

export interface JavaInstall {
  path: string
  version: string
  major: number
  arch: string
  vendor: string
  managed: boolean
}

export type Appearance = 'auto' | 'light' | 'dark'

export type WindowMaterial = 'acrylic' | 'mica' | 'wallpaper'

export interface Settings {
  theme: Appearance
  windowMaterial: WindowMaterial
  accent: string
  wallpaper: string
  customWallpaper: string | null
  refraction: boolean
  reduceTransparency: boolean
  animatedWallpaper: boolean
  instancesDir: string
  shareWithPrism: boolean
  javaPath: string
  autoJava: boolean
  minMem: number
  maxMem: number
  jvmArgs: string
  width: number
  height: number
  maximized: boolean
  onLaunch: 'keep' | 'minimize' | 'hide'
  showConsoleOnLaunch: boolean
  msaClientId: string
  curseforgeApiKey: string
  concurrentDownloads: number
  sort: 'name' | 'lastPlayed'
  view: 'grid' | 'list'
}

export type ContentKind = 'mods' | 'resourcepacks' | 'shaderpacks'

export interface ContentItem {
  file: string
  kind: ContentKind
  enabled: boolean
  name: string
  version: string | null
  description: string | null
  authors: string[]
  iconUrl: string | null
  size: number
  mtime: number
  modrinthId: string | null
}

export interface WorldInfo {
  folder: string
  name: string
  lastPlayed: number
  size: number
  iconUrl: string | null
}

export interface Screenshot {
  file: string
  url: string
  mtime: number
}

export interface AppInfo {
  version: string
  platform: string
  dataDir: string
  prismDataDir: string | null
  isMaximized: boolean
  totalMemoryMb: number
  supportsMaterial: boolean
}

// ---- Modrinth ----

export type MrProjectType = 'mod' | 'modpack' | 'resourcepack' | 'shader'

export interface MrSearchQuery {
  query: string
  projectType: MrProjectType
  loader?: string | null
  gameVersion?: string | null
  sort: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'
  offset: number
  limit: number
}

export interface MrHit {
  project_id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
  follows: number
  author: string
  categories: string[]
  display_categories?: string[]
  versions: string[]
  latest_version?: string
  date_modified: string
  gallery?: string[]
  featured_gallery?: string | null
  project_type: string
  color?: number | null
}

export interface MrSearchResult {
  hits: MrHit[]
  total_hits: number
  offset: number
  limit: number
}

export interface MrProject {
  id: string
  slug: string
  title: string
  description: string
  body: string
  icon_url: string | null
  downloads: number
  followers: number
  categories: string[]
  game_versions: string[]
  loaders: string[]
  gallery: { url: string; title?: string | null; featured: boolean }[]
  source_url?: string | null
  issues_url?: string | null
  wiki_url?: string | null
  discord_url?: string | null
  project_type: string
  license?: { id: string; name: string } | null
  color?: number | null
}

export interface MrVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  game_versions: string[]
  loaders: string[]
  date_published: string
  downloads: number
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha1: string; sha512: string } }[]
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: string; file_name?: string | null }[]
}

export const PROJECT_KIND: Record<Exclude<MrProjectType, 'modpack'>, ContentKind> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks'
}

// ---- CurseForge (modpack import) ----

export interface CfHit {
  id: number
  name: string
  slug: string
  summary: string
  logoUrl: string | null
  downloadCount: number
  author: string
  categories: string[]
  gameVersions: string[]
}

export interface CfFile {
  id: number
  displayName: string
  fileName: string
  releaseType: 1 | 2 | 3
  gameVersions: string[]
  fileDate: string
  downloadCount: number
}

export interface CfBlocked {
  name: string
  pageUrl: string
}

export interface CfImportResult {
  instanceId: string
  name: string
  blocked: CfBlocked[]
}

export interface CfSearchResult {
  hits: CfHit[]
  totalCount: number
}
