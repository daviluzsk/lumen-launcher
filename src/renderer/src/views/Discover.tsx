import { motion } from 'motion/react'
import { ArrowLeft, Check, Download, ExternalLink, Heart, Package, Palette, Puzzle, Sparkles, Telescope } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type ContentKind, type Instance, type MetaVersion, type MrHit, type MrProject, type MrProjectType, type MrSearchQuery, type MrVersion, LOADER_NAMES, PROJECT_KIND } from '@shared/types'
import { Empty, SearchField, Segmented, Select, Sheet, softSpring } from '../components/ui'
import { api } from '../lib/api'
import { compact, cx, timeAgo } from '../lib/format'
import { closeSheet, guard, navigate, openSheet, toast, useStore } from '../lib/store'

const SORTS: { value: MrSearchQuery['sort']; label: string }[] = [
  { value: 'relevance', label: 'Relevância' },
  { value: 'downloads', label: 'Mais baixados' },
  { value: 'follows', label: 'Mais seguidos' },
  { value: 'updated', label: 'Atualizados' },
  { value: 'newest', label: 'Mais novos' }
]

const TYPE_ICON: Record<MrProjectType, typeof Package> = { modpack: Package, mod: Puzzle, shader: Sparkles, resourcepack: Palette }

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function useSearch(q: Omit<MrSearchQuery, 'offset' | 'limit'>, limit = 24): { hits: MrHit[]; total: number; loading: boolean; error: string | null; more: () => void } {
  const [hits, setHits] = useState<MrHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify(q)
  const req = useRef(0)

  const run = (offset: number): void => {
    const id = ++req.current
    setLoading(true)
    setError(null)
    api.mr
      .search({ ...q, offset, limit })
      .then((r) => {
        if (id !== req.current) return
        setHits((prev) => (offset ? [...prev, ...r.hits] : r.hits))
        setTotal(r.total_hits)
      })
      .catch((e: Error) => id === req.current && setError(e.message))
      .finally(() => id === req.current && setLoading(false))
  }
  useEffect(() => run(0), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return { hits, total, loading, error, more: () => run(hits.length) }
}

function useMcReleases(): MetaVersion[] {
  const [v, setV] = useState<MetaVersion[]>([])
  useEffect(() => {
    void api.meta.versions('net.minecraft').then((all) => setV(all.filter((x) => x.type === 'release')))
  }, [])
  return v
}

// ---------- Mini markdown (safe: builds React nodes, never raw HTML) ----------

function inline(text: string): (string | React.JSX.Element)[] {
  const out: (string | React.JSX.Element)[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:[^)\s]+)\)|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<strong key={k++}>{m[1]}</strong>)
    else if (m[2]) {
      const href = m[3]
      out.push(
        <a key={k++} onClick={() => void api.app.openExternal(href)} style={{ cursor: 'pointer' }}>
          {m[2]}
        </a>
      )
    } else if (m[4]) out.push(<code key={k++} className="mono">{m[4]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Markdown({ source }: { source: string }): React.JSX.Element {
  const blocks = useMemo(() => {
    const clean = source
      .replace(/<img[^>]*src=["'](https:[^"']+)["'][^>]*>/gi, '\n![]($1)\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|center|h\d|span|a|strong|b|em|i|details|summary|table|tr|td|th|tbody|thead|ul|ol|li|sup|sub|font)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
    return clean.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
  }, [source])
  return (
    <div className="prose">
      {blocks.slice(0, 80).map((b, i) => {
        const img = b.match(/^!\[[^\]]*\]\((https:[^)\s]+)\)$/)
        if (img) return <img key={i} src={img[1]} alt="" style={{ maxWidth: '100%', borderRadius: 14, margin: '8px 0' }} loading="lazy" />
        const h = b.match(/^(#{1,4})\s+(.*)$/)
        if (h) return <div key={i} className={h[1].length <= 2 ? 'title-2' : 'title-3'} style={{ color: 'var(--text)', margin: '16px 0 6px' }}>{inline(h[2])}</div>
        const lines = b.split('\n')
        if (lines.every((l) => /^\s*[-*+]\s+/.test(l))) {
          return (
            <ul key={i} style={{ paddingLeft: 20, margin: '6px 0' }}>
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*+]\s+/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, ''))}</li>)}
            </ul>
          )
        }
        const text = b.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^>\s?/gm, '').trim()
        return text ? <p key={i} style={{ margin: '6px 0' }}>{inline(text)}</p> : null
      })}
    </div>
  )
}

// ---------- Project detail ----------

export function ProjectDetail({ projectId, projectType, instanceId, onBack }: { projectId: string; projectType: MrProjectType; instanceId?: string; onBack?: () => void }): React.JSX.Element {
  const instances = useStore((s) => s.instances)
  const [project, setProject] = useState<MrProject | null>(null)
  const [versions, setVersions] = useState<MrVersion[] | null>(null)
  const [target, setTarget] = useState<string | null>(instanceId ?? null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const kind: ContentKind | null = projectType === 'modpack' ? null : PROJECT_KIND[projectType]
  const inst: Instance | undefined = instances.find((i) => i.id === target)

  useEffect(() => {
    void api.mr.project(projectId).then(setProject).catch((e: Error) => setError(e.message))
  }, [projectId])

  useEffect(() => {
    setVersions(null)
    const loaders = kind === 'mods' && inst && inst.loader !== 'vanilla' ? [inst.loader] : undefined
    const gv = kind && inst?.mcVersion ? [inst.mcVersion] : undefined
    void api.mr.versions(projectId, loaders, gv).then(setVersions).catch((e: Error) => setError(e.message))
  }, [projectId, target]) // eslint-disable-line react-hooks/exhaustive-deps

  const install = async (v: MrVersion): Promise<void> => {
    setBusy(v.id)
    if (!kind) {
      const created = await guard(() => api.mr.installModpack(v.id, {}), 'Falha ao instalar modpack')
      setBusy(null)
      if (created) {
        toast('success', 'Modpack instalado', created.name)
        navigate({ view: 'instance', id: created.id })
      }
      return
    }
    if (!target) return setBusy(null)
    const names = await guard(() => api.mr.install(target, v.id, kind), 'Falha ao instalar')
    setBusy(null)
    if (names?.length) toast('success', `Instalado em ${inst?.name}`, names.join(', '))
  }

  const compatible = kind === 'mods' ? instances.filter((i) => i.loader !== 'vanilla') : instances

  if (error) return <Empty icon={Telescope} title="Não foi possível carregar" body={error} />
  if (!project) {
    return (
      <div className="empty" style={{ padding: 80 }}>
        <div className="spinner" style={{ color: 'var(--accent)' }} />
      </div>
    )
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        {onBack && (
          <button className="btn icon" onClick={onBack} aria-label="Voltar">
            <ArrowLeft />
          </button>
        )}
        <div className="app-icon" style={{ width: 72, height: 72 }}>
          {project.icon_url ? <img src={project.icon_url} alt="" /> : <Package />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="title-2">{project.title}</div>
          <div className="secondary" style={{ marginTop: 3 }}>{project.description}</div>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
            <span className="badge"><Download /> {compact(project.downloads)}</span>
            <span className="badge"><Heart /> {compact(project.followers)}</span>
            {project.loaders.slice(0, 5).map((l) => <span key={l} className="badge accent">{l}</span>)}
            {project.categories.slice(0, 4).map((c) => <span key={c} className="badge">{c}</span>)}
          </div>
        </div>
        <button className="btn sm" onClick={() => void api.app.openExternal(`https://modrinth.com/${project.project_type}/${project.slug}`)}>
          <ExternalLink /> Modrinth
        </button>
      </div>

      {project.gallery.length > 0 && (
        <div className="carousel">
          {project.gallery.slice(0, 10).map((g) => <img key={g.url} src={g.url} alt={g.title ?? ''} loading="lazy" />)}
        </div>
      )}

      {kind && (
        <div className="row glass thin" style={{ ['--r' as string]: '16px', padding: '10px 14px' }}>
          <span style={{ fontWeight: 600 }}>Instalar em</span>
          <div className="spacer" />
          <Select width={260} value={target} placeholder="Escolha uma instância" onChange={setTarget} options={compatible.map((i) => ({ value: i.id, label: i.name, hint: `${LOADER_NAMES[i.loader]} ${i.mcVersion}` }))} />
        </div>
      )}

      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>
          Versões {kind && inst ? `compatíveis com ${LOADER_NAMES[inst.loader]} ${inst.mcVersion}` : ''}
        </div>
        <div className="list glass thin" style={{ maxHeight: 300, overflowY: 'auto' }}>
          {!versions && (
            <div className="empty" style={{ padding: 30 }}>
              <div className="spinner" style={{ color: 'var(--accent)' }} />
            </div>
          )}
          {versions && !versions.length && <div className="empty" style={{ padding: 30 }}>Nenhuma versão compatível.</div>}
          {versions?.slice(0, 60).map((v) => (
            <div key={v.id} className="list-row" style={{ minHeight: 52 }}>
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <span className="title truncate">{v.version_number}</span>
                  <span className={cx('badge', v.version_type === 'release' ? 'green' : v.version_type === 'beta' ? 'orange' : 'red')}>{v.version_type}</span>
                </div>
                <div className="desc truncate">
                  {v.loaders.join(', ')} · {v.game_versions.slice(-3).join(', ')}
                  {v.game_versions.length > 3 ? '…' : ''} · {timeAgo(Date.parse(v.date_published))}
                </div>
              </div>
              <span className="caption">{compact(v.downloads)}</span>
              <button className="btn sm accent" disabled={!!busy || (!!kind && !target)} onClick={() => void install(v)}>
                {busy === v.id ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Download />}
                Instalar
              </button>
            </div>
          ))}
        </div>
      </div>

      {project.body && (
        <div className="glass thin" style={{ ['--r' as string]: '20px', padding: '16px 20px' }}>
          <Markdown source={project.body} />
        </div>
      )}
    </div>
  )
}

export function ProjectSheet({ projectId, projectType, instanceId }: { projectId: string; projectType: MrProjectType; instanceId?: string }): React.JSX.Element {
  return (
    <Sheet onClose={closeSheet} width={860}>
      <div className="sheet-body" style={{ paddingTop: 22 }}>
        <ProjectDetail projectId={projectId} projectType={projectType} instanceId={instanceId} />
      </div>
      <div className="sheet-foot">
        <div className="spacer" />
        <button className="btn" onClick={closeSheet}>
          Fechar
        </button>
      </div>
    </Sheet>
  )
}

// ---------- Pack card ----------

function PackCard({ hit, onOpen }: { hit: MrHit; onOpen: () => void }): React.JSX.Element {
  const cover = hit.featured_gallery ?? hit.gallery?.[0]
  const color = hit.color ? `#${hit.color.toString(16).padStart(6, '0')}` : 'rgb(var(--accent-rgb))'
  return (
    <motion.button className="pack-card glass thin" onClick={onOpen} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
      <div className="cover" style={{ backgroundImage: cover ? `url("${cover}")` : `linear-gradient(135deg, ${color}, transparent)`, backgroundColor: color }} />
      <div className="body">
        <div className="app-icon" style={{ width: 56, height: 56 }}>
          {hit.icon_url ? <img src={hit.icon_url} alt="" loading="lazy" /> : <Package />}
        </div>
        <div>
          <div className="title-3 truncate">{hit.title}</div>
          <div className="caption truncate">por {hit.author}</div>
        </div>
        <div className="desc">{hit.description}</div>
        <div className="stats-row">
          <span><Download /> {compact(hit.downloads)}</span>
          <span><Heart /> {compact(hit.follows)}</span>
          <span className="truncate">{hit.display_categories?.slice(0, 2).join(' · ')}</span>
        </div>
      </div>
    </motion.button>
  )
}

export function Discover(): React.JSX.Element {
  const [type, setType] = useState<MrProjectType>('modpack')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<MrSearchQuery['sort']>('relevance')
  const [loader, setLoader] = useState<string | null>(null)
  const [gameVersion, setGameVersion] = useState<string | null>(null)
  const releases = useMcReleases()
  const q = useDebounced(query)
  const { hits, total, loading, error, more } = useSearch({ query: q, projectType: type, sort, loader: type === 'mod' || type === 'modpack' ? loader : null, gameVersion })

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="large-title">Descobrir</h1>
        <div className="spacer" />
        <div className="toolbar">
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: 'modpack', label: 'Modpacks', icon: Package },
              { value: 'mod', label: 'Mods', icon: Puzzle },
              { value: 'shader', label: 'Shaders', icon: Sparkles },
              { value: 'resourcepack', label: 'Recursos', icon: Palette }
            ]}
          />
          <SearchField value={query} onChange={setQuery} placeholder="Buscar no Modrinth" width={240} />
        </div>
      </div>
      <div className="page-scroll">
        <div className="filters">
          {(type === 'mod' || type === 'modpack') &&
            [null, 'fabric', 'forge', 'neoforge', 'quilt'].map((l) => (
              <button key={l ?? 'all'} className="chip" aria-pressed={loader === l} onClick={() => setLoader(l)}>
                {l ? LOADER_NAMES[l as keyof typeof LOADER_NAMES] : 'Todos'}
              </button>
            ))}
          <div className="spacer" />
          <Select width={150} value={gameVersion ?? '__any'} onChange={(v) => setGameVersion(v === '__any' ? null : v)} options={[{ value: '__any', label: 'Qualquer versão' }, ...releases.slice(0, 60).map((r) => ({ value: r.version, label: r.version }))]} />
          <Select width={160} value={sort} onChange={setSort} options={SORTS} />
        </div>

        {error && <Empty icon={Telescope} title="Modrinth indisponível" body={error} />}
        {!error && !loading && !hits.length && <Empty icon={Telescope} title="Nada encontrado" body="Tente outra busca ou remova filtros." />}

        <div className="discover-grid">
          {hits.map((h) => (
            <PackCard key={h.project_id} hit={h} onOpen={() => openSheet({ type: 'project', projectId: h.project_id, projectType: type })} />
          ))}
        </div>

        <div className="row" style={{ justifyContent: 'center', padding: '22px 0' }}>
          {loading ? (
            <div className="spinner" style={{ color: 'var(--accent)' }} />
          ) : (
            hits.length < total && (
              <button className="btn glassy" onClick={more}>
                Carregar mais
              </button>
            )
          )}
        </div>
        <div className="caption" style={{ textAlign: 'center' }}>
          Conteúdo fornecido pelo Modrinth · {compact(total)} resultados
        </div>
      </div>
    </div>
  )
}

// ---------- Per-instance browser (mods / resource packs / shaders) ----------

const KIND_TYPE: Record<ContentKind, Exclude<MrProjectType, 'modpack'>> = { mods: 'mod', resourcepacks: 'resourcepack', shaderpacks: 'shader' }
const KIND_TITLE: Record<ContentKind, string> = { mods: 'mods', resourcepacks: 'pacotes de recursos', shaderpacks: 'shaders' }

export function BrowserSheet({ instanceId, kind }: { instanceId: string; kind: ContentKind }): React.JSX.Element {
  const inst = useStore((s) => s.instances.find((i) => i.id === instanceId))
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<MrSearchQuery['sort']>('relevance')
  const [detail, setDetail] = useState<string | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const q = useDebounced(query)
  const type = KIND_TYPE[kind]
  const { hits, total, loading, error, more } = useSearch({
    query: q,
    projectType: type,
    sort,
    loader: kind === 'mods' && inst && inst.loader !== 'vanilla' ? inst.loader : null,
    gameVersion: inst?.mcVersion ?? null
  }, 30)

  const refreshInstalled = (): void => {
    void api.content.list(instanceId, kind).then((items) => setInstalled(new Set(items.map((i) => i.modrinthId).filter((x): x is string => !!x))))
  }
  useEffect(refreshInstalled, [instanceId, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const quickInstall = async (hit: MrHit): Promise<void> => {
    if (!inst) return
    setBusy(hit.project_id)
    const loaders = kind === 'mods' && inst.loader !== 'vanilla' ? [inst.loader] : undefined
    const versions = await guard(() => api.mr.versions(hit.project_id, loaders, inst.mcVersion ? [inst.mcVersion] : undefined))
    const v = versions?.find((x) => x.version_type === 'release') ?? versions?.[0]
    if (!v) {
      toast('error', 'Sem versão compatível', `${hit.title} não tem versão para ${LOADER_NAMES[inst.loader]} ${inst.mcVersion}.`)
    } else {
      const names = await guard(() => api.mr.install(instanceId, v.id, kind), 'Falha ao instalar')
      if (names?.length) toast('success', 'Instalado', names.join(', '))
    }
    setBusy(null)
    refreshInstalled()
  }

  return (
    <Sheet onClose={closeSheet} width={880}>
      <div className="sheet-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="title-2">Adicionar {KIND_TITLE[kind]}</div>
          <div className="caption">
            {inst?.name} · {inst ? `${LOADER_NAMES[inst.loader]} ${inst.mcVersion}` : ''} · Modrinth
          </div>
        </div>
        {!detail && (
          <>
            <SearchField value={query} onChange={setQuery} placeholder={`Buscar ${KIND_TITLE[kind]}`} width={240} autoFocus />
            <Select width={150} value={sort} onChange={setSort} options={SORTS} />
          </>
        )}
      </div>
      <div className="sheet-body" style={{ minHeight: 420 }}>
        {detail ? (
          <ProjectDetail projectId={detail} projectType={type} instanceId={instanceId} onBack={() => {
            setDetail(null)
            refreshInstalled()
          }} />
        ) : (
          <>
            {error && <Empty icon={Telescope} title="Modrinth indisponível" body={error} />}
            <div className="list glass thin">
              {hits.map((h) => {
                const TypeIcon = TYPE_ICON[type]
                const has = installed.has(h.project_id)
                return (
                  <div key={h.project_id} className="list-row" onClick={() => setDetail(h.project_id)}>
                    <div className="app-icon" style={{ width: 44, height: 44, borderRadius: 12 }}>
                      {h.icon_url ? <img src={h.icon_url} alt="" loading="lazy" /> : <TypeIcon />}
                    </div>
                    <div className="grow">
                      <div className="row" style={{ gap: 6 }}>
                        <span className="title truncate">{h.title}</span>
                        <span className="tertiary" style={{ fontSize: 12 }}>por {h.author}</span>
                      </div>
                      <div className="desc truncate">{h.description}</div>
                    </div>
                    <span className="caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Download size={13} /> {compact(h.downloads)}
                    </span>
                    {has ? (
                      <span className="badge green">
                        <Check /> Instalado
                      </span>
                    ) : (
                      <button
                        className="btn sm accent"
                        disabled={!!busy}
                        onClick={(e) => {
                          e.stopPropagation()
                          void quickInstall(h)
                        }}
                      >
                        {busy === h.project_id ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Download />}
                        Instalar
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="row" style={{ justifyContent: 'center', padding: '16px 0 4px' }}>
              {loading ? <div className="spinner" style={{ color: 'var(--accent)' }} /> : hits.length < total && <button className="btn" onClick={more}>Carregar mais</button>}
            </div>
          </>
        )}
      </div>
      <div className="sheet-foot">
        <span className="caption">Dependências obrigatórias são instaladas automaticamente.</span>
        <div className="spacer" />
        <button className="btn accent" onClick={closeSheet}>
          Concluído
        </button>
      </div>
    </Sheet>
  )
}
