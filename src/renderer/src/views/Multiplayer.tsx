import { motion } from 'motion/react'
import { ChevronLeft, Copy, Ellipsis, FolderOpen, Globe, Play, Plus, Puzzle, Send, Server, SlidersHorizontal, Square, SquareTerminal, Trash2, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type GameServer, type LogLine, LOADER_NAMES, type NetInfo, type ServerProps, type ServerState } from '@shared/types'
import { IconPickerButton } from '../components/Pickers'
import { Empty, FormRow, GlyphTile, InstanceIcon, Segmented, Select, Slider, Switch, softSpring, useMenu } from '../components/ui'
import { api } from '../lib/api'
import { cx, memLabel } from '../lib/format'
import { confirm, guard, navigate, openSheet, type ServerTab, toast, useStore } from '../lib/store'

const STATUS: Record<ServerState['status'], { label: string; color: string }> = {
  stopped: { label: 'Parado', color: 'var(--text-3)' },
  installing: { label: 'Instalando', color: 'var(--orange)' },
  starting: { label: 'Iniciando', color: 'var(--orange)' },
  running: { label: 'Online', color: 'var(--green)' },
  stopping: { label: 'Parando', color: 'var(--orange)' }
}

function statusOf(states: Record<string, ServerState>, id: string): ServerState['status'] {
  return states[id]?.status ?? 'stopped'
}

async function startWithEula(id: string, name: string): Promise<void> {
  try {
    await api.servers.start(id)
  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'EULA_REQUIRED') {
      confirm(
        'Aceitar o EULA da Mojang',
        'Para hospedar um servidor você precisa aceitar o Contrato de Licença de Usuário Final do Minecraft (minecraft.net/eula). Ao continuar, você declara que aceita.',
        'Aceito e iniciar',
        async () => {
          await guard(() => api.servers.acceptEula(id))
          await guard(() => api.servers.start(id), `Não foi possível iniciar ${name}`)
        },
        false
      )
    } else {
      toast('error', `Não foi possível iniciar ${name}`, msg)
    }
  }
}

function ServerCard({ server, status, onOpen }: { server: GameServer; status: ServerState['status']; onOpen: () => void }): React.JSX.Element {
  const running = status === 'running' || status === 'starting'
  const st = STATUS[status]
  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={softSpring} className="server-card glass thin" onClick={onOpen}>
      <InstanceIcon inst={server} size={52} />
      <div className="grow">
        <div className="title-3 truncate">{server.name}</div>
        <div className="row" style={{ gap: 6, marginTop: 4 }}>
          <span className={`badge loader loader-${server.loader}`}>{LOADER_NAMES[server.loader]}</span>
          <span className="badge">{server.mcVersion}</span>
          {server.modCount > 0 && <span className="badge">{server.modCount} mods</span>}
        </div>
      </div>
      <div className="col" style={{ alignItems: 'flex-end', gap: 8 }}>
        <span className="badge" style={{ color: st.color, gap: 5 }}>
          <span className="status-dot" style={{ background: st.color }} /> {st.label}
        </span>
        <button
          className={cx('btn sm', running ? 'danger' : 'launch')}
          onClick={(e) => {
            e.stopPropagation()
            if (running) void api.servers.stop(server.id)
            else void startWithEula(server.id, server.name)
          }}
        >
          {running ? <Square fill="currentColor" /> : <Play fill="currentColor" />}
          {running ? 'Parar' : 'Iniciar'}
        </button>
      </div>
    </motion.div>
  )
}

// ---------- Console ----------

function ServerConsole({ server, status }: { server: GameServer; status: ServerState['status'] }): React.JSX.Element {
  const [lines, setLines] = useState<LogLine[]>([])
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const running = status === 'running'

  useEffect(() => {
    let alive = true
    void api.servers.logs(server.id).then((l) => alive && setLines(l))
    const off = api.on.serverLog((id, l) => {
      if (id === server.id) setLines((prev) => (prev.length > 8000 ? [...prev.slice(-7000), ...l] : [...prev, ...l]))
    })
    return () => {
      alive = false
      off()
    }
  }, [server.id])

  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines])

  const send = (): void => {
    const c = cmd.trim()
    if (!c) return
    void guard(() => api.servers.command(server.id, c))
    setHistory((h) => [...h, c].slice(-50))
    setCmd('')
  }

  return (
    <div className="console glass" style={{ height: 'calc(100vh - 340px)' }}>
      <div className="console-bar">
        <span className="caption" style={{ color: '#fff' }}>Console</span>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => void navigator.clipboard.writeText(lines.map((l) => l.text).join('\n')).then(() => toast('success', 'Copiado'))}>
          <Copy /> Copiar
        </button>
        <button className="btn sm ghost" onClick={() => void api.servers.openFolder(server.id, 'logs')}>
          <FolderOpen /> Logs
        </button>
      </div>
      <div
        className="lines"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {!lines.length && <div style={{ opacity: 0.45 }}>O console aparece aqui quando o servidor iniciar.</div>}
        {lines.map((l, i) => (
          <div key={i} className={`l-${l.level}`}>{l.text}</div>
        ))}
      </div>
      <div className="cmd-bar">
        <span className="mono" style={{ color: 'rgba(255,255,255,.4)' }}>{'>'}</span>
        <input
          className="field mono"
          placeholder={running ? 'Digite um comando (ex: op SeuNome, say oi, whitelist add Nome)' : 'Inicie o servidor para enviar comandos'}
          value={cmd}
          disabled={!running}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
            if (e.key === 'ArrowUp' && history.length) setCmd(history[history.length - 1])
          }}
        />
        <button className="btn sm accent" disabled={!running || !cmd.trim()} onClick={send}>
          <Send /> Enviar
        </button>
      </div>
    </div>
  )
}

// ---------- Properties ----------

function PropsTab({ server }: { server: GameServer }): React.JSX.Element {
  const totalMem = useStore((s) => s.info?.totalMemoryMb ?? 8192)
  const [p, setP] = useState<ServerProps>(server.props)
  const [mem, setMem] = useState({ min: server.minMem, max: server.maxMem })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => setP(server.props), [server.props])

  const save = (nextP: ServerProps, nextMem: { min: number; max: number }): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void guard(() => api.servers.update(server.id, { props: nextP, minMem: nextMem.min, maxMem: nextMem.max })), 400)
  }
  const set = (patch: Partial<ServerProps>): void => {
    const next = { ...p, ...patch }
    setP(next)
    save(next, mem)
  }
  const setM = (m: { min: number; max: number }): void => {
    setMem(m)
    save(p, m)
  }

  return (
    <div className="settings-wrap">
      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Mundo e jogabilidade</div>
        <div className="group glass thin">
          <div className="group-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div>Mensagem do dia (MOTD)</div>
            <input className="field" value={p.motd} onChange={(e) => set({ motd: e.target.value })} />
          </div>
          <FormRow label="Modo de jogo">
            <Select width={180} value={p.gamemode} onChange={(v) => set({ gamemode: v })} options={[{ value: 'survival', label: 'Sobrevivência' }, { value: 'creative', label: 'Criativo' }, { value: 'adventure', label: 'Aventura' }, { value: 'spectator', label: 'Espectador' }]} />
          </FormRow>
          <FormRow label="Dificuldade">
            <Select width={180} value={p.difficulty} onChange={(v) => set({ difficulty: v })} options={[{ value: 'peaceful', label: 'Pacífico' }, { value: 'easy', label: 'Fácil' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Difícil' }]} />
          </FormRow>
          <FormRow label="PvP" hint="Jogadores podem se atacar">
            <Switch checked={p.pvp} onChange={(v) => set({ pvp: v })} />
          </FormRow>
          <FormRow label="Permitir voar" hint="Evita kicks com mods de voo">
            <Switch checked={p.allowFlight} onChange={(v) => set({ allowFlight: v })} />
          </FormRow>
          <FormRow label="Blocos de comando">
            <Switch checked={p.commandBlocks} onChange={(v) => set({ commandBlocks: v })} />
          </FormRow>
          <FormRow label="Distância de renderização" hint={`${p.viewDistance} chunks`}>
            <div style={{ width: 220 }}>
              <Slider value={p.viewDistance} min={3} max={32} step={1} onChange={(v) => set({ viewDistance: v })} />
            </div>
          </FormRow>
          <FormRow label="Proteção do spawn" hint={`${p.spawnProtection} blocos`}>
            <div style={{ width: 220 }}>
              <Slider value={p.spawnProtection} min={0} max={64} step={1} onChange={(v) => set({ spawnProtection: v })} />
            </div>
          </FormRow>
        </div>
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Acesso</div>
        <div className="group glass thin">
          <FormRow label="Modo online (premium)" hint="Desligado = contas offline/não-premium podem entrar">
            <Switch checked={p.onlineMode} onChange={(v) => set({ onlineMode: v })} />
          </FormRow>
          <FormRow label="Whitelist" hint="Só entra quem estiver na lista (whitelist add Nome)">
            <Switch checked={p.whitelist} onChange={(v) => set({ whitelist: v })} />
          </FormRow>
          <FormRow label="Máximo de jogadores">
            <input className="field" type="number" style={{ width: 90 }} value={p.maxPlayers} onChange={(e) => set({ maxPlayers: Number(e.target.value) || 1 })} />
          </FormRow>
          <FormRow label="Porta" hint="Reinicie o servidor após mudar">
            <input className="field" type="number" style={{ width: 110 }} value={p.port} onChange={(e) => set({ port: Number(e.target.value) || 25565 })} />
          </FormRow>
        </div>
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Memória</div>
        <div className="group glass thin">
          <FormRow label="Máxima" hint={memLabel(mem.max)}>
            <div style={{ width: 300 }}>
              <Slider value={mem.max} min={1024} max={Math.max(2048, totalMem)} step={256} onChange={(v) => setM({ min: Math.min(mem.min, v), max: v })} />
            </div>
          </FormRow>
          <FormRow label="Mínima" hint={memLabel(mem.min)}>
            <div style={{ width: 300 }}>
              <Slider value={mem.min} min={512} max={mem.max} step={256} onChange={(v) => setM({ ...mem, min: v })} />
            </div>
          </FormRow>
        </div>
      </div>
    </div>
  )
}

// ---------- Connect panel ----------

function ConnectPanel({ server }: { server: GameServer }): React.JSX.Element {
  const [net, setNet] = useState<NetInfo | null>(null)
  useEffect(() => {
    void api.servers.net().then(setNet)
  }, [])
  const port = server.props.port
  const addrs = [`localhost:${port}`, ...(net?.lanIps ?? []).map((ip) => `${ip}:${port}`)]
  const copy = (a: string): void => void navigator.clipboard.writeText(a).then(() => toast('success', 'Endereço copiado', a))
  return (
    <div className="group glass thin">
      <div className="group-row" style={{ alignItems: 'flex-start' }}>
        <GlyphTile icon={Globe} from="#8fb8ff" to="#2a4fb0" />
        <div className="label">
          <div>Como seus amigos entram</div>
          <div className="caption">Mesmo Wi‑Fi/LAN: usem um dos IPs abaixo. Pela internet: abra a porta {port} no roteador (port‑forward) ou use um túnel (playit.gg, ngrok) e compartilhe o endereço que ele gerar.</div>
        </div>
      </div>
      {addrs.map((a) => (
        <div key={a} className="group-row">
          <span className="mono" style={{ flex: 1 }}>{a}</span>
          <button className="btn sm ghost" onClick={() => copy(a)}>
            <Copy /> Copiar
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------- Settings tab ----------

function ServerSettings({ server }: { server: GameServer }): React.JSX.Element {
  const [name, setName] = useState(server.name)
  useEffect(() => setName(server.name), [server.name])
  return (
    <div className="settings-wrap">
      <ConnectPanel server={server} />
      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Servidor</div>
        <div className="group glass thin">
          <div className="group-row">
            <IconPickerButton iconKey={server.iconKey} iconUrl={server.iconUrl} size={48} onPick={(k) => void guard(() => api.servers.update(server.id, { iconKey: k }))} />
            <div className="label">
              <div>Nome</div>
              <input className="field" style={{ marginTop: 6 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== server.name && void guard(() => api.servers.update(server.id, { name }))} />
            </div>
          </div>
          <div className="group-row clickable" onClick={() => void api.servers.openFolder(server.id)}>
            <div className="row-icon" style={{ background: 'linear-gradient(150deg,#b6c8e8,#4a5f8a)' }}>
              <FolderOpen />
            </div>
            <div className="label"><div>Abrir pasta do servidor</div><div className="caption">server.properties, world, mods…</div></div>
          </div>
        </div>
      </div>
      <button
        className="btn danger"
        onClick={() =>
          confirm(`Excluir "${server.name}"?`, 'A pasta do servidor (incluindo o mundo) vai para a Lixeira.', 'Mover para a Lixeira', async () => {
            await guard(() => api.servers.remove(server.id))
            navigate({ view: 'multiplayer' })
          })
        }
      >
        <Trash2 /> Excluir servidor
      </button>
    </div>
  )
}

// ---------- Detail ----------

function ServerDetail({ id, tab }: { id: string; tab?: ServerTab }): React.JSX.Element {
  const server = useStore((s) => s.servers.find((x) => x.id === id))
  const status = useStore((s) => statusOf(s.serverStates, id))
  const players = useStore((s) => s.serverStates[id]?.players ?? [])
  const menu = useMenu()
  const running = status === 'running' || status === 'starting' || status === 'stopping'

  if (!server) return <div className="page"><Empty icon={Server} title="Servidor não encontrado" action={<button className="btn" onClick={() => navigate({ view: 'multiplayer' })}>Voltar</button>} /></div>

  const tabs: { value: ServerTab; label: string; icon: typeof Puzzle }[] = [
    { value: 'console', label: 'Console', icon: SquareTerminal },
    { value: 'properties', label: 'Propriedades', icon: SlidersHorizontal },
    { value: 'settings', label: 'Ajustes', icon: Server }
  ]
  const active = tab && tabs.some((t) => t.value === tab) ? tab : 'console'
  const st = STATUS[status]

  return (
    <div className="page">
      <div className="page-head" style={{ minHeight: 54, paddingTop: 12, paddingBottom: 10 }}>
        <button className="btn glassy" onClick={() => navigate({ view: 'multiplayer' })}>
          <ChevronLeft /> Servidores
        </button>
      </div>
      <div className="page-scroll" style={{ containerType: 'inline-size' }}>
        <motion.div className="inst-hero glass lens panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
          <InstanceIcon inst={server} size={88} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="title-2 truncate">{server.name}</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <span className={`badge loader loader-${server.loader}`}>{LOADER_NAMES[server.loader]}{server.loaderVersion ? ` ${server.loaderVersion}` : ''}</span>
              <span className="badge">Minecraft {server.mcVersion}</span>
              <span className="badge" style={{ color: st.color, gap: 5 }}><span className="status-dot" style={{ background: st.color }} /> {st.label}</span>
              {!server.props.onlineMode && <span className="badge green">não-premium</span>}
            </div>
            <div className="stats">
              <div className="stat"><div className="v" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Users size={14} /> {players.length}/{server.props.maxPlayers}</div><div className="k">Jogadores</div></div>
              <div className="stat"><div className="v">{server.props.port}</div><div className="k">Porta</div></div>
              {players.length > 0 && <div className="stat"><div className="v truncate" style={{ maxWidth: 220 }}>{players.join(', ')}</div><div className="k">Online agora</div></div>}
            </div>
          </div>
          <div className="col" style={{ alignItems: 'flex-end', gap: 10 }}>
            {running ? (
              <button className="btn lg danger" style={{ minWidth: 130 }} disabled={status === 'stopping'} onClick={() => void api.servers.stop(id)}>
                <Square fill="currentColor" /> {status === 'stopping' ? 'Parando…' : 'Parar'}
              </button>
            ) : (
              <button className="btn lg launch" style={{ minWidth: 130 }} onClick={() => void startWithEula(id, server.name)}>
                <Play fill="currentColor" /> Iniciar
              </button>
            )}
            <button className="btn icon glassy" data-tip="Mais" onClick={(e) => menu.open(e, [
              { label: 'Abrir pasta', icon: FolderOpen, onClick: () => void api.servers.openFolder(id) },
              'sep',
              { label: 'Excluir…', icon: Trash2, danger: true, disabled: running, onClick: () => confirm(`Excluir "${server.name}"?`, 'A pasta do servidor vai para a Lixeira.', 'Mover para a Lixeira', async () => { await guard(() => api.servers.remove(id)); navigate({ view: 'multiplayer' }) }) }
            ], 'right')}>
              <Ellipsis />
            </button>
          </div>
        </motion.div>

        <div className="tabs-bar">
          <Segmented value={active} onChange={(t) => navigate({ view: 'multiplayer', id, tab: t })} options={tabs} />
        </div>

        {active === 'console' && <ServerConsole server={server} status={status} />}
        {active === 'properties' && <PropsTab server={server} />}
        {active === 'settings' && <ServerSettings server={server} />}
      </div>
      {menu.element}
    </div>
  )
}

// ---------- Multiplayer root ----------

export function Multiplayer(): React.JSX.Element {
  const route = useStore((s) => s.route)
  const servers = useStore((s) => s.servers)
  const states = useStore((s) => s.serverStates)
  const ready = useStore((s) => s.ready)

  if (route.view === 'multiplayer' && route.id) return <ServerDetail id={route.id} tab={route.tab} />

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="large-title">Multiplayer</h1>
        <span className="caption">{servers.length}</span>
        <div className="spacer" />
        <button className="btn accent" onClick={() => openSheet({ type: 'new-server' })}>
          <Plus /> Criar servidor
        </button>
      </div>
      <div className="page-scroll">
        {ready && !servers.length ? (
          <Empty
            icon={Server}
            title="Hospede seu mundo"
            body="Crie um servidor local pra jogar com amigos — a partir de uma instância (com o mundo e os mods) ou do zero. Eles entram pelo seu IP."
            action={<button className="btn accent" style={{ marginTop: 8 }} onClick={() => openSheet({ type: 'new-server' })}><Plus /> Criar servidor</button>}
          />
        ) : (
          <div className="server-grid">
            {servers.map((s) => (
              <ServerCard key={s.id} server={s} status={statusOf(states, s.id)} onOpen={() => navigate({ view: 'multiplayer', id: s.id })} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

