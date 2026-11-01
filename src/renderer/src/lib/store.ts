import { useSyncExternalStore } from 'react'
import type { Account, AppInfo, CfBlocked, ContentKind, GameServer, GameState, Instance, MrProjectType, ServerState, Settings, TaskInfo, UpdateState } from '@shared/types'
import { api } from './api'

export type InstanceTab = 'mods' | 'resourcepacks' | 'shaderpacks' | 'worlds' | 'screenshots' | 'console' | 'version' | 'settings'
export type ServerTab = 'console' | 'properties' | 'content' | 'settings'

export type Route =
  | { view: 'library' }
  | { view: 'instance'; id: string; tab?: InstanceTab }
  | { view: 'discover' }
  | { view: 'multiplayer'; id?: string; tab?: ServerTab }
  | { view: 'accounts' }
  | { view: 'settings' }

export type Sheet =
  | { type: 'new-instance'; group?: string | null }
  | { type: 'new-server'; fromInstanceId?: string | null; worldFolder?: string | null }
  | { type: 'import-curseforge' }
  | { type: 'cf-blocked'; name: string; blocked: CfBlocked[] }
  | { type: 'login' }
  | { type: 'offline' }
  | { type: 'project'; projectId: string; instanceId?: string; projectType: MrProjectType }
  | { type: 'browser'; instanceId: string; kind: ContentKind }
  | { type: 'confirm'; title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void | Promise<void> }
  | { type: 'prompt'; title: string; placeholder?: string; initial?: string; confirm: string; onSubmit: (value: string) => void | Promise<void> }

export interface Toast {
  id: number
  kind: 'error' | 'success' | 'info'
  title: string
  body?: string
}

export interface State {
  ready: boolean
  info: AppInfo | null
  settings: Settings | null
  instances: Instance[]
  groups: string[]
  accounts: Account[]
  tasks: Record<string, TaskInfo>
  games: Record<string, GameState>
  servers: GameServer[]
  serverStates: Record<string, ServerState>
  update: UpdateState
  route: Route
  sheet: Sheet | null
  toasts: Toast[]
  search: string
  selected: string | null
  groupFilter: string | null
  collapsed: Record<string, boolean>
  focused: boolean
  maximized: boolean
}

let state: State = {
  ready: false,
  info: null,
  settings: null,
  instances: [],
  groups: [],
  accounts: [],
  tasks: {},
  games: {},
  servers: [],
  serverStates: {},
  update: { state: 'idle' },
  route: { view: 'library' },
  sheet: null,
  toasts: [],
  search: '',
  selected: null,
  groupFilter: null,
  collapsed: {},
  focused: true,
  maximized: false
}

const listeners = new Set<() => void>()

export const store = {
  get: (): State => state,
  set(patch: Partial<State> | ((s: State) => Partial<State>)): void {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  }
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state))
}

// ---- actions ----

let toastSeq = 0
export function toast(kind: Toast['kind'], title: string, body?: string): void {
  const t = { id: ++toastSeq, kind, title, body }
  store.set((s) => ({ toasts: [...s.toasts, t].slice(-4) }))
  setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), kind === 'error' ? 7000 : 4200)
}

export const navigate = (route: Route): void => store.set({ route, sheet: null })
export const openSheet = (sheet: Sheet): void => store.set({ sheet })
export const closeSheet = (): void => store.set({ sheet: null })

export async function refreshInstances(): Promise<void> {
  const [instances, groups] = await Promise.all([api.instances.list(), api.instances.groups()])
  store.set({ instances, groups })
}

export async function refreshAccounts(): Promise<void> {
  store.set({ accounts: await api.accounts.list() })
}

export async function refreshServers(): Promise<void> {
  store.set({ servers: (await api.servers.list()) ?? [] })
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  store.set((s) => ({ settings: s.settings ? { ...s.settings, ...patch } : s.settings }))
  store.set({ settings: await api.settings.set(patch) })
}

export async function launch(id: string): Promise<void> {
  const inst = state.instances.find((i) => i.id === id)
  if (!state.accounts.length) {
    toast('info', 'Adicione uma conta', 'Entre com sua conta Microsoft para jogar.')
    navigate({ view: 'accounts' })
    return
  }
  try {
    if (state.settings?.showConsoleOnLaunch) navigate({ view: 'instance', id, tab: 'console' })
    await api.game.launch(id)
  } catch (e) {
    toast('error', `Não foi possível iniciar ${inst?.name ?? ''}`, (e as Error).message)
  }
}

export function confirm(title: string, body: string, confirmLabel: string, onConfirm: () => void | Promise<void>, danger = true): void {
  openSheet({ type: 'confirm', title, body, confirm: confirmLabel, danger, onConfirm })
}

export function prompt(title: string, confirmLabel: string, onSubmit: (v: string) => void | Promise<void>, initial = '', placeholder = ''): void {
  openSheet({ type: 'prompt', title, confirm: confirmLabel, onSubmit, initial, placeholder })
}

export async function guard<T>(fn: () => Promise<T>, errorTitle = 'Algo deu errado'): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    toast('error', errorTitle, (e as Error).message)
    return undefined
  }
}

export async function bootstrap(): Promise<void> {
  const [info, settings, accounts, games, tasks, serverStates] = await Promise.all([
    api.app.info(),
    api.settings.get(),
    api.accounts.list(),
    api.game.states(),
    api.tasks.list(),
    api.servers.states().catch(() => [])
  ])
  store.set({
    info,
    settings,
    accounts,
    maximized: info.isMaximized,
    games: Object.fromEntries(games.map((g) => [g.instanceId, g])),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    serverStates: Object.fromEntries(serverStates.map((s) => [s.serverId, s]))
  })
  await refreshInstances().catch((e) => toast('error', 'Falha ao ler instâncias', (e as Error).message))
  await refreshServers().catch(() => undefined)
  store.set({ ready: true })

  // Deep links: #discover, #accounts, #settings, #new, #instance/<id>/<tab>
  const [view, id, tab] = decodeURIComponent(location.hash.slice(1)).split('/')
  if (view === 'discover' || view === 'accounts' || view === 'settings' || view === 'multiplayer') navigate({ view } as Route)
  else if (view === 'new') openSheet({ type: 'new-instance' })
  else if (view === 'cf') openSheet({ type: 'import-curseforge' })
  else if (view === 'instance' && id) navigate({ view: 'instance', id, tab: tab as InstanceTab | undefined })

  api.on.instancesChanged(() => void refreshInstances())
  api.on.update((u) => {
    store.set({ update: u })
    if (u.state === 'ready') toast('success', 'Atualização pronta', `Lumen ${u.version} — reinicie para aplicar.`)
  })
  void api.update.state().then((u) => store.set({ update: u })).catch(() => undefined)
  api.on.serversChanged(() => void refreshServers())
  api.on.serverState((s) => {
    store.set((st) => ({ serverStates: { ...st.serverStates, [s.serverId]: s } }))
    if (s.status === 'stopped' && s.exitCode != null && s.exitCode !== 0) {
      const name = state.servers.find((x) => x.id === s.serverId)?.name ?? 'O servidor'
      toast('error', `${name} fechou com erro`, `Código ${s.exitCode}. Veja o console.`)
    }
  })
  api.on.accountsChanged(() => void refreshAccounts())
  api.on.settings((s) => store.set({ settings: s }))
  api.on.maximized((v) => store.set({ maximized: v }))
  api.on.gameState((g) => {
    store.set((s) => ({ games: { ...s.games, [g.instanceId]: g } }))
    if (g.state === 'exited' && g.crashed && g.exitCode !== null) {
      const name = state.instances.find((i) => i.id === g.instanceId)?.name ?? 'O jogo'
      toast('error', `${name} fechou com erro`, `Código de saída ${g.exitCode}. Veja o console para detalhes.`)
    }
  })
  api.on.task((t) => {
    store.set((s) => {
      const tasks = { ...s.tasks, [t.id]: t }
      return { tasks }
    })
    if (t.state !== 'running') {
      setTimeout(() => store.set((s) => {
        const tasks = { ...s.tasks }
        delete tasks[t.id]
        return { tasks }
      }), t.state === 'done' ? 1800 : 3000)
    }
  })
  window.addEventListener('focus', () => store.set({ focused: true }))
  window.addEventListener('blur', () => store.set({ focused: false }))
}
