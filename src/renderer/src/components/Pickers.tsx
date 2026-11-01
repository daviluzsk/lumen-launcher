import { Anvil, Box, Feather, Hammer, Hexagon, ImagePlus, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { type LoaderId, LOADER_NAMES, type MetaVersion } from '@shared/types'
import { api } from '../lib/api'
import { BUILTIN_ICONS } from '../lib/icons'
import { InstanceIcon, Popover, SearchField, Select } from './ui'

export interface VersionChoice {
  mc: string | null
  loader: LoaderId
  loaderVersion: string | null
}

const LOADERS: { id: LoaderId; icon: typeof Box }[] = [
  { id: 'vanilla', icon: Box },
  { id: 'fabric', icon: Feather },
  { id: 'quilt', icon: Hexagon },
  { id: 'forge', icon: Anvil },
  { id: 'neoforge', icon: Hammer }
]

type Channel = 'release' | 'snapshot' | 'old'

let mcCache: MetaVersion[] | null = null

export function VersionPicker({ value, onChange, listHeight = 250, loaders }: { value: VersionChoice; onChange: (v: VersionChoice) => void; listHeight?: number; loaders?: LoaderId[] }): React.JSX.Element {
  const loaderTiles = loaders ? LOADERS.filter((l) => loaders.includes(l.id)) : LOADERS
  const [versions, setVersions] = useState<MetaVersion[] | null>(mcCache)
  const [error, setError] = useState<string | null>(null)
  const [channel, setChannel] = useState<Channel>('release')
  const [q, setQ] = useState('')
  const [loaderVersions, setLoaderVersions] = useState<MetaVersion[] | null>(null)
  const [loadingLoader, setLoadingLoader] = useState(false)

  const load = (force = false): void => {
    setError(null)
    api.meta
      .versions('net.minecraft', force)
      .then((v) => {
        mcCache = v
        setVersions(v)
        if (!value.mc) onChange({ ...value, mc: v.find((x) => x.type === 'release')?.version ?? v[0]?.version ?? null })
      })
      .catch((e: Error) => setError(e.message))
  }

  useEffect(() => {
    if (!versions) load()
    else if (!value.mc) onChange({ ...value, mc: versions.find((x) => x.type === 'release')?.version ?? null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (value.loader === 'vanilla' || !value.mc) {
      setLoaderVersions(null)
      return
    }
    let alive = true
    setLoadingLoader(true)
    api.meta
      .loaderVersions(value.loader, value.mc)
      .then((lv) => {
        if (!alive) return
        setLoaderVersions(lv)
        if (!value.loaderVersion || !lv.some((v) => v.version === value.loaderVersion)) {
          const pick = lv.find((v) => v.recommended) ?? lv.find((v) => !/beta|alpha|rc|pre/i.test(v.version)) ?? lv[0]
          onChange({ ...value, loaderVersion: pick?.version ?? null })
        }
      })
      .catch(() => alive && setLoaderVersions([]))
      .finally(() => alive && setLoadingLoader(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.loader, value.mc])

  const shown = useMemo(() => {
    const isOld = (t?: string): boolean => t === 'old_beta' || t === 'old_alpha'
    return (versions ?? []).filter((v) => {
      if (q && !v.version.toLowerCase().includes(q.toLowerCase())) return false
      if (channel === 'release') return v.type === 'release'
      if (channel === 'snapshot') return v.type === 'snapshot' || v.type === 'experiment'
      return isOld(v.type)
    })
  }, [versions, channel, q])

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        {(['release', 'snapshot', 'old'] as Channel[]).map((c) => (
          <button key={c} className="chip" aria-pressed={channel === c} onClick={() => setChannel(c)}>
            {c === 'release' ? 'Lançamentos' : c === 'snapshot' ? 'Snapshots' : 'Beta & Alpha'}
          </button>
        ))}
        <div className="spacer" />
        <SearchField value={q} onChange={setQ} placeholder="Versão" width={150} />
        <button className="btn icon sm ghost" data-tip="Atualizar lista" onClick={() => load(true)}>
          <RefreshCw />
        </button>
      </div>

      <div className="version-list" style={{ height: listHeight }}>
        {error && <div className="empty" style={{ padding: 30 }}>{error}</div>}
        {!versions && !error && (
          <div className="empty" style={{ padding: 30 }}>
            <div className="spinner" style={{ color: 'var(--accent)' }} />
          </div>
        )}
        {shown.map((v) => (
          <button key={v.version} className="version-item" aria-selected={v.version === value.mc} onClick={() => onChange({ ...value, mc: v.version })}>
            <span style={{ fontWeight: 600 }}>{v.version}</span>
            {v.recommended && <span className="badge accent">Recomendada</span>}
            <span className="spacer" />
            <span className="tertiary" style={{ fontSize: 11.5, background: 'none' }}>
              {new Date(v.releaseTime).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </button>
        ))}
      </div>

      <div>
        <span className="form-label">Mod loader</span>
        <div className="loader-tiles">
          {loaderTiles.map((l) => (
            <button key={l.id} className={`loader-tile loader-${l.id}`} aria-pressed={value.loader === l.id} onClick={() => onChange({ ...value, loader: l.id, loaderVersion: null })}>
              <span className="lt-icon">
                <l.icon />
              </span>
              {LOADER_NAMES[l.id]}
            </button>
          ))}
        </div>
      </div>

      {value.loader !== 'vanilla' && (
        <div className="row">
          <span className="form-label" style={{ margin: 0, flex: 1 }}>
            Versão do {LOADER_NAMES[value.loader]}
          </span>
          {loadingLoader ? (
            <div className="spinner" style={{ color: 'var(--accent)' }} />
          ) : loaderVersions && !loaderVersions.length ? (
            <span className="badge orange">Indisponível para {value.mc}</span>
          ) : (
            <Select
              width={220}
              value={value.loaderVersion}
              onChange={(v) => onChange({ ...value, loaderVersion: v })}
              options={(loaderVersions ?? []).slice(0, 150).map((v) => ({ value: v.version, label: v.version, hint: v.recommended ? 'recomendada' : undefined }))}
            />
          )}
        </div>
      )}
    </div>
  )
}

export function IconPickerButton({ iconKey, iconUrl, onPick, onPickFile, size = 84 }: { iconKey: string; iconUrl: string | null; onPick: (key: string) => void; onPickFile?: (file: string) => void; size?: number }): React.JSX.Element {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  return (
    <>
      <button style={{ borderRadius: '24%' }} onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())} data-tip="Alterar ícone">
        <InstanceIcon inst={{ iconKey, iconUrl }} size={size} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={308}>
          <div className="icon-grid" style={{ padding: 6 }}>
            {BUILTIN_ICONS.map((b) => (
              <button
                key={b.key}
                aria-pressed={b.key === iconKey && !iconUrl}
                onClick={() => {
                  onPick(b.key)
                  setAnchor(null)
                }}
              >
                <InstanceIcon inst={{ iconKey: b.key, iconUrl: null }} size={38} />
              </button>
            ))}
          </div>
          {onPickFile && (
            <>
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={async () => {
                  setAnchor(null)
                  const [file] = await api.app.pickFiles({ title: 'Escolher ícone', filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }] })
                  if (file) onPickFile(file)
                }}
              >
                <ImagePlus /> Escolher imagem…
              </button>
            </>
          )}
        </Popover>
      )}
    </>
  )
}
