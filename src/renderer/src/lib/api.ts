import type {
  Account,
  AppInfo,
  ContentItem,
  ContentKind,
  GameState,
  Instance,
  InstancePatch,
  JavaInstall,
  LoaderId,
  LogLine,
  LoginEvent,
  MetaVersion,
  MrProject,
  MrSearchQuery,
  MrSearchResult,
  MrVersion,
  CfFile,
  CfHit,
  CfImportResult,
  CfSearchResult,
  NewInstanceRequest,
  NewServerRequest,
  GameServer,
  NetInfo,
  ServerPatch,
  ServerState,
  Screenshot,
  Settings,
  TaskInfo,
  UpdateState,
  WorldInfo
} from '@shared/types'

const bridge = (): NonNullable<Window['prisma']> => {
  if (!window.prisma) throw new Error('Ponte do Electron indisponível')
  return window.prisma
}

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return bridge()
    .invoke(channel, ...args)
    .catch((e: Error) => {
      throw new Error(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
    }) as Promise<T>
}

export const api = {
  app: {
    info: () => call<AppInfo>('app:info'),
    minimize: () => call<void>('app:minimize'),
    maximize: () => call<void>('app:maximize'),
    close: () => call<void>('app:close'),
    openExternal: (url: string) => call<void>('app:openExternal', url),
    openPath: (p: string) => call<string>('app:openPath', p),
    pickFiles: (opts: { title?: string; filters?: { name: string; extensions: string[] }[]; multi?: boolean }) => call<string[]>('app:pickFiles', opts),
    pickFolder: (title?: string) => call<string | null>('app:pickFolder', title),
    setWallpaper: (file: string) => call<string>('app:setWallpaper', file)
  },
  settings: {
    get: () => call<Settings>('settings:get'),
    set: (patch: Partial<Settings>) => call<Settings>('settings:set', patch)
  },
  instances: {
    list: () => call<Instance[]>('instances:list'),
    get: (id: string) => call<Instance>('instances:get', id),
    create: (req: NewInstanceRequest) => call<Instance>('instances:create', req),
    update: (id: string, patch: InstancePatch) => call<Instance>('instances:update', id, patch),
    remove: (id: string) => call<void>('instances:delete', id),
    duplicate: (id: string) => call<Instance>('instances:duplicate', id),
    changeVersion: (id: string, mc: string, loader: LoaderId, loaderVersion: string | null) => call<Instance>('instances:changeVersion', id, mc, loader, loaderVersion),
    setIcon: (id: string, file: string) => call<Instance>('instances:setIcon', id, file),
    openFolder: (id: string, sub?: string) => call<string>('instances:openFolder', id, sub),
    groups: () => call<string[]>('instances:groups'),
    shortcut: (id: string) => call<string>('instances:shortcut', id),
    renameGroup: (from: string, to: string) => call<void>('instances:renameGroup', from, to),
    importFile: (file: string) => call<{ instance?: Instance; cf?: CfImportResult }>('instances:import', file)
  },
  meta: {
    versions: (uid: string, force = false) => call<MetaVersion[]>('meta:versions', uid, force),
    loaderVersions: (loader: LoaderId, mc: string) => call<MetaVersion[]>('meta:loaderVersions', loader, mc)
  },
  game: {
    launch: (id: string) => call<void>('game:launch', id),
    kill: (id: string) => call<void>('game:kill', id),
    states: () => call<GameState[]>('game:states'),
    logs: (id: string) => call<LogLine[]>('game:logs', id)
  },
  tasks: {
    list: () => call<TaskInfo[]>('tasks:list')
  },
  content: {
    list: (id: string, kind: ContentKind) => call<ContentItem[]>('content:list', id, kind),
    toggle: (id: string, kind: ContentKind, file: string, enabled: boolean) => call<void>('content:toggle', id, kind, file, enabled),
    remove: (id: string, kind: ContentKind, files: string[]) => call<void>('content:remove', id, kind, files),
    add: (id: string, kind: ContentKind, files: string[]) => call<number>('content:add', id, kind, files),
    worlds: (id: string) => call<WorldInfo[]>('content:worlds', id),
    deleteWorld: (id: string, folder: string) => call<void>('content:deleteWorld', id, folder),
    screenshots: (id: string) => call<Screenshot[]>('content:screenshots', id),
    deleteScreenshot: (id: string, file: string) => call<void>('content:deleteScreenshot', id, file)
  },
  accounts: {
    list: () => call<Account[]>('accounts:list'),
    loginMsa: () => call<void>('accounts:loginMsa'),
    cancelLogin: () => call<void>('accounts:cancelLogin'),
    addOffline: (name: string) => call<Account>('accounts:addOffline', name),
    remove: (id: string) => call<void>('accounts:remove', id),
    setActive: (id: string) => call<void>('accounts:setActive', id),
    refresh: (id: string) => call<Account>('accounts:refresh', id)
  },
  java: {
    list: (force = false) => call<JavaInstall[]>('java:list', force),
    check: (p: string) => call<JavaInstall | null>('java:check', p),
    download: (major: number) => call<JavaInstall>('java:download', major)
  },
  mr: {
    search: (q: MrSearchQuery) => call<MrSearchResult>('mr:search', q),
    project: (id: string) => call<MrProject>('mr:project', id),
    versions: (id: string, loaders?: string[], gameVersions?: string[]) => call<MrVersion[]>('mr:versions', id, loaders, gameVersions),
    install: (instanceId: string, versionId: string, kind: ContentKind) => call<string[]>('mr:install', instanceId, versionId, kind),
    installModpack: (versionId: string, opts: { name?: string; group?: string | null }) => call<Instance>('mr:installModpack', versionId, opts)
  },
  cf: {
    search: (query: string, gameVersion: string | null, loader: LoaderId | null, offset = 0) => call<CfSearchResult>('cf:search', query, gameVersion, loader, offset),
    resolve: (input: string) => call<CfHit>('cf:resolve', input),
    files: (projectId: number) => call<CfFile[]>('cf:files', projectId),
    import: (projectId: number, fileId: number | null) => call<CfImportResult>('cf:import', projectId, fileId),
    importInput: (input: string) => call<CfImportResult>('cf:importInput', input),
    importZip: (file: string) => call<CfImportResult>('cf:importZip', file),
    pickFolder: () => call<{ dir: string; ok: boolean; meta: { name: string; mcVersion: string; loader: LoaderId; loaderVersion: string | null } | null } | null>('cf:pickFolder'),
    importFolder: (dir: string, override: { mcVersion: string; loader: LoaderId; loaderVersion: string | null; name?: string } | null) => call<CfImportResult>('cf:importFolder', dir, override)
  },
  update: {
    state: () => call<UpdateState>('update:state'),
    check: () => call<void>('update:check'),
    install: () => call<void>('update:install')
  },
  servers: {
    list: () => call<GameServer[]>('servers:list'),
    get: (id: string) => call<GameServer>('servers:get', id),
    create: (req: NewServerRequest) => call<GameServer>('servers:create', req),
    update: (id: string, patch: ServerPatch) => call<GameServer>('servers:update', id, patch),
    remove: (id: string) => call<void>('servers:delete', id),
    loaderVersions: (loader: LoaderId, mc: string) => call<string[]>('servers:loaderVersions', loader, mc),
    start: (id: string) => call<void>('servers:start', id),
    stop: (id: string) => call<void>('servers:stop', id),
    command: (id: string, cmd: string) => call<void>('servers:command', id, cmd),
    acceptEula: (id: string) => call<void>('servers:acceptEula', id),
    states: () => call<ServerState[]>('servers:states'),
    logs: (id: string) => call<LogLine[]>('servers:logs', id),
    net: () => call<NetInfo>('servers:net'),
    openFolder: (id: string, sub?: string) => call<string>('servers:openFolder', id, sub)
  },
  on: {
    instancesChanged: (cb: () => void) => bridge().on('instances:changed', cb),
    task: (cb: (t: TaskInfo) => void) => bridge().on('tasks:update', cb),
    gameState: (cb: (s: GameState) => void) => bridge().on('game:state', cb),
    gameLog: (cb: (id: string, lines: LogLine[]) => void) => bridge().on('game:log', cb),
    accountsChanged: (cb: () => void) => bridge().on('accounts:changed', cb),
    login: (cb: (e: LoginEvent) => void) => bridge().on('accounts:login', cb),
    settings: (cb: (s: Settings) => void) => bridge().on('settings:changed', cb),
    maximized: (cb: (v: boolean) => void) => bridge().on('win:maximized', cb),
    serversChanged: (cb: () => void) => bridge().on('servers:changed', cb),
    serverState: (cb: (s: ServerState) => void) => bridge().on('servers:state', cb),
    serverLog: (cb: (id: string, lines: LogLine[]) => void) => bridge().on('servers:log', cb),
    update: (cb: (s: UpdateState) => void) => bridge().on('update:state', cb)
  },
  pathFor: (file: File): string => bridge().pathFor(file)
}
