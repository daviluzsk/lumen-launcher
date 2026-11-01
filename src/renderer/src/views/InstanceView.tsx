import { AnimatePresence, motion } from 'motion/react'
import {
  Camera,
  ChevronLeft,
  Copy,
  Earth,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Layers,
  Palette,
  Play,
  Puzzle,
  Server,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareTerminal,
  Telescope,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type ContentItem, type ContentKind, type Instance, type LogLine, type Screenshot, type WorldInfo, LOADER_NAMES } from '@shared/types'
import { IconPickerButton, type VersionChoice, VersionPicker } from '../components/Pickers'
import { Empty, FormRow, GlyphTile, SearchField, Segmented, Select, Slider, softSpring, Switch, useMenu } from '../components/ui'
import { api } from '../lib/api'
import { bytes, cx, duration, memLabel, timeAgo } from '../lib/format'
import { confirm, guard, type InstanceTab, launch, navigate, openSheet, toast, useStore } from '../lib/store'
import { accountFor, accountMenu, instanceMenu } from './Library'
import { SkinHead } from '../components/ui'
import { ChevronDown } from 'lucide-react'

const KIND_META: Record<ContentKind, { label: string; noun: string; icon: typeof Puzzle; from: string; to: string; exts: string[] }> = {
  mods: { label: 'Mods', noun: 'mods', icon: Puzzle, from: '#8fb8ff', to: '#4a5fd6', exts: ['jar', 'zip'] },
  resourcepacks: { label: 'Pacotes de recursos', noun: 'pacotes', icon: Palette, from: '#ffb88a', to: '#e0533a', exts: ['zip'] },
  shaderpacks: { label: 'Shaders', noun: 'shaders', icon: Sparkles, from: '#f0a6ff', to: '#7a3ad6', exts: ['zip'] }
}

/** Re-runs `fn` whenever a background task for this instance completes (e.g. a mod install). */
function useTaskRefresh(instanceId: string, fn: () => void): void {
  const doneCount = useStore((s) => Object.values(s.tasks).filter((t) => t.instanceId === instanceId && t.state === 'done').length)
  useEffect(() => {
    if (doneCount) fn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount])
}

function ContentTab({ inst, kind }: { inst: Instance; kind: ContentKind }): React.JSX.Element {
  const [items, setItems] = useState<ContentItem[] | null>(null)
  const [filter, setFilter] = useState('')
  const [over, setOver] = useState(false)
  const menu = useMenu()
  const meta = KIND_META[kind]

  const load = (): void => {
    api.content
      .list(inst.id, kind)
      .then(setItems)
      .catch((e: Error) => {
        setItems([])
        toast('error', 'Falha ao listar arquivos', e.message)
      })
  }
  useEffect(() => {
    setItems(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst.id, kind])
  useTaskRefresh(inst.id, load)

  const add = async (files: string[]): Promise<void> => {
    if (!files.length) return
    const n = await guard(() => api.content.add(inst.id, kind, files), 'Falha ao adicionar')
    if (n) toast('success', `${n} arquivo${n > 1 ? 's' : ''} adicionado${n > 1 ? 's' : ''}`)
    load()
  }

  const toggle = async (it: ContentItem, enabled: boolean): Promise<void> => {
    setItems((list) => list?.map((x) => (x.file === it.file ? { ...x, enabled } : x)) ?? null)
    await guard(() => api.content.toggle(inst.id, kind, it.file, enabled))
    load()
  }

  const remove = (it: ContentItem): void =>
    confirm(`Remover "${it.name}"?`, 'O arquivo será movido para a Lixeira.', 'Remover', async () => {
      await guard(() => api.content.remove(inst.id, kind, [it.file]))
      load()
    })

  const q = filter.trim().toLowerCase()
  const shown = (items ?? []).filter((i) => !q || i.name.toLowerCase().includes(q) || i.file.toLowerCase().includes(q))
  const disabled = (items ?? []).filter((i) => !i.enabled).length
  const vanillaMods = kind === 'mods' && inst.loader === 'vanilla'

  return (
    <div
      className={cx('drop-zone', over && 'over')}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        void add([...e.dataTransfer.files].map((f) => api.pathFor(f)))
      }}
    >
      <div className="tab-toolbar">
        <SearchField value={filter} onChange={setFilter} placeholder={`Buscar ${meta.noun}`} />
        <span className="caption">
          {items ? `${items.length} ${meta.noun}${disabled ? ` · ${disabled} desativado${disabled > 1 ? 's' : ''}` : ''}` : 'Carregando…'}
        </span>
        <div className="spacer" />
        <button className="btn icon" data-tip="Abrir pasta" onClick={() => void api.instances.openFolder(inst.id, kind)}>
          <FolderOpen />
        </button>
        <button
          className="btn"
          onClick={async () => add(await api.app.pickFiles({ title: `Adicionar ${meta.noun}`, filters: [{ name: meta.label, extensions: meta.exts }], multi: true }))}
        >
          <FilePlus2 /> Arquivo
        </button>
        <button className="btn accent" disabled={vanillaMods} onClick={() => openSheet({ type: 'browser', instanceId: inst.id, kind })}>
          <Telescope /> Explorar Modrinth
        </button>
      </div>

      {vanillaMods && (
        <div className="glass thin" style={{ ['--r' as string]: '18px', padding: '12px 16px', marginBottom: 12 }}>
          <span className="secondary">Instâncias vanilla não carregam mods. Escolha Fabric, Forge, NeoForge ou Quilt na aba </span>
          <a onClick={() => navigate({ view: 'instance', id: inst.id, tab: 'version' })} style={{ cursor: 'pointer' }}>Versão</a>.
        </div>
      )}

      {items && !items.length ? (
        <Empty icon={meta.icon} title={`Nenhum ${kind === 'mods' ? 'mod' : kind === 'shaderpacks' ? 'shader' : 'pacote'} instalado`} body="Arraste arquivos para cá ou explore milhares de projetos no Modrinth." />
      ) : (
        <div className="list glass thin">
          {shown.map((it) => (
            <div
              key={it.file}
              className={cx('list-row', !it.enabled && 'disabled')}
              onContextMenu={(e) =>
                menu.open(e, [
                  { label: it.enabled ? 'Desativar' : 'Ativar', onClick: () => void toggle(it, !it.enabled) },
                  ...(it.modrinthId ? [{ label: 'Ver no Modrinth', icon: ExternalLink, onClick: () => void api.app.openExternal(`https://modrinth.com/project/${it.modrinthId}`) }] : []),
                  { label: 'Abrir pasta', icon: FolderOpen, onClick: () => void api.instances.openFolder(inst.id, kind) },
                  'sep',
                  { label: 'Remover…', icon: Trash2, danger: true, onClick: () => remove(it) }
                ])
              }
            >
              {it.iconUrl ? (
                <div className="app-icon" style={{ width: 38, height: 38, borderRadius: 10 }}>
                  <img src={it.iconUrl} alt="" className="pixel" />
                </div>
              ) : (
                <GlyphTile icon={meta.icon} from={meta.from} to={meta.to} size={38} radius={10} />
              )}
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <span className="title truncate">{it.name}</span>
                  {it.version && <span className="tertiary truncate" style={{ fontSize: 12, maxWidth: 160 }}>{it.version}</span>}
                </div>
                <div className="desc truncate">{it.description || it.file}</div>
              </div>
              {it.modrinthId && <span className="badge green">Modrinth</span>}
              <span className="caption" style={{ width: 64, textAlign: 'right' }}>{bytes(it.size)}</span>
              <Switch checked={it.enabled} onChange={(v) => void toggle(it, v)} />
              <button className="btn icon sm ghost" onClick={(e) => menu.open(e, [{ label: 'Remover…', icon: Trash2, danger: true, onClick: () => remove(it) }], 'right')}>
                <Ellipsis />
              </button>
            </div>
          ))}
          {!items && (
            <div className="empty" style={{ padding: 40 }}>
              <div className="spinner" style={{ color: 'var(--accent)' }} />
            </div>
          )}
        </div>
      )}
      {menu.element}
    </div>
  )
}

function WorldsTab({ inst }: { inst: Instance }): React.JSX.Element {
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null)
  const load = (): void => void api.content.worlds(inst.id).then(setWorlds)
  useEffect(load, [inst.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (worlds && !worlds.length) return <Empty icon={Earth} title="Nenhum mundo ainda" body="Os mundos criados nesta instância aparecem aqui." />
  return (
    <>
      <div className="tab-toolbar">
        <span className="caption">{worlds ? `${worlds.length} mundos` : 'Carregando…'}</span>
        <div className="spacer" />
        <button className="btn" onClick={() => void api.instances.openFolder(inst.id, 'saves')}>
          <FolderOpen /> Abrir pasta
        </button>
      </div>
      <div className="worlds">
        {(worlds ?? []).map((w) => (
          <motion.div key={w.folder} className="world-card glass thin" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
            <div className="thumb" style={w.iconUrl ? { backgroundImage: `url("${w.iconUrl}")` } : undefined} />
            <div className="body">
              <div className="title-3 truncate">{w.name}</div>
              <div className="caption">
                {timeAgo(w.lastPlayed)} · {bytes(w.size)}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                {inst.loader !== 'quilt' && (
                  <button className="btn sm tinted" data-tip="Criar um servidor com este mundo" onClick={() => openSheet({ type: 'new-server', fromInstanceId: inst.id, worldFolder: w.folder })}>
                    <Server /> Hospedar
                  </button>
                )}
                <button className="btn sm" onClick={() => void api.instances.openFolder(inst.id, `saves/${w.folder}`)}>
                  <FolderOpen /> Pasta
                </button>
                <div className="spacer" />
                <button
                  className="btn sm icon ghost"
                  data-tip="Excluir"
                  onClick={() =>
                    confirm(`Excluir o mundo "${w.name}"?`, 'A pasta do mundo será movida para a Lixeira.', 'Mover para a Lixeira', async () => {
                      await guard(() => api.content.deleteWorld(inst.id, w.folder))
                      load()
                    })
                  }
                >
                  <Trash2 />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </>
  )
}

function ScreenshotsTab({ inst }: { inst: Instance }): React.JSX.Element {
  const [shots, setShots] = useState<Screenshot[] | null>(null)
  const [open, setOpen] = useState<Screenshot | null>(null)
  const menu = useMenu()
  const load = (): void => void api.content.screenshots(inst.id).then(setShots)
  useEffect(load, [inst.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (shots && !shots.length) return <Empty icon={Camera} title="Sem capturas de tela" body="Pressione F2 dentro do jogo para tirar uma captura." />
  return (
    <>
      <div className="tab-toolbar">
        <span className="caption">{shots ? `${shots.length} capturas` : 'Carregando…'}</span>
        <div className="spacer" />
        <button className="btn" onClick={() => void api.instances.openFolder(inst.id, 'screenshots')}>
          <FolderOpen /> Abrir pasta
        </button>
      </div>
      <div className="gallery">
        {(shots ?? []).map((s) => (
          <img
            key={s.file}
            src={s.url}
            alt={s.file}
            loading="lazy"
            onClick={() => setOpen(s)}
            onContextMenu={(e) =>
              menu.open(e, [
                {
                  label: 'Excluir…',
                  icon: Trash2,
                  danger: true,
                  onClick: () => confirm('Excluir captura?', s.file, 'Mover para a Lixeira', async () => {
                    await guard(() => api.content.deleteScreenshot(inst.id, s.file))
                    load()
                  })
                }
              ])
            }
          />
        ))}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)}>
            <motion.img src={open.url} initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} transition={softSpring} />
          </motion.div>
        )}
      </AnimatePresence>
      {menu.element}
    </>
  )
}

function ConsoleTab({ inst, running }: { inst: Instance; running: boolean }): React.JSX.Element {
  const [lines, setLines] = useState<LogLine[]>([])
  const [filter, setFilter] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    let alive = true
    void api.game.logs(inst.id).then((l) => alive && setLines(l))
    const off = api.on.gameLog((id, l) => {
      if (id === inst.id) setLines((prev) => (prev.length > 12000 ? [...prev.slice(-11000), ...l] : [...prev, ...l]))
    })
    return () => {
      alive = false
      off()
    }
  }, [inst.id])

  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines, filter, onlyProblems])

  const q = filter.toLowerCase()
  const visible = useMemo(() => {
    const f = lines.filter((l) => (!onlyProblems || l.level === 'warn' || l.level === 'error') && (!q || l.text.toLowerCase().includes(q)))
    return f.length > 2500 ? f.slice(-2500) : f
  }, [lines, q, onlyProblems])

  return (
    <div className="console glass">
      <div className="console-bar">
        <input className="field" style={{ width: 220 }} placeholder="Filtrar log" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className={cx('chip')} aria-pressed={onlyProblems} onClick={() => setOnlyProblems(!onlyProblems)}>
          Avisos e erros
        </button>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => void navigator.clipboard.writeText(lines.map((l) => l.text).join('\n')).then(() => toast('success', 'Log copiado'))}>
          <Copy /> Copiar
        </button>
        <button className="btn sm ghost" onClick={() => setLines([])}>
          Limpar
        </button>
        <button className="btn sm ghost" onClick={() => void api.instances.openFolder(inst.id, 'logs')}>
          <FolderOpen /> Logs
        </button>
        {running ? (
          <button className="btn sm danger" onClick={() => void api.game.kill(inst.id)}>
            <Square fill="currentColor" /> Parar
          </button>
        ) : (
          <button className="btn sm accent" onClick={() => void launch(inst.id)}>
            <Play fill="currentColor" /> Jogar
          </button>
        )}
      </div>
      <div
        className="lines"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {!visible.length && <div style={{ opacity: 0.45 }}>O log do jogo aparece aqui quando você clicar em Jogar.</div>}
        {visible.map((l, i) => (
          <div key={i} className={`l-${l.level}`}>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  )
}

function VersionTab({ inst }: { inst: Instance }): React.JSX.Element {
  const [choice, setChoice] = useState<VersionChoice>({ mc: inst.mcVersion, loader: inst.loader, loaderVersion: inst.loaderVersion })
  const [busy, setBusy] = useState(false)
  const changed = choice.mc !== inst.mcVersion || choice.loader !== inst.loader || choice.loaderVersion !== inst.loaderVersion
  const apply = async (): Promise<void> => {
    if (!choice.mc) return
    setBusy(true)
    const r = await guard(() => api.instances.changeVersion(inst.id, choice.mc!, choice.loader, choice.loader === 'vanilla' ? null : choice.loaderVersion), 'Falha ao alterar versão')
    setBusy(false)
    if (r) toast('success', 'Versão alterada', `${LOADER_NAMES[choice.loader]} ${choice.mc}`)
  }
  return (
    <div className="col" style={{ gap: 18, maxWidth: 820, margin: '0 auto', width: '100%' }}>
      <div className="section-label">Componentes</div>
      <div className="list glass thin">
        {inst.components.map((c) => (
          <div key={c.uid} className="list-row" style={{ minHeight: 48 }}>
            <GlyphTile icon={Layers} from="#b6c8e8" to="#4a5f8a" size={30} />
            <div className="grow">
              <div className="title">{c.cachedName ?? c.uid}</div>
              <div className="desc mono" style={{ fontSize: 11 }}>{c.uid}</div>
            </div>
            {c.dependencyOnly && <span className="badge">dependência</span>}
            <span className="badge accent">{c.version ?? 'auto'}</span>
          </div>
        ))}
      </div>
      <div className="section-label">Alterar versão</div>
      <div className="glass thin" style={{ ['--r' as string]: '22px', padding: 16 }}>
        <VersionPicker value={choice} onChange={setChoice} listHeight={220} />
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          {changed && <span className="caption">Faça backup dos mundos antes de mudar a versão.</span>}
          <button className="btn accent" disabled={!changed || busy || (choice.loader !== 'vanilla' && !choice.loaderVersion)} onClick={() => void apply()}>
            Aplicar
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingsTab({ inst }: { inst: Instance }): React.JSX.Element {
  const groups = useStore((s) => s.groups)
  const totalMem = useStore((s) => s.info?.totalMemoryMb ?? 8192)
  const [s, setS] = useState(inst.settings)
  const [notes, setNotes] = useState(inst.notes)
  const [javas, setJavas] = useState<{ value: string; label: string; hint?: string }[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    void api.java.list().then((list) => setJavas(list.map((j) => ({ value: j.path, label: `Java ${j.major} · ${j.vendor || j.arch}`, hint: j.version }))))
  }, [])

  const patch = (p: Partial<typeof s>): void => {
    const next = { ...s, ...p }
    setS(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void guard(() => api.instances.update(inst.id, { settings: next })), 400)
  }

  return (
    <div className="settings-wrap">
      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Geral</div>
        <div className="group glass thin">
          <FormRow label="Grupo">
            <Select
              width={200}
              value={inst.group ?? '__none'}
              onChange={(v) => void guard(() => api.instances.update(inst.id, { group: v === '__none' ? null : v }))}
              options={[{ value: '__none', label: 'Sem grupo' }, ...groups.map((g) => ({ value: g, label: g }))]}
            />
          </FormRow>
          <div className="group-row" style={{ alignItems: 'stretch', flexDirection: 'column' }}>
            <div>Notas</div>
            <textarea className="field" value={notes} placeholder="Anotações sobre esta instância…" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== inst.notes && void api.instances.update(inst.id, { notes })} />
          </div>
        </div>
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Memória</div>
        <div className="group glass thin">
          <FormRow label="Usar configuração própria" hint="Caso contrário, usa os Ajustes globais">
            <Switch checked={s.overrideMemory} onChange={(v) => patch({ overrideMemory: v })} />
          </FormRow>
          {s.overrideMemory && (
            <>
              <FormRow label="Máxima" hint={memLabel(s.maxMem)}>
                <div style={{ width: 300 }}>
                  <Slider value={s.maxMem} min={512} max={Math.max(2048, totalMem)} step={256} onChange={(v) => patch({ maxMem: v, minMem: Math.min(s.minMem, v) })} />
                </div>
              </FormRow>
              <FormRow label="Mínima" hint={memLabel(s.minMem)}>
                <div style={{ width: 300 }}>
                  <Slider value={s.minMem} min={256} max={s.maxMem} step={256} onChange={(v) => patch({ minMem: v })} />
                </div>
              </FormRow>
            </>
          )}
        </div>
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Java</div>
        <div className="group glass thin">
          <FormRow label="Escolher Java manualmente" hint="Por padrão o Lumen escolhe (e baixa) o Java certo">
            <Switch checked={s.overrideJava} onChange={(v) => patch({ overrideJava: v })} />
          </FormRow>
          {s.overrideJava && (
            <FormRow label="Instalação">
              <Select width={260} value={s.javaPath || null} placeholder="Selecionar Java" onChange={(v) => patch({ javaPath: v })} options={javas} />
              <button
                className="btn sm"
                onClick={async () => {
                  const [file] = await api.app.pickFiles({ title: 'Selecionar java.exe', filters: [{ name: 'Java', extensions: ['exe'] }] })
                  if (file) patch({ javaPath: file })
                }}
              >
                Procurar…
              </button>
            </FormRow>
          )}
          <FormRow label="Argumentos JVM próprios">
            <Switch checked={s.overrideJvmArgs} onChange={(v) => patch({ overrideJvmArgs: v })} />
          </FormRow>
          {s.overrideJvmArgs && (
            <div className="group-row">
              <input className="field mono" style={{ fontSize: 12 }} value={s.jvmArgs} placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50" onChange={(e) => patch({ jvmArgs: e.target.value })} />
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Janela do jogo</div>
        <div className="group glass thin">
          <FormRow label="Tamanho próprio">
            <Switch checked={s.overrideWindow} onChange={(v) => patch({ overrideWindow: v })} />
          </FormRow>
          {s.overrideWindow && (
            <FormRow label="Largura × altura">
              <input className="field" style={{ width: 90 }} type="number" value={s.width} onChange={(e) => patch({ width: Number(e.target.value) || 854 })} />
              <span className="tertiary">×</span>
              <input className="field" style={{ width: 90 }} type="number" value={s.height} onChange={(e) => patch({ height: Number(e.target.value) || 480 })} />
            </FormRow>
          )}
        </div>
      </div>
    </div>
  )
}

export function InstanceView({ id, tab }: { id: string; tab?: InstanceTab }): React.JSX.Element {
  const inst = useStore((s) => s.instances.find((i) => i.id === id))
  const groups = useStore((s) => s.groups)
  const accounts = useStore((s) => s.accounts)
  const game = useStore((s) => s.games[id])
  const [name, setName] = useState(inst?.name ?? '')
  const menu = useMenu()
  const acctMenu = useMenu()
  const running = !!game && game.state !== 'exited'

  useEffect(() => setName(inst?.name ?? ''), [inst?.name])

  if (!inst) {
    return (
      <div className="page">
        <Empty icon={Puzzle} title="Instância não encontrada" action={<button className="btn" onClick={() => navigate({ view: 'library' })}>Voltar</button>} />
      </div>
    )
  }

  const tabs: { value: InstanceTab; label: string; icon: typeof Puzzle }[] = [
    ...(inst.loader !== 'vanilla' ? [{ value: 'mods' as const, label: 'Mods', icon: Puzzle }] : []),
    { value: 'resourcepacks', label: 'Recursos', icon: Palette },
    { value: 'shaderpacks', label: 'Shaders', icon: Sparkles },
    { value: 'worlds', label: 'Mundos', icon: Earth },
    { value: 'screenshots', label: 'Capturas', icon: Camera },
    { value: 'console', label: 'Console', icon: SquareTerminal },
    { value: 'version', label: 'Versão', icon: Layers },
    { value: 'settings', label: 'Ajustes', icon: SlidersHorizontal }
  ]
  const active = tab && tabs.some((t) => t.value === tab) ? tab : tabs[0].value
  const setTab = (t: InstanceTab): void => navigate({ view: 'instance', id, tab: t })

  const rename = (): void => {
    const n = name.trim()
    if (n && n !== inst.name) void guard(() => api.instances.update(id, { name: n }))
    else setName(inst.name)
  }

  return (
    <div className="page">
      <div className="page-head" style={{ minHeight: 54, paddingTop: 12, paddingBottom: 10 }}>
        <button className="btn glassy" onClick={() => navigate({ view: 'library' })}>
          <ChevronLeft /> Instâncias
        </button>
      </div>
      <div className="page-scroll" style={{ containerType: 'inline-size' }}>
        <motion.div className="inst-hero glass lens panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
          <div className="hero-glow" style={{ position: 'absolute', inset: '-40%', zIndex: -1, opacity: 0.5, filter: 'blur(50px)', background: inst.iconUrl ? `center/cover url("${inst.iconUrl}")` : 'radial-gradient(circle at 15% 40%, rgba(var(--accent-rgb),.85), transparent 55%)' }} />
          <IconPickerButton
            iconKey={inst.iconKey}
            iconUrl={inst.iconUrl}
            size={96}
            onPick={(k) => void guard(() => api.instances.update(id, { iconKey: k }))}
            onPickFile={(f) => void guard(() => api.instances.setIcon(id, f))}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} spellCheck={false} />
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <span className={`badge loader loader-${inst.loader}`}>
                {LOADER_NAMES[inst.loader]}
                {inst.loaderVersion ? ` ${inst.loaderVersion}` : ''}
              </span>
              <span className="badge">Minecraft {inst.mcVersion}</span>
              {inst.managedPack && <span className="badge green">{inst.managedPack.type === 'modrinth' ? 'Modrinth' : inst.managedPack.type === 'flame' ? 'CurseForge' : 'Modpack'} · {inst.managedPack.versionName}</span>}
              {inst.group && <span className="badge">{inst.group}</span>}
              {(() => {
                const { acc, pinned } = accountFor(inst, accounts)
                return (
                  <button
                    className={cx('badge', pinned ? 'accent' : '')}
                    style={{ gap: 5, paddingLeft: 3, cursor: 'default' }}
                    data-tip={pinned ? 'Conta fixada — clique para trocar' : 'Conta usada ao jogar — clique para escolher'}
                    onClick={(e) => acctMenu.open(e, accountMenu(inst, accounts))}
                  >
                    <SkinHead url={acc?.skinUrl ?? null} name={acc?.name ?? '?'} size={14} />
                    {acc ? acc.name : 'Sem conta'}
                    <ChevronDown size={12} />
                  </button>
                )
              })()}
            </div>
            <div className="stats">
              <div className="stat">
                <div className="v">{duration(inst.totalPlayed)}</div>
                <div className="k">Tempo jogado</div>
              </div>
              <div className="stat">
                <div className="v">{inst.lastLaunch ? timeAgo(inst.lastLaunch) : '—'}</div>
                <div className="k">Último jogo</div>
              </div>
              <div className="stat">
                <div className="v" style={{ color: running ? 'var(--green)' : undefined }}>{running ? (game.state === 'launching' ? 'Iniciando' : 'Rodando') : 'Parado'}</div>
                <div className="k">Estado</div>
              </div>
            </div>
          </div>
          <div className="col" style={{ alignItems: 'flex-end', gap: 10 }}>
            {running ? (
              <button className="btn lg danger" onClick={() => void api.game.kill(id)}>
                <Square fill="currentColor" /> Parar
              </button>
            ) : (
              <button className="btn lg accent" style={{ minWidth: 140 }} onClick={() => void launch(id)}>
                <Play fill="currentColor" /> Jogar
              </button>
            )}
            <div className="row">
              <button className="btn icon glassy" data-tip="Abrir pasta" onClick={() => void api.instances.openFolder(id)}>
                <FolderOpen />
              </button>
              <button className="btn icon glassy" data-tip="Mais" onClick={(e) => menu.open(e, instanceMenu(inst, running, groups), 'right')}>
                <Ellipsis />
              </button>
            </div>
          </div>
        </motion.div>

        <div className="tabs-bar">
          <Segmented value={active} onChange={setTab} options={tabs} />
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {(active === 'mods' || active === 'resourcepacks' || active === 'shaderpacks') && <ContentTab inst={inst} kind={active} />}
            {active === 'worlds' && <WorldsTab inst={inst} />}
            {active === 'screenshots' && <ScreenshotsTab inst={inst} />}
            {active === 'console' && <ConsoleTab inst={inst} running={running} />}
            {active === 'version' && <VersionTab inst={inst} />}
            {active === 'settings' && <SettingsTab inst={inst} />}
          </motion.div>
        </AnimatePresence>
      </div>
      {menu.element}
      {acctMenu.element}
    </div>
  )
}
