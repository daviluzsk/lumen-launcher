import { motion } from 'motion/react'
import { CircleAlert, CircleCheck, Copy, ExternalLink, FolderInput, Package, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Account, LOADER_NAMES } from '@shared/types'
import { api } from '../lib/api'
import { closeSheet, guard, navigate, openSheet, type Sheet as SheetState, toast, useStore } from '../lib/store'
import { BrowserSheet, ProjectSheet } from '../views/Discover'
import { CfBlockedSheet, finishImport, ImportCurseforgeSheet } from '../views/Curseforge'
import { IconPickerButton, type VersionChoice, VersionPicker } from './Pickers'
import { FormRow, Segmented, Select, Sheet, SheetOpen, SkinHead, softSpring, Switch } from './ui'

function NewInstanceSheet({ group }: { group?: string | null }): React.JSX.Element {
  const groups = useStore((s) => s.groups)
  const [name, setName] = useState('')
  const [iconKey, setIconKey] = useState('glass:grass')
  const [grp, setGrp] = useState(group ?? '')
  const [choice, setChoice] = useState<VersionChoice>({ mc: null, loader: 'vanilla', loaderVersion: null })
  const [busy, setBusy] = useState(false)

  const autoName = choice.mc ? (choice.loader === 'vanilla' ? `Minecraft ${choice.mc}` : `${LOADER_NAMES[choice.loader]} ${choice.mc}`) : 'Nova instância'
  const canCreate = !!choice.mc && (choice.loader === 'vanilla' || !!choice.loaderVersion) && !busy

  const create = async (): Promise<void> => {
    if (!choice.mc) return
    setBusy(true)
    const inst = await guard(
      () => api.instances.create({ name: name.trim() || autoName, group: grp.trim() || null, iconKey, mcVersion: choice.mc!, loader: choice.loader, loaderVersion: choice.loader === 'vanilla' ? null : choice.loaderVersion }),
      'Não foi possível criar a instância'
    )
    setBusy(false)
    if (inst) {
      toast('success', 'Instância criada', inst.name)
      navigate({ view: 'instance', id: inst.id })
    }
  }

  const importFile = async (): Promise<void> => {
    const [file] = await api.app.pickFiles({ title: 'Importar instância', filters: [{ name: 'Instância ou modpack', extensions: ['zip', 'mrpack'] }] })
    if (!file) return
    closeSheet()
    const r = await guard(() => api.instances.importFile(file), 'Falha ao importar')
    if (r?.cf) finishImport(r.cf)
    else if (r?.instance) navigate({ view: 'instance', id: r.instance.id })
  }

  return (
    <Sheet onClose={closeSheet} width={820}>
      <div className="sheet-head">
        <div className="title-2">Nova instância</div>
      </div>
      <div className="sheet-body">
        <div className="ni-layout">
          <div className="col" style={{ gap: 16, alignItems: 'center', paddingTop: 6 }}>
            <IconPickerButton iconKey={iconKey} iconUrl={null} onPick={setIconKey} size={104} />
            <div style={{ width: '100%' }}>
              <label className="form-label">Nome</label>
              <input className="field" value={name} placeholder={autoName} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div style={{ width: '100%' }}>
              <label className="form-label">Grupo</label>
              <input className="field" list="groups-list" value={grp} placeholder="Opcional" onChange={(e) => setGrp(e.target.value)} />
              <datalist id="groups-list">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <div className="caption" style={{ textAlign: 'center', marginTop: 'auto' }}>
              Compatível com o formato do Prism Launcher.
            </div>
          </div>
          <VersionPicker value={choice} onChange={setChoice} />
        </div>
      </div>
      <div className="sheet-foot">
        <button className="btn" onClick={() => void importFile()}>
          <FolderInput /> Importar arquivo…
        </button>
        <button className="btn" onClick={() => openSheet({ type: 'import-curseforge' })}>
          <Package /> CurseForge
        </button>
        <div className="spacer" />
        <button className="btn" onClick={closeSheet}>
          Cancelar
        </button>
        <button className="btn accent" disabled={!canCreate} onClick={() => void create()}>
          {busy ? <div className="spinner" style={{ width: 15, height: 15 }} /> : null}
          Criar
        </button>
      </div>
    </Sheet>
  )
}

function MicrosoftLogo({ size = 40 }: { size?: number }): React.JSX.Element {
  const s = size / 2 - 1
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect x="0" y="0" width={s} height={s} fill="#f25022" rx="2" />
      <rect x={s + 2} y="0" width={s} height={s} fill="#7fba00" rx="2" />
      <rect x="0" y={s + 2} width={s} height={s} fill="#00a4ef" rx="2" />
      <rect x={s + 2} y={s + 2} width={s} height={s} fill="#ffb900" rx="2" />
    </svg>
  )
}

function LoginSheet(): React.JSX.Element {
  const [phase, setPhase] = useState<'starting' | 'code' | 'progress' | 'done' | 'error'>('starting')
  const [code, setCode] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const [step, setStep] = useState('')
  const [error, setError] = useState('')
  const [account, setAccount] = useState<Account | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let finished = false
    const off = api.on.login((e) => {
      if (e.type === 'code') {
        setCode({ userCode: e.userCode, verificationUri: e.verificationUri })
        setPhase('code')
      } else if (e.type === 'progress') {
        setStep(e.step)
        setPhase('progress')
      } else if (e.type === 'done') {
        finished = true
        setAccount(e.account)
        setPhase('done')
      } else {
        finished = true
        setError(e.message)
        setPhase('error')
      }
    })
    setPhase('starting')
    void api.accounts.loginMsa()
    return () => {
      off()
      if (!finished) void api.accounts.cancelLogin()
    }
  }, [attempt])

  const copyAndOpen = async (): Promise<void> => {
    if (!code) return
    await navigator.clipboard.writeText(code.userCode).catch(() => undefined)
    toast('info', 'Código copiado', 'Cole na página da Microsoft que acabou de abrir.')
    void api.app.openExternal(code.verificationUri)
  }

  return (
    <Sheet onClose={closeSheet} width={500}>
      <div className="sheet-body" style={{ padding: '30px 30px 10px', textAlign: 'center' }}>
        <div className="col" style={{ alignItems: 'center', gap: 14 }}>
          <MicrosoftLogo />
          <div className="title-2">Entrar com a Microsoft</div>

          {phase === 'starting' && (
            <>
              <div className="spinner" style={{ color: 'var(--accent)', width: 26, height: 26 }} />
              <div className="secondary">Gerando código de acesso…</div>
            </>
          )}

          {phase === 'code' && code && (
            <motion.div className="col" style={{ gap: 14, width: '100%' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
              <div className="secondary">
                Abra <b style={{ color: 'var(--text)' }}>{code.verificationUri.replace(/^https?:\/\//, '')}</b> e digite o código:
              </div>
              <div className="code-box">{code.userCode}</div>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn" onClick={() => void navigator.clipboard.writeText(code.userCode).then(() => toast('success', 'Código copiado'))}>
                  <Copy /> Copiar
                </button>
                <button className="btn accent" onClick={() => void copyAndOpen()}>
                  <ExternalLink /> Copiar e abrir página
                </button>
              </div>
              <div className="row caption" style={{ justifyContent: 'center' }}>
                <div className="spinner" style={{ width: 13, height: 13, color: 'var(--text-2)' }} /> Aguardando você concluir o login no navegador…
              </div>
            </motion.div>
          )}

          {phase === 'progress' && (
            <>
              <div className="spinner" style={{ color: 'var(--accent)', width: 26, height: 26 }} />
              <div className="secondary">{step}</div>
            </>
          )}

          {phase === 'done' && account && (
            <motion.div className="col" style={{ alignItems: 'center', gap: 10 }} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={softSpring}>
              <SkinHead url={account.skinUrl} name={account.name} size={64} />
              <div className="title-3">{account.name}</div>
              <div className="row secondary">
                <CircleCheck size={16} color="var(--green)" /> Conta adicionada e ativa
              </div>
            </motion.div>
          )}

          {phase === 'error' && (
            <>
              <CircleAlert size={30} color="var(--red)" />
              <div className="secondary" style={{ maxWidth: 380 }}>{error}</div>
            </>
          )}
        </div>
      </div>
      <div className="sheet-foot" style={{ justifyContent: 'center' }}>
        {phase === 'error' && (
          <button className="btn" onClick={() => setAttempt((a) => a + 1)}>
            Tentar novamente
          </button>
        )}
        <button className={phase === 'done' ? 'btn accent' : 'btn'} onClick={closeSheet}>
          {phase === 'done' ? 'Concluir' : 'Cancelar'}
        </button>
      </div>
    </Sheet>
  )
}

function OfflineSheet(): React.JSX.Element {
  const [name, setName] = useState('')
  const add = async (): Promise<void> => {
    const acc = await guard(() => api.accounts.addOffline(name), 'Não foi possível adicionar')
    if (acc) {
      toast('success', 'Perfil offline adicionado', acc.name)
      closeSheet()
    }
  }
  return (
    <Sheet onClose={closeSheet} width={440}>
      <div className="sheet-head">
        <div className="row-icon" style={{ background: 'linear-gradient(150deg,#b0b8c8,#5a6478)' }}>
          <UserRound />
        </div>
        <div className="title-2">Perfil offline</div>
      </div>
      <div className="sheet-body">
        <label className="form-label">Nome do jogador</label>
        <input className="field" value={name} maxLength={16} placeholder="Steve" autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <div className="caption" style={{ marginTop: 10 }}>
          Um perfil offline roda o jogo <b style={{ color: 'var(--text-2)' }}>completo</b> no modo um jogador e em LAN — não é a versão demo. Só não entra em servidores premium (modo online), que exigem conta Microsoft.
        </div>
      </div>
      <div className="sheet-foot">
        <div className="spacer" />
        <button className="btn" onClick={closeSheet}>
          Cancelar
        </button>
        <button className="btn accent" disabled={name.trim().length < 3} onClick={() => void add()}>
          Adicionar
        </button>
      </div>
    </Sheet>
  )
}

function ConfirmSheet({ sheet }: { sheet: Extract<SheetState, { type: 'confirm' }> }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <Sheet onClose={closeSheet} width={420}>
      <div className="sheet-body" style={{ padding: '26px 26px 6px' }}>
        <div className="title-3" style={{ fontSize: 17 }}>{sheet.title}</div>
        <div className="secondary" style={{ marginTop: 6 }}>{sheet.body}</div>
      </div>
      <div className="sheet-foot">
        <div className="spacer" />
        <button className="btn" onClick={closeSheet}>
          Cancelar
        </button>
        <button
          className={sheet.danger ? 'btn danger' : 'btn accent'}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await sheet.onConfirm()
            } finally {
              setBusy(false)
              closeSheet()
            }
          }}
        >
          {sheet.confirm}
        </button>
      </div>
    </Sheet>
  )
}

function PromptSheet({ sheet }: { sheet: Extract<SheetState, { type: 'prompt' }> }): React.JSX.Element {
  const [value, setValue] = useState(sheet.initial ?? '')
  const submit = async (): Promise<void> => {
    if (!value.trim()) return
    closeSheet()
    await sheet.onSubmit(value.trim())
  }
  return (
    <Sheet onClose={closeSheet} width={420}>
      <div className="sheet-body" style={{ padding: '24px 24px 6px' }}>
        <div className="title-3" style={{ fontSize: 17, marginBottom: 12 }}>{sheet.title}</div>
        <input className="field" autoFocus value={value} placeholder={sheet.placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      </div>
      <div className="sheet-foot">
        <div className="spacer" />
        <button className="btn" onClick={closeSheet}>
          Cancelar
        </button>
        <button className="btn accent" disabled={!value.trim()} onClick={() => void submit()}>
          {sheet.confirm}
        </button>
      </div>
    </Sheet>
  )
}

export function SheetHost(): React.JSX.Element | null {
  const current = useStore((s) => s.sheet)
  const [last, setLast] = useState<SheetState | null>(current)
  useEffect(() => {
    if (current) {
      setLast(current)
      return
    }
    const t = setTimeout(() => setLast(null), 400)
    return () => clearTimeout(t)
  }, [current])
  const sheet = current ?? last
  if (!sheet) return null
  return (
    <SheetOpen.Provider value={!!current}>
      <SheetContent key={sheetKey(sheet)} sheet={sheet} />
    </SheetOpen.Provider>
  )
}

let keySeq = 0
const keys = new WeakMap<object, number>()
function sheetKey(s: SheetState): string {
  if (!keys.has(s)) keys.set(s, ++keySeq)
  return `${s.type}-${keys.get(s)}`
}

function NewServerSheet({ fromInstanceId, worldFolder }: { fromInstanceId?: string | null; worldFolder?: string | null }): React.JSX.Element {
  const instances = useStore((s) => s.instances)
  const [mode, setMode] = useState<'instance' | 'fresh'>(fromInstanceId || instances.length ? 'instance' : 'fresh')
  const [instId, setInstId] = useState<string | null>(fromInstanceId ?? instances[0]?.id ?? null)
  const inst = instances.find((i) => i.id === instId)
  const [worlds, setWorlds] = useState<{ folder: string; name: string }[] | null>(null)
  const [world, setWorld] = useState<string>(worldFolder ?? '__new')
  const [copyMods, setCopyMods] = useState(true)
  const [copyConfig, setCopyConfig] = useState(true)
  const [name, setName] = useState('')
  const [choice, setChoice] = useState<VersionChoice>({ mc: null, loader: 'vanilla', loaderVersion: null })
  const [online, setOnline] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mode !== 'instance' || !instId) return
    setWorlds(null)
    void api.content
      .worlds(instId)
      .then((w) => {
        const list = w.map((x) => ({ folder: x.folder, name: x.name }))
        setWorlds(list)
        // Load the instance's most-recent world by default (worlds come sorted newest-first).
        setWorld((cur) => (cur !== '__new' && list.some((x) => x.folder === cur) ? cur : worldFolder ?? list[0]?.folder ?? '__new'))
      })
      .catch(() => setWorlds([]))
  }, [mode, instId, worldFolder])

  const modded = mode === 'instance' ? inst && inst.loader !== 'vanilla' : choice.loader !== 'vanilla'
  const defaultName = mode === 'instance' ? inst?.name ?? 'Servidor' : choice.mc ? `Servidor ${choice.loader === 'vanilla' ? '' : LOADER_NAMES[choice.loader] + ' '}${choice.mc}` : 'Servidor'

  const canCreate =
    !busy &&
    (mode === 'instance'
      ? !!inst && inst.loader !== 'quilt' && !!inst.mcVersion
      : !!choice.mc && (choice.loader === 'vanilla' || !!choice.loaderVersion))

  const create = async (): Promise<void> => {
    setBusy(true)
    const req =
      mode === 'instance' && inst
        ? { name: name.trim() || inst.name, mcVersion: inst.mcVersion!, loader: inst.loader, loaderVersion: inst.loaderVersion, onlineMode: online, fromInstanceId: inst.id, worldFolder: world === '__new' ? null : world, copyMods, copyConfig }
        : { name: name.trim() || defaultName, mcVersion: choice.mc!, loader: choice.loader, loaderVersion: choice.loader === 'vanilla' ? null : choice.loaderVersion, onlineMode: online, fromInstanceId: null, worldFolder: null, copyMods: false, copyConfig: false }
    const server = await guard(() => api.servers.create(req), 'Não foi possível criar o servidor')
    setBusy(false)
    if (server) {
      toast('success', 'Servidor criado', server.name)
      navigate({ view: 'multiplayer', id: server.id })
    }
  }

  return (
    <Sheet onClose={closeSheet} width={760}>
      <div className="sheet-head">
        <div className="title-2">Criar servidor</div>
        <div className="spacer" />
        {instances.length > 0 && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'instance', label: 'De uma instância' },
              { value: 'fresh', label: 'Do zero' }
            ]}
          />
        )}
      </div>
      <div className="sheet-body">
        <div style={{ marginBottom: 14 }}>
          <label className="form-label">Nome</label>
          <input className="field" value={name} placeholder={defaultName} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>

        {mode === 'instance' ? (
          <div className="col" style={{ gap: 14 }}>
            <FormRow label="Instância" hint="O servidor herda a versão e o loader">
              <Select width={260} value={instId} placeholder="Escolha" onChange={setInstId} options={instances.map((i) => ({ value: i.id, label: i.name, hint: `${LOADER_NAMES[i.loader]} ${i.mcVersion}` }))} />
            </FormRow>
            {inst?.loader === 'quilt' && <div className="badge orange" style={{ alignSelf: 'flex-start' }}>Servidores Quilt ainda não são suportados</div>}
            <FormRow label="Mundo" hint="Copiar um mundo da instância, ou começar um novo">
              <Select
                width={260}
                value={world}
                onChange={setWorld}
                options={[{ value: '__new', label: 'Mundo novo (gerar ao iniciar)' }, ...(worlds ?? []).map((w) => ({ value: w.folder, label: w.name }))]}
              />
            </FormRow>
            {modded && (
              <>
                <FormRow label="Copiar mods da instância" hint="Necessário pra o mundo modded funcionar">
                  <Switch checked={copyMods} onChange={setCopyMods} />
                </FormRow>
                <FormRow label="Copiar configs da instância">
                  <Switch checked={copyConfig} onChange={setCopyConfig} />
                </FormRow>
                <div className="caption">Dica: alguns mods são só de cliente e podem travar o servidor. Se acontecer, remova-os na pasta do servidor.</div>
              </>
            )}
          </div>
        ) : (
          <VersionPicker value={choice} onChange={setChoice} loaders={['vanilla', 'fabric', 'forge']} listHeight={200} />
        )}

        <div className="group glass thin" style={{ marginTop: 16 }}>
          <FormRow label="Modo online (premium)" hint="Deixe desligado pra amigos com conta offline entrarem">
            <Switch checked={online} onChange={setOnline} />
          </FormRow>
        </div>
      </div>
      <div className="sheet-foot">
        <span className="caption">O Minecraft pede aceitar o EULA da Mojang ao iniciar.</span>
        <div className="spacer" />
        <button className="btn" onClick={closeSheet}>Cancelar</button>
        <button className="btn accent" disabled={!canCreate} onClick={() => void create()}>
          {busy ? <div className="spinner" style={{ width: 15, height: 15 }} /> : null}
          Criar
        </button>
      </div>
    </Sheet>
  )
}

function SheetContent({ sheet }: { sheet: SheetState }): React.JSX.Element {
  switch (sheet.type) {
    case 'new-instance':
      return <NewInstanceSheet group={sheet.group} />
    case 'new-server':
      return <NewServerSheet fromInstanceId={sheet.fromInstanceId} worldFolder={sheet.worldFolder} />
    case 'import-curseforge':
      return <ImportCurseforgeSheet />
    case 'cf-blocked':
      return <CfBlockedSheet name={sheet.name} blocked={sheet.blocked} />
    case 'login':
      return <LoginSheet />
    case 'offline':
      return <OfflineSheet />
    case 'project':
      return <ProjectSheet key={sheet.projectId} projectId={sheet.projectId} projectType={sheet.projectType} instanceId={sheet.instanceId} />
    case 'browser':
      return <BrowserSheet instanceId={sheet.instanceId} kind={sheet.kind} />
    case 'confirm':
      return <ConfirmSheet sheet={sheet} />
    case 'prompt':
      return <PromptSheet sheet={sheet} />
  }
}
