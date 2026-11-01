import { motion } from 'motion/react'
import { ArrowDownAZ, ChevronDown, ChevronRight, Clock, Copy, FolderInput, FolderOpen, FolderPlus, LayoutGrid, Link2, Package, Pencil, Play, Plus, Server, Square, Tags, Trash2, UserRound, Users, X } from 'lucide-react'
import { useEffect } from 'react'
import { type Account, type Instance, LOADER_NAMES } from '@shared/types'
import { Empty, InstanceIcon, type MenuEntry, Segmented, SkinHead, softSpring, useMenu } from '../components/ui'
import { api } from '../lib/api'
import { cx, duration, timeAgo } from '../lib/format'
import { confirm, guard, launch, navigate, openSheet, prompt, store, toast, updateSettings, useStore } from '../lib/store'
import { finishImport } from './Curseforge'

/** The account an instance launches with: its pinned one if set and present, otherwise the active account. */
export function accountFor(inst: Pick<Instance, 'accountId'>, accounts: Account[]): { acc: Account | undefined; pinned: boolean } {
  if (inst.accountId) {
    const a = accounts.find((x) => x.id === inst.accountId)
    if (a) return { acc: a, pinned: true }
  }
  return { acc: accounts.find((a) => a.active) ?? accounts[0], pinned: false }
}

export function accountMenu(inst: Instance, accounts: Account[]): MenuEntry[] {
  return [
    { label: 'Conta ativa (padrão)', icon: UserRound, checked: !inst.accountId, onClick: () => void guard(() => api.instances.update(inst.id, { accountId: null })) },
    ...(accounts.length ? (['sep', { section: 'Fixar uma conta' }] as MenuEntry[]) : []),
    ...accounts.map((a) => ({ label: a.name + (a.type === 'offline' ? ' · offline' : ''), checked: inst.accountId === a.id, onClick: () => void guard(() => api.instances.update(inst.id, { accountId: a.id })) })),
    ...(accounts.length ? (['sep', { label: 'Gerenciar contas…', icon: Users, onClick: () => navigate({ view: 'accounts' }) }] as MenuEntry[]) : [{ label: 'Adicionar conta…', icon: Users, onClick: () => navigate({ view: 'accounts' }) } as MenuEntry])
  ]
}

function deleteInstance(inst: Instance): void {
  confirm(`Excluir "${inst.name}"?`, 'A pasta da instância, incluindo mundos e mods, será movida para a Lixeira.', 'Mover para a Lixeira', async () => {
    await guard(() => api.instances.remove(inst.id), 'Falha ao excluir')
    toast('success', 'Instância movida para a Lixeira')
  })
}

function groupMenu(inst: Instance, groups: string[]): MenuEntry[] {
  return [
    ...groups.map((g) => ({ label: g, checked: inst.group === g, onClick: () => void guard(() => api.instances.update(inst.id, { group: g })) })),
    ...(groups.length ? ['sep' as const] : []),
    { label: 'Novo grupo…', icon: FolderPlus, onClick: () => prompt('Novo grupo', 'Criar', (name) => void guard(() => api.instances.update(inst.id, { group: name })), '', 'Nome do grupo') },
    ...(inst.group ? [{ label: 'Remover do grupo', icon: X, onClick: () => void guard(() => api.instances.update(inst.id, { group: null })) }] : [])
  ]
}

async function createShortcut(inst: Instance): Promise<void> {
  const file = await guard(() => api.instances.shortcut(inst.id), 'Falha ao criar atalho')
  if (file) toast('success', 'Atalho criado na Área de Trabalho', inst.name)
}

export function instanceMenu(inst: Instance, running: boolean, groups: string[]): MenuEntry[] {
  return [
    running
      ? { label: 'Parar', icon: Square, onClick: () => void api.game.kill(inst.id) }
      : { label: 'Jogar', icon: Play, onClick: () => void launch(inst.id) },
    { label: 'Editar', icon: Pencil, onClick: () => navigate({ view: 'instance', id: inst.id }) },
    { label: 'Pasta', icon: FolderOpen, onClick: () => void api.instances.openFolder(inst.id) },
    { label: 'Duplicar', icon: Copy, onClick: () => void guard(() => api.instances.duplicate(inst.id), 'Falha ao duplicar') },
    { label: 'Criar atalho', icon: Link2, onClick: () => void createShortcut(inst) },
    ...(inst.loader !== 'quilt' ? [{ label: 'Hospedar servidor…', icon: Server, onClick: () => openSheet({ type: 'new-server', fromInstanceId: inst.id }) }] : []),
    'sep',
    { section: 'Mover para grupo' },
    ...groupMenu(inst, groups),
    'sep',
    { label: 'Excluir…', icon: Trash2, danger: true, disabled: running, onClick: () => deleteInstance(inst) }
  ]
}

function Tile({ inst, selected, running }: { inst: Instance; selected: boolean; running: boolean }): React.JSX.Element {
  const groups = useStore((s) => s.groups)
  const accounts = useStore((s) => s.accounts)
  const { acc, pinned } = accountFor(inst, accounts)
  const menu = useMenu()
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={softSpring}
      className={cx('tile', selected && 'selected')}
      onClick={(e) => {
        e.stopPropagation()
        store.set({ selected: inst.id })
      }}
      onDoubleClick={() => (running ? undefined : void launch(inst.id))}
      onContextMenu={(e) => {
        store.set({ selected: inst.id })
        menu.open(e, instanceMenu(inst, running, groups))
      }}
    >
      {running && (
        <span className="run-badge">
          <Play size={9} fill="currentColor" /> Rodando
        </span>
      )}
      <InstanceIcon inst={inst} size={96} />
      <div className="tile-name">{inst.name}</div>
      <div
        className={cx('tile-acct', pinned && 'pinned')}
        data-tip={pinned ? 'Conta fixada nesta instância — clique para trocar' : 'Conta usada — clique para fixar outra'}
        onClick={(e) => {
          e.stopPropagation()
          store.set({ selected: inst.id })
          menu.open(e, accountMenu(inst, accounts))
        }}
      >
        <SkinHead url={acc?.skinUrl ?? null} name={acc?.name ?? '?'} size={14} />
        <span>{acc ? acc.name : 'Sem conta'}</span>
      </div>
      {menu.element}
    </motion.div>
  )
}

export function Library(): React.JSX.Element {
  const instances = useStore((s) => s.instances)
  const groups = useStore((s) => s.groups)
  const games = useStore((s) => s.games)
  const search = useStore((s) => s.search)
  const collapsed = useStore((s) => s.collapsed)
  const groupFilter = useStore((s) => s.groupFilter)
  const selected = useStore((s) => s.selected)
  const sort = useStore((s) => s.settings?.sort ?? 'lastPlayed')
  const ready = useStore((s) => s.ready)
  const importMenu = useMenu()

  const isRunning = (id: string): boolean => !!games[id] && games[id].state !== 'exited'
  const q = search.trim().toLowerCase()
  const filtered = instances
    .filter((i) => !q || [i.name, i.mcVersion, i.loader, i.group].some((v) => v?.toLowerCase().includes(q)))
    .filter((i) => groupFilter === null || (groupFilter === '__ungrouped' ? !i.group || !groups.includes(i.group) : i.group === groupFilter))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'pt-BR') : b.lastLaunch - a.lastLaunch || a.name.localeCompare(b.name, 'pt-BR')))

  // Keep a sensible selection, like Prism remembering the last instance.
  useEffect(() => {
    if (!filtered.length) return
    if (!selected || !instances.some((i) => i.id === selected)) store.set({ selected: filtered[0].id })
  }, [filtered.length, selected, instances]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea') || store.get().sheet) return
      const sel = store.get().instances.find((i) => i.id === store.get().selected)
      if (!sel) return
      if (e.key === 'Enter') void launch(sel.id)
      if (e.key === 'Delete') deleteInstance(sel)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const sections: { name: string | null; items: Instance[] }[] =
    groupFilter === null && groups.length
      ? [...groups.map((g) => ({ name: g, items: filtered.filter((i) => i.group === g) })), { name: null, items: filtered.filter((i) => !i.group || !groups.includes(i.group)) }].filter((s) => s.items.length)
      : [{ name: null, items: filtered }]

  const title = groupFilter === null ? 'Todas as instâncias' : groupFilter === '__ungrouped' ? 'Sem grupo' : groupFilter

  const importFile = async (): Promise<void> => {
    const [file] = await api.app.pickFiles({ title: 'Importar instância', filters: [{ name: 'Instância ou modpack', extensions: ['zip', 'mrpack'] }] })
    if (!file) return
    const r = await guard(() => api.instances.importFile(file), 'Falha ao importar')
    if (r?.cf) finishImport(r.cf)
    else if (r?.instance) {
      toast('success', 'Instância importada', r.instance.name)
      store.set({ selected: r.instance.id })
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="large-title truncate">{title}</h1>
        <span className="caption">{filtered.length}</span>
        <div className="spacer" />
        <div className="toolbar">
          <Segmented
            value={sort}
            onChange={(v) => void updateSettings({ sort: v })}
            options={[
              { value: 'lastPlayed', icon: Clock, tip: 'Recentes' },
              { value: 'name', icon: ArrowDownAZ, tip: 'Nome' }
            ]}
          />
          <button
            className="btn icon"
            data-tip="Importar modpack"
            onClick={(e) =>
              importMenu.open(e, [
                { label: 'Do CurseForge…', icon: Package, onClick: () => openSheet({ type: 'import-curseforge' }) },
                { label: 'Arquivo (.zip / .mrpack)…', icon: FolderInput, onClick: () => void importFile() }
              ], 'right')
            }
          >
            <FolderInput />
          </button>
          <button className="btn tinted" onClick={() => openSheet({ type: 'new-instance', group: groupFilter && groupFilter !== '__ungrouped' ? groupFilter : null })}>
            <Plus /> Nova
          </button>
        </div>
      </div>

      <div className="page-scroll" onClick={() => undefined}>
        {ready && !instances.length && (
          <Empty
            icon={LayoutGrid}
            title="Nenhuma instância ainda"
            body="Crie uma instância vanilla ou com Fabric, Forge, NeoForge e Quilt — ou instale um modpack em Descobrir."
            action={
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" onClick={() => navigate({ view: 'discover' })}>
                  Explorar modpacks
                </button>
                <button className="btn accent" onClick={() => openSheet({ type: 'new-instance' })}>
                  <Plus /> Nova instância
                </button>
              </div>
            }
          />
        )}
        {q && !filtered.length && <Empty icon={LayoutGrid} title="Nada encontrado" body={`Nenhuma instância corresponde a “${search}”.`} />}

        {sections.map((sec) => {
          const key = sec.name ?? '__none'
          const isCollapsed = !!collapsed[key]
          const showHead = sections.length > 1
          return (
            <section key={key}>
              {showHead && (
                <button className={cx('grid-group', !isCollapsed && 'open')} onClick={() => store.set((s) => ({ collapsed: { ...s.collapsed, [key]: !isCollapsed } }))}>
                  <ChevronRight />
                  {sec.name ?? 'Sem grupo'}
                  <span className="count">{sec.items.length}</span>
                </button>
              )}
              {!isCollapsed && (
                <div className="tiles">
                  {sec.items.map((i) => (
                    <Tile key={i.id} inst={i} selected={i.id === selected} running={isRunning(i.id)} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
      {importMenu.element}
    </div>
  )
}

export function Inspector(): React.JSX.Element {
  const inst = useStore((s) => s.instances.find((i) => i.id === s.selected))
  const game = useStore((s) => (s.selected ? s.games[s.selected] : undefined))
  const groups = useStore((s) => s.groups)
  const accounts = useStore((s) => s.accounts)
  const groupsMenu = useMenu()
  const acctMenu = useMenu()
  const running = !!game && game.state !== 'exited'

  if (!inst) {
    return (
      <aside className="inspector glass thin">
        <div className="inspector-empty">Selecione uma instância</div>
      </aside>
    )
  }

  const launchedAt = inst.lastLaunch ? new Date(inst.lastLaunch) : null
  const { acc, pinned } = accountFor(inst, accounts)

  return (
    <aside className="inspector glass thin">
      <motion.div key={inst.id} className="inspector-scroll" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
        <div className="hero-icon">
          <InstanceIcon inst={inst} size={128} />
        </div>
        <div className="i-name">{inst.name}</div>
        <div className="i-badges">
          <span className={`badge loader loader-${inst.loader}`}>{LOADER_NAMES[inst.loader]}</span>
          <span className="badge">{inst.mcVersion}</span>
          {inst.managedPack && <span className="badge green">{inst.managedPack.type === 'flame' ? 'CurseForge' : inst.managedPack.type === 'modrinth' ? 'Modrinth' : 'Modpack'}</span>}
        </div>

        <div className="launch-row">
          <button className="btn launch" disabled={running} onClick={() => void launch(inst.id)}>
            <Play fill="currentColor" /> {game?.state === 'launching' ? 'Abrindo…' : 'Jogar'}
          </button>
          <button className={cx('btn kill', running && 'armed')} disabled={!running} onClick={() => void api.game.kill(inst.id)}>
            <X /> Parar
          </button>
        </div>

        <button className="acct-row" onClick={(e) => acctMenu.open(e, accountMenu(inst, accounts))}>
          <SkinHead url={acc?.skinUrl ?? null} name={acc?.name ?? '?'} size={28} />
          <div className="label">
            <div className="truncate">{acc ? acc.name : 'Nenhuma conta'}</div>
            <div className="caption">{acc ? (pinned ? 'Fixada nesta instância' : 'Conta ativa (padrão)') : 'Adicione uma conta'}</div>
          </div>
          <ChevronDown />
        </button>

        <div className="actions">
          <button className="action" onClick={() => navigate({ view: 'instance', id: inst.id })}>
            <Pencil /> Editar
          </button>
          <button className="action" onClick={(e) => groupsMenu.open(e, groupMenu(inst, groups))}>
            <Tags /> Mudar grupo
          </button>
          <button className="action" onClick={() => void api.instances.openFolder(inst.id)}>
            <FolderOpen /> Pasta
          </button>
          <button className="action" onClick={() => void guard(() => api.instances.duplicate(inst.id), 'Falha ao duplicar')}>
            <Copy /> Duplicar
          </button>
          <button className="action danger" disabled={running} onClick={() => deleteInstance(inst)}>
            <Trash2 /> Excluir
          </button>
          <button className="action" onClick={() => void createShortcut(inst)}>
            <Link2 /> Criar atalho
          </button>
        </div>

        <div className="facts">
          <div>
            <b>{inst.loader === 'vanilla' ? 'Minecraft' : `${LOADER_NAMES[inst.loader]} ${inst.loaderVersion ?? ''}`}</b>
            {inst.loader !== 'vanilla' && ` · Minecraft ${inst.mcVersion}`}
          </div>
          {launchedAt ? (
            <div>
              Último jogo {launchedAt.toLocaleDateString('pt-BR')} às {launchedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ({timeAgo(inst.lastLaunch)})
            </div>
          ) : (
            <div>Nunca jogado</div>
          )}
          <div>Tempo total: {duration(inst.totalPlayed)}</div>
          {inst.group && <div>Grupo: {inst.group}</div>}
        </div>
      </motion.div>
      {groupsMenu.element}
      {acctMenu.element}
    </aside>
  )
}
