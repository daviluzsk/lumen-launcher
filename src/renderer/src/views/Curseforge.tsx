import { ArrowLeft, Download, ExternalLink, FileArchive, FolderOpen, KeyRound, Link2, Package, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type CfBlocked, type CfFile, type CfHit } from '@shared/types'
import { type VersionChoice, VersionPicker } from '../components/Pickers'
import { Empty, SearchField, Segmented, Sheet } from '../components/ui'
import { api } from '../lib/api'
import { compact } from '../lib/format'
import { closeSheet, guard, navigate, openSheet, toast, updateSettings, useStore } from '../lib/store'

function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function KeyGate({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    if (!key.trim()) return
    setBusy(true)
    await updateSettings({ curseforgeApiKey: key.trim() })
    setBusy(false)
    onDone()
  }
  return (
    <div className="col" style={{ gap: 14, padding: '10px 2px' }}>
      <div className="row">
        <div className="row-icon" style={{ background: 'linear-gradient(150deg,#ff9f6a,#e0533a)' }}>
          <KeyRound />
        </div>
        <div>
          <div className="title-3">Chave de API do CurseForge</div>
          <div className="caption">O CurseForge exige uma chave para baixar modpacks (gratuita, leva 1 minuto).</div>
        </div>
      </div>
      <ol className="prose" style={{ paddingLeft: 18, margin: 0 }}>
        <li>Abra <a onClick={() => void api.app.openExternal('https://console.curseforge.com/?#/api-keys')} style={{ cursor: 'pointer' }}>console.curseforge.com → API Keys</a> e entre.</li>
        <li>Copie a chave que aparece (uma sequência longa).</li>
        <li>Cole aqui embaixo.</li>
      </ol>
      <input className="field mono" style={{ fontSize: 12 }} placeholder="$2a$10$..." value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} autoFocus />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn accent" disabled={!key.trim() || busy} onClick={() => void save()}>Salvar e continuar</button>
      </div>
    </div>
  )
}

function CfResultRow({ hit, onPick, busy }: { hit: CfHit; onPick: () => void; busy: boolean }): React.JSX.Element {
  return (
    <div className="list-row" onClick={onPick}>
      <div className="app-icon" style={{ width: 44, height: 44, borderRadius: 12 }}>
        {hit.logoUrl ? <img src={hit.logoUrl} alt="" loading="lazy" /> : <Package />}
      </div>
      <div className="grow">
        <div className="row" style={{ gap: 6 }}>
          <span className="title truncate">{hit.name}</span>
          <span className="tertiary" style={{ fontSize: 12 }}>por {hit.author}</span>
        </div>
        <div className="desc truncate">{hit.summary}</div>
      </div>
      <span className="caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Download size={13} /> {compact(hit.downloadCount)}
      </span>
      <button className="btn sm accent" disabled={busy} onClick={(e) => { e.stopPropagation(); onPick() }}>
        <Download /> Importar
      </button>
    </div>
  )
}

/** Picked a pack → choose a version (file) and import. */
function VersionPick({ hit, onBack }: { hit: CfHit; onBack: () => void }): React.JSX.Element {
  const [files, setFiles] = useState<CfFile[] | null>(null)
  const [busy, setBusy] = useState<number | 'latest' | null>(null)
  useEffect(() => {
    void api.cf.files(hit.id).then(setFiles).catch((e: Error) => { toast('error', 'Falha ao listar versões', e.message); setFiles([]) })
  }, [hit.id])

  const doImport = async (fileId: number | null): Promise<void> => {
    setBusy(fileId ?? 'latest')
    const r = await guard(() => api.cf.import(hit.id, fileId), 'Falha ao importar')
    setBusy(null)
    if (r) finishImport(r)
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <button className="btn icon sm" onClick={onBack}><ArrowLeft /></button>
        <div className="app-icon" style={{ width: 40, height: 40, borderRadius: 11 }}>{hit.logoUrl ? <img src={hit.logoUrl} alt="" /> : <Package />}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="title-3 truncate">{hit.name}</div>
          <div className="caption truncate">{hit.summary}</div>
        </div>
        <button className="btn sm accent" disabled={busy !== null} onClick={() => void doImport(null)}>
          {busy === 'latest' ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Download />} Última versão
        </button>
      </div>
      <div className="section-label">Versões</div>
      <div className="list glass thin" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {!files && <div className="empty" style={{ padding: 30 }}><div className="spinner" style={{ color: 'var(--accent)' }} /></div>}
        {files?.map((f) => (
          <div key={f.id} className="list-row" style={{ minHeight: 50 }}>
            <div className="grow">
              <div className="row" style={{ gap: 6 }}>
                <span className="title truncate">{f.displayName}</span>
                <span className={`badge ${f.releaseType === 1 ? 'green' : f.releaseType === 2 ? 'orange' : 'red'}`}>{f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha'}</span>
              </div>
              <div className="desc truncate">{f.gameVersions.filter((v) => /^\d/.test(v)).join(', ')} · {new Date(f.fileDate).toLocaleDateString('pt-BR')}</div>
            </div>
            <button className="btn sm" disabled={busy !== null} onClick={() => void doImport(f.id)}>
              {busy === f.id ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Download />} Importar
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function finishImport(r: { instanceId: string; name: string; blocked: CfBlocked[] }): void {
  if (r.blocked.length) {
    openSheet({ type: 'cf-blocked', name: r.name, blocked: r.blocked })
  } else {
    toast('success', 'Modpack importado', r.name)
    closeSheet()
  }
  navigate({ view: 'instance', id: r.instanceId })
}

function FolderMode(): React.JSX.Element {
  const [pending, setPending] = useState<{ dir: string; name: string } | null>(null)
  const [choice, setChoice] = useState<VersionChoice>({ mc: null, loader: 'forge', loaderVersion: null })
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    const r = await api.cf.pickFolder()
    if (!r) return
    if (!r.ok) {
      toast('error', 'Pasta inválida', 'Essa pasta não parece um modpack (sem mods/ nem minecraftinstance.json).')
      return
    }
    if (r.meta) {
      // minecraftinstance.json found → import straight away.
      setBusy(true)
      const res = await guard(() => api.cf.importFolder(r.dir, null), 'Falha ao importar')
      setBusy(false)
      if (res) finishImport(res)
    } else {
      // No metadata → ask the version/loader, then import.
      setPending({ dir: r.dir, name: r.dir.split(/[\\/]/).pop() ?? 'Modpack' })
    }
  }

  const importManual = async (): Promise<void> => {
    if (!pending || !choice.mc) return
    setBusy(true)
    const res = await guard(() => api.cf.importFolder(pending.dir, { mcVersion: choice.mc!, loader: choice.loader, loaderVersion: choice.loader === 'vanilla' ? null : choice.loaderVersion, name: pending.name }), 'Falha ao importar')
    setBusy(false)
    if (res) finishImport(res)
  }

  if (pending) {
    return (
      <div className="col" style={{ gap: 14 }}>
        <div className="row">
          <FolderOpen size={18} />
          <div className="grow"><div className="title-3 truncate">{pending.name}</div><div className="caption">Sem minecraftinstance.json — escolha a versão e o loader.</div></div>
          <button className="btn sm ghost" onClick={() => setPending(null)}>Trocar pasta</button>
        </div>
        <VersionPicker value={choice} onChange={setChoice} loaders={['vanilla', 'fabric', 'forge', 'neoforge']} listHeight={200} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn accent" disabled={busy || !choice.mc || (choice.loader !== 'vanilla' && !choice.loaderVersion)} onClick={() => void importManual()}>
            {busy ? <div className="spinner" style={{ width: 15, height: 15 }} /> : <Download />} Importar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="col" style={{ gap: 14, alignItems: 'center', textAlign: 'center', padding: '20px 10px' }}>
      <div className="row-icon" style={{ background: 'linear-gradient(150deg,#ff9f6a,#e0533a)', width: 56, height: 56 }}>
        <FolderOpen />
      </div>
      <div className="title-3">Importar a pasta de um modpack que você já baixou</div>
      <div className="secondary" style={{ maxWidth: 460 }}>
        Instale o pack no <b>app do CurseForge</b> (ou já tenha a pasta dele) e aponte aqui. O Lumen lê a versão e o loader do <span className="mono" style={{ fontSize: 12 }}>minecraftinstance.json</span> e copia mods, configs e mundos. Sem precisar de chave de API.
      </div>
      <button className="btn accent lg" disabled={busy} onClick={() => void pick()}>
        {busy ? <div className="spinner" style={{ width: 16, height: 16 }} /> : <FolderOpen />} Escolher pasta
      </button>
      <div className="caption" style={{ maxWidth: 460 }}>
        Onde fica: no app do CurseForge, clique nos "…" do modpack → <b>Open Folder</b>. Também funciona com qualquer pasta <span className="mono" style={{ fontSize: 11 }}>.minecraft</span> que tenha a pasta <b>mods</b>.
      </div>
    </div>
  )
}

export function ImportCurseforgeSheet(): React.JSX.Element {
  const hasKey = useStore((s) => !!s.settings?.curseforgeApiKey)
  const [mode, setMode] = useState<'folder' | 'search' | 'code'>('folder')
  const [keyReady, setKeyReady] = useState(hasKey)
  const [query, setQuery] = useState('')
  const [code, setCode] = useState('')
  const [hits, setHits] = useState<CfHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<CfHit | null>(null)
  const [busy, setBusy] = useState(false)
  const q = useDebounced(query)
  const needsKey = (mode === 'search' || mode === 'code') && !keyReady

  useEffect(() => {
    if (!keyReady || mode !== 'search') return
    setLoading(true)
    api.cf
      .search(q, null, null)
      .then((r) => setHits(r.hits))
      .catch((e: Error) => { setHits([]); toast('error', 'CurseForge', e.message) })
      .finally(() => setLoading(false))
  }, [q, keyReady, mode])

  const importByCode = async (): Promise<void> => {
    if (!code.trim()) return
    setBusy(true)
    const r = await guard(() => api.cf.importInput(code.trim()), 'Falha ao importar')
    setBusy(false)
    if (r) finishImport(r)
  }

  const importZip = async (): Promise<void> => {
    const [file] = await api.app.pickFiles({ title: 'Modpack CurseForge (.zip)', filters: [{ name: 'Modpack CurseForge', extensions: ['zip'] }] })
    if (!file) return
    setBusy(true)
    const r = await guard(() => api.cf.importZip(file), 'Falha ao importar')
    setBusy(false)
    if (r) finishImport(r)
  }

  return (
    <Sheet onClose={closeSheet} width={820}>
      <div className="sheet-head">
        <div className="row-icon" style={{ background: 'linear-gradient(150deg,#ff9f6a,#e0533a)', width: 32, height: 32 }}>
          <Package />
        </div>
        <div className="title-2">Importar modpack</div>
        <div className="spacer" />
        {!picked && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'folder', label: 'Pasta', icon: FolderOpen },
              { value: 'search', label: 'Buscar', icon: Search },
              { value: 'code', label: 'Código / URL', icon: Link2 }
            ]}
          />
        )}
      </div>
      <div className="sheet-body" style={{ minHeight: 360 }}>
        {mode === 'folder' ? (
          <FolderMode />
        ) : needsKey ? (
          <KeyGate onDone={() => setKeyReady(true)} />
        ) : picked ? (
          <VersionPick hit={picked} onBack={() => setPicked(null)} />
        ) : mode === 'search' ? (
          <div className="col" style={{ gap: 12 }}>
            <SearchField value={query} onChange={setQuery} placeholder="Buscar modpacks no CurseForge" width={9999} autoFocus />
            {hits && !hits.length && !loading && <Empty icon={Search} title="Nada encontrado" body="Tente outro nome, ou use Código / URL." />}
            <div className="list glass thin">
              {hits?.map((h) => <CfResultRow key={h.id} hit={h} busy={busy} onPick={() => setPicked(h)} />)}
            </div>
            {loading && <div className="row" style={{ justifyContent: 'center', padding: 14 }}><div className="spinner" style={{ color: 'var(--accent)' }} /></div>}
          </div>
        ) : (
          <div className="col" style={{ gap: 14 }}>
            <div>
              <label className="form-label">Código, ID ou link do modpack</label>
              <div className="row">
                <input className="field" style={{ flex: 1 }} placeholder="Ex.: 1582600  ·  dontcry  ·  curseforge.com/minecraft/modpacks/..." value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void importByCode()} autoFocus />
                <button className="btn accent" disabled={!code.trim() || busy} onClick={() => void importByCode()}>
                  {busy ? <div className="spinner" style={{ width: 15, height: 15 }} /> : <Download />} Importar
                </button>
              </div>
              <div className="caption" style={{ marginTop: 8 }}>O "código" é o número do projeto (em "Project ID", na página do modpack). Aceita também o slug ou a URL. Requer chave de API.</div>
            </div>
          </div>
        )}
      </div>
      <div className="sheet-foot">
        {!picked && <button className="btn" onClick={() => void importZip()}><FileArchive /> Importar arquivo .zip</button>}
        <span className="caption">Packs no Modrinth não precisam de chave — veja em Descobrir.</span>
        <div className="spacer" />
        <button className="btn" onClick={closeSheet}>Fechar</button>
      </div>
    </Sheet>
  )
}

export function CfBlockedSheet({ name, blocked }: { name: string; blocked: CfBlocked[] }): React.JSX.Element {
  const instId = useStore((s) => (s.route.view === 'instance' ? s.route.id : null))
  const many = blocked.length > 10
  const [filter, setFilter] = useState('')
  const shown = blocked.filter((b) => !filter.trim() || b.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <Sheet onClose={closeSheet} width={600}>
      <div className="sheet-head">
        <div className="title-2">Instância criada — faltam {blocked.length} mod{blocked.length > 1 ? 's' : ''}</div>
      </div>
      <div className="sheet-body">
        <div className="secondary" style={{ marginBottom: 12 }}>
          {many
            ? <>O .zip do CurseForge traz só a <b>lista</b> dos mods, não os arquivos. Criei <b>{name}</b> com os configs; agora baixe os mods e solte na pasta <b>mods</b>. Pra baixar tudo automático, adicione a <b>chave de API</b> em Ajustes e importe de novo — ou instale o pack no app do CurseForge e use <b>Importar → Pasta</b>.</>
            : <>Estes mods não permitem download automático por outros launchers (regra do CurseForge). Baixe cada um e solte na pasta <b>mods</b> de <b>{name}</b>.</>}
        </div>
        {many && <div style={{ marginBottom: 10 }}><SearchField value={filter} onChange={setFilter} placeholder="Filtrar mods" width={9999} /></div>}
        <div className="list glass thin" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {shown.map((b, i) => (
            <div key={i} className="list-row" style={{ minHeight: 44 }}>
              <span className="title grow truncate">{b.name}</span>
              <button className="btn sm" onClick={() => void api.app.openExternal(b.pageUrl)}>
                <ExternalLink /> Baixar
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="sheet-foot">
        {instId && <button className="btn" onClick={() => void api.instances.openFolder(instId, 'mods')}><FolderOpen /> Abrir pasta mods</button>}
        {many && <button className="btn tinted" onClick={() => { closeSheet(); navigate({ view: 'settings' }) }}><KeyRound /> Adicionar chave</button>}
        <div className="spacer" />
        <button className="btn accent" onClick={closeSheet}>Entendi</button>
      </div>
    </Sheet>
  )
}

