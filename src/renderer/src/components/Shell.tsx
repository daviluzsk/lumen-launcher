import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CirclePlus,
  Compass,
  Download,
  RotateCw,
  Server,
  Folder,
  FolderOpen,
  Info,
  LayoutGrid,
  LogIn,
  Maximize2,
  Minus,
  Settings,
  Square,
  UserRound,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { clock, cx } from '../lib/format'
import { navigate, openSheet, store, useStore } from '../lib/store'
import { WALLPAPERS } from '../lib/wallpapers'
import { type MenuEntry, ProgressRing, SearchField, SkinHead, spring, useMenu } from './ui'

// ---------- Wallpaper (only when the OS backdrop material is off) ----------

export function Wallpaper(): React.JSX.Element | null {
  const material = useStore((s) => s.settings?.windowMaterial ?? 'acrylic')
  const wallpaper = useStore((s) => s.settings?.wallpaper ?? 'sequoia')
  const custom = useStore((s) => s.settings?.customWallpaper ?? null)
  const animated = useStore((s) => s.settings?.animatedWallpaper ?? true)
  if (material !== 'wallpaper') return null

  if (wallpaper === 'custom' && custom) {
    return (
      <div className="wallpaper" style={{ ['--wp-base' as string]: '#000' }}>
        <div className="image" style={{ backgroundImage: `url("${custom}")` }} />
      </div>
    )
  }
  const wp = WALLPAPERS.find((w) => w.id === wallpaper) ?? WALLPAPERS[0]
  return (
    <div className={cx('wallpaper', !animated && 'still')} style={{ ['--wp-base' as string]: wp.base }}>
      {wp.blobs.map((c, i) => (
        <div key={i} className="blob" style={{ background: `radial-gradient(closest-side, ${c} 0%, ${c}cc 35%, ${c}00 100%)` }} />
      ))}
    </div>
  )
}

// ---------- Title bar ----------

export function TrafficLights(): React.JSX.Element {
  const maximized = useStore((s) => s.maximized)
  return (
    <div className="traffic">
      <button className="close" aria-label="Fechar" onClick={() => api.app.close()}>
        <X />
      </button>
      <button className="min" aria-label="Minimizar" onClick={() => api.app.minimize()}>
        <Minus />
      </button>
      <button className="max" aria-label={maximized ? 'Restaurar' : 'Maximizar'} onClick={() => api.app.maximize()}>
        <Maximize2 />
      </button>
    </div>
  )
}

function AccountButton(): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const active = accounts.find((a) => a.active) ?? accounts[0]
  const menu = useMenu()
  const items: MenuEntry[] = [
    ...(accounts.length ? [{ section: 'Contas' }] : []),
    ...accounts.map((a) => ({ label: a.name + (a.type === 'offline' ? ' (offline)' : ''), checked: a.active, onClick: () => void api.accounts.setActive(a.id) })),
    ...(accounts.length ? ['sep' as const] : []),
    { label: 'Adicionar conta Microsoft…', icon: LogIn, onClick: () => openSheet({ type: 'login' }) },
    { label: 'Gerenciar contas…', icon: UserRound, onClick: () => navigate({ view: 'accounts' }) }
  ]
  return (
    <>
      <button className="account-btn" onClick={(e) => menu.open(e, items, 'right')}>
        <SkinHead url={active?.skinUrl ?? null} name={active?.name ?? '?'} size={22} />
        <span className="truncate" style={{ maxWidth: 120 }}>{active?.name ?? 'Entrar'}</span>
        <ChevronDown />
      </button>
      {menu.element}
    </>
  )
}

export function Titlebar(): React.JSX.Element {
  const version = useStore((s) => s.info?.version ?? '')
  const search = useStore((s) => s.search)
  const view = useStore((s) => s.route.view)
  return (
    <header className="titlebar">
      <TrafficLights />
      <div className="win-title">Lumen Launcher {version && `v${version}`}</div>
      <div className="tb-right">
        {view === 'library' && <SearchField value={search} onChange={(v) => store.set({ search: v })} placeholder="Buscar" width={190} />}
        <AccountButton />
      </div>
    </header>
  )
}

// ---------- Sidebar (Prism's toolbar, as a macOS source list) ----------

const GROUP_COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2', '#ff375f']
export const groupColor = (name: string): string => GROUP_COLORS[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % GROUP_COLORS.length]

export function Sidebar(): React.JSX.Element {
  const route = useStore((s) => s.route)
  const instances = useStore((s) => s.instances)
  const groups = useStore((s) => s.groups)
  const groupFilter = useStore((s) => s.groupFilter)
  const info = useStore((s) => s.info)
  const settings = useStore((s) => s.settings)
  const [groupsOpen, setGroupsOpen] = useState(true)
  const folders = useMenu()
  const ungrouped = instances.filter((i) => !i.group || !groups.includes(i.group)).length
  const lib = route.view === 'library' || route.view === 'instance'

  const showGroup = (g: string | null): void => {
    store.set({ groupFilter: g })
    navigate({ view: 'library' })
  }

  return (
    <nav className="side">
      <button className="side-item" onClick={() => openSheet({ type: 'new-instance' })}>
        <CirclePlus /> Adicionar instância
      </button>
      <button
        className="side-item"
        onClick={(e) =>
          folders.open(e, [
            { label: 'Instâncias', icon: FolderOpen, onClick: () => settings && void api.app.openPath(settings.instancesDir) },
            { label: 'Dados do Lumen', icon: FolderOpen, onClick: () => info && void api.app.openPath(info.dataDir) },
            ...(info?.prismDataDir ? [{ label: 'Prism Launcher', icon: FolderOpen, onClick: () => void api.app.openPath(info.prismDataDir!) }] : [])
          ])
        }
      >
        <Folder /> Pastas
      </button>
      <button className={cx('side-item', route.view === 'discover' && 'active')} onClick={() => navigate({ view: 'discover' })}>
        <Compass /> Descobrir
      </button>
      <button className={cx('side-item', route.view === 'multiplayer' && 'active')} onClick={() => navigate({ view: 'multiplayer' })}>
        <Server /> Multiplayer
      </button>
      <button className={cx('side-item', route.view === 'settings' && 'active')} onClick={() => navigate({ view: 'settings' })}>
        <Settings /> Ajustes
      </button>
      <button className="side-item" onClick={() => void api.app.openExternal('https://prismlauncher.org/wiki/')}>
        <CircleHelp /> Ajuda
      </button>
      <button className={cx('side-item', route.view === 'accounts' && 'active')} onClick={() => navigate({ view: 'accounts' })}>
        <UserRound /> Contas
      </button>

      <div className="side-sep" />

      <button className={cx('side-item', lib && groupFilter === null && 'active')} onClick={() => showGroup(null)}>
        <LayoutGrid /> Todas as instâncias
        <span className="count">{instances.length}</span>
      </button>
      {groups.length > 0 && (
        <button className="side-item" onClick={() => setGroupsOpen(!groupsOpen)} style={{ color: 'var(--text-2)' }}>
          <ChevronRight className={cx('chev', groupsOpen && 'open')} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Grupos</span>
        </button>
      )}
      {groupsOpen &&
        [...groups, null].map((g) => {
          const count = g === null ? ungrouped : instances.filter((i) => i.group === g).length
          if (g === null && (!count || !groups.length)) return null
          const key = g ?? '__ungrouped'
          return (
            <button key={key} className={cx('side-item side-indent', lib && groupFilter === key && 'active')} onClick={() => showGroup(key)}>
              <Folder style={g ? { color: groupColor(g), fill: `${groupColor(g)}33` } : undefined} />
              <span className="truncate">{g ?? 'Sem grupo'}</span>
              <span className="count">{count}</span>
            </button>
          )
        })}
      {folders.element}
    </nav>
  )
}

// ---------- Status bar (task progress + running game) ----------

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

export function StatusBar(): React.JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const games = useStore((s) => s.games)
  const instances = useStore((s) => s.instances)
  const version = useStore((s) => s.info?.version ?? '')
  const active = Object.values(tasks).filter((t) => t.state === 'running')
  const failed = Object.values(tasks).filter((t) => t.state === 'error').sort((a, b) => b.startedAt - a.startedAt)[0]
  const finished = Object.values(tasks).filter((t) => t.state === 'done').sort((a, b) => b.startedAt - a.startedAt)[0]
  const running = Object.values(games).filter((g) => g.state === 'running')
  const now = useNow(running.length > 0)

  let left: React.JSX.Element
  if (active.length) {
    const t = active[0]
    left = (
      <>
        <ProgressRing value={t.progress} size={15} stroke={2.2} />
        <span className="truncate" style={{ color: 'var(--text)', fontWeight: 600 }}>{t.title}</span>
        <span className="truncate">{t.detail}</span>
        {t.progress !== null && (
          <div className="bar">
            <div style={{ width: `${Math.round(t.progress * 100)}%` }} />
          </div>
        )}
        {active.length > 1 && <span className="badge">+{active.length - 1}</span>}
      </>
    )
  } else if (failed) {
    left = (
      <>
        <CircleAlert size={14} color="var(--red)" />
        <span className="truncate" style={{ color: 'var(--red)' }}>{failed.title}: {failed.error}</span>
      </>
    )
  } else if (running.length) {
    const g = running[0]
    const inst = instances.find((i) => i.id === g.instanceId)
    left = (
      <>
        <span className="live-dot" />
        <a onClick={() => navigate({ view: 'instance', id: g.instanceId, tab: 'console' })} style={{ color: 'var(--text)', fontWeight: 600 }}>
          {inst?.name ?? 'Minecraft'}
        </a>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>em execução · {clock(now - g.startedAt)}</span>
        <button className="btn sm ghost" style={{ ['--h' as string]: '22px' }} onClick={() => void api.game.kill(g.instanceId)}>
          <Square size={11} fill="currentColor" /> Parar
        </button>
      </>
    )
  } else if (finished) {
    left = (
      <>
        <CircleCheck size={14} color="var(--green)" />
        <span className="truncate">{finished.title} — concluído</span>
      </>
    )
  } else {
    left = (
      <>
        <Info size={13} />
        <span>Lumen {version} · baseado no Prism Launcher</span>
      </>
    )
  }

  return (
    <footer className="statusbar">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={active.length ? `t-${active[0].id}` : failed ? 'f' : running.length ? 'r' : finished ? 'd' : 'i'}
          className="row"
          style={{ gap: 8, minWidth: 0, flex: 1 }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={spring}
        >
          {left}
        </motion.div>
      </AnimatePresence>
      <UpdatePill />
      <a onClick={() => void api.app.openExternal('https://modrinth.com/discover/modpacks')}>Modrinth</a>
    </footer>
  )
}

function UpdatePill(): React.JSX.Element | null {
  const u = useStore((s) => s.update)
  if (u.state === 'downloading') {
    return (
      <span className="badge" style={{ gap: 5 }}>
        <Download size={12} /> Baixando atualização {u.percent ?? 0}%
      </span>
    )
  }
  if (u.state === 'ready') {
    return (
      <button className="btn sm accent" style={{ ['--h' as string]: '22px' }} onClick={() => void api.update.install()}>
        <RotateCw size={12} /> Reiniciar e atualizar
      </button>
    )
  }
  return null
}

// ---------- Toasts ----------

const TOAST_STYLE = {
  error: { icon: CircleAlert, bg: 'linear-gradient(150deg,#ff6a5f,#e0263a)' },
  success: { icon: Check, bg: 'linear-gradient(150deg,#5ee27f,#1fa84a)' },
  info: { icon: Info, bg: 'linear-gradient(150deg,#5eb4ff,#1a6ae0)' }
}

export function Toasts(): React.JSX.Element {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts" style={{ top: 52 }}>
      <AnimatePresence>
        {toasts.map((t) => {
          const st = TOAST_STYLE[t.kind]
          return (
            <motion.div
              key={t.id}
              layout
              className="toast glass"
              initial={{ opacity: 0, x: 60, scale: 0.92 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.92 }}
              transition={spring}
              onClick={() => store.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))}
            >
              <div className="toast-icon" style={{ background: st.bg }}>
                <st.icon />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="toast-title">{t.title}</div>
                {t.body && <div className="toast-body">{t.body}</div>}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
