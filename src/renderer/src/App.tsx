import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Sidebar, StatusBar, Titlebar, Toasts, Wallpaper } from './components/Shell'
import { SheetHost } from './components/Sheets'
import { api } from './lib/api'
import { cx } from './lib/format'
import { LensFilters } from './lib/lens'
import { guard, navigate, openSheet, store, toast, useStore } from './lib/store'
import { finishImport } from './views/Curseforge'
import { Accounts } from './views/Accounts'
import { Discover } from './views/Discover'
import { Multiplayer } from './views/Multiplayer'
import { InstanceView } from './views/InstanceView'
import { Inspector, Library } from './views/Library'
import { SettingsView } from './views/SettingsView'

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (e: MediaQueryListEvent): void => setDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

export function App(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const route = useStore((s) => s.route)
  const focused = useStore((s) => s.focused)
  const maximized = useStore((s) => s.maximized)
  const systemDark = useSystemDark()
  const [dragging, setDragging] = useState(false)

  const theme = settings?.theme === 'auto' || !settings ? (systemDark ? 'dark' : 'light') : settings.theme

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.accent = settings?.accent ?? 'blue'
    root.dataset.refraction = settings?.refraction === false ? 'off' : 'on'
    root.dataset.transparency = settings?.reduceTransparency ? 'reduced' : 'normal'
    root.dataset.material = settings?.windowMaterial ?? 'acrylic'
  }, [theme, settings?.accent, settings?.refraction, settings?.reduceTransparency, settings?.windowMaterial])

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (!e.ctrlKey) return
      if (e.key === 'n') {
        e.preventDefault()
        openSheet({ type: 'new-instance' })
      } else if (e.key === ',') {
        e.preventDefault()
        navigate({ view: 'settings' })
      } else if (e.key === 'f') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.page .search input')?.focus()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // Dropping a .mrpack / exported .zip anywhere imports it as a new instance.
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter((p) => /\.(mrpack|zip)$/i.test(p))
    for (const f of files) {
      const r = await guard(() => api.instances.importFile(f), 'Falha ao importar')
      if (r?.cf) finishImport(r.cf)
      else if (r?.instance) toast('success', 'Instância importada', r.instance.name)
    }
  }

  const routeKey = route.view === 'instance' ? `instance-${route.id}` : route.view === 'multiplayer' && route.id ? `server-${route.id}` : route.view

  return (
    <div
      className={cx('app', !focused && 'window-unfocused')}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.relatedTarget === null && setDragging(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <Wallpaper />
      <LensFilters />
      <div className={cx('window', maximized && 'maximized')}>
        <Titlebar />
        <div className="body">
          <Sidebar />
          <section className="content">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={routeKey}
                className="page-wrap"
                // Only opacity/transform here: a `filter` on an ancestor would become the
                // backdrop root and every glass panel inside would stop seeing what is behind.
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                {route.view === 'library' && <Library />}
                {route.view === 'instance' && <InstanceView id={route.id} tab={route.tab} />}
                {route.view === 'discover' && <Discover />}
                {route.view === 'multiplayer' && <Multiplayer />}
                {route.view === 'accounts' && <Accounts />}
                {route.view === 'settings' && <SettingsView />}
              </motion.div>
            </AnimatePresence>
            <StatusBar />
          </section>
          {route.view === 'library' && <Inspector />}
        </div>
      </div>
      <Toasts />
      <SheetHost />
      {dragging && store.get().route.view !== 'instance' && (
        <div className="scrim" style={{ pointerEvents: 'none', zIndex: 400 }}>
          <div className="glass strong" style={{ ['--r' as string]: '28px', padding: '28px 40px', textAlign: 'center' }}>
            <div className="title-2">Solte para importar</div>
            <div className="secondary">.mrpack do Modrinth ou .zip exportado do Prism</div>
          </div>
        </div>
      )}
    </div>
  )
}
