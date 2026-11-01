import { Coffee, Cpu, ExternalLink, FolderOpen, Gauge, ImagePlus, Info, Moon, Package, RefreshCw, RotateCw, Sparkles, Sun, SunMoon, Wallpaper as WallpaperIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { JavaInstall, Settings } from '@shared/types'
import { FormRow, GlyphTile, Segmented, Select, Slider, Switch } from '../components/ui'
import { api } from '../lib/api'
import { memLabel } from '../lib/format'
import { guard, toast, updateSettings, useStore } from '../lib/store'
import { ACCENTS, WALLPAPERS, wallpaperPreview } from '../lib/wallpapers'

const PRISM_CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb'

function UpdateRow(): React.JSX.Element {
  const u = useStore((s) => s.update)
  const [checked, setChecked] = useState(false)
  const label =
    u.state === 'checking' ? 'Procurando…'
    : u.state === 'downloading' ? `Baixando ${u.percent ?? 0}%`
    : u.state === 'ready' ? `Pronto: versão ${u.version}`
    : u.state === 'none' ? (checked ? 'Você já está na versão mais recente' : 'Atualizações automáticas ligadas')
    : u.state === 'error' ? `Erro: ${u.message ?? 'falha ao checar'}`
    : u.state === 'disabled' ? 'Disponível só na versão instalada' : 'Atualizações automáticas ligadas'
  return (
    <FormRow label="Atualizações" hint={label}>
      {u.state === 'ready' ? (
        <button className="btn sm accent" onClick={() => void api.update.install()}>
          <RotateCw /> Reiniciar e atualizar
        </button>
      ) : (
        <button
          className="btn sm"
          disabled={u.state === 'checking' || u.state === 'downloading' || u.state === 'disabled'}
          onClick={() => {
            setChecked(true)
            void api.update.check()
          }}
        >
          <RefreshCw className={u.state === 'checking' ? 'spin' : undefined} /> Procurar agora
        </button>
      )}
    </FormRow>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: 8 }}>{title}</div>
      <div className="group glass thin">{children}</div>
    </div>
  )
}

export function SettingsView(): React.JSX.Element {
  const s = useStore((st) => st.settings)
  const info = useStore((st) => st.info)
  const [javas, setJavas] = useState<JavaInstall[] | null>(null)
  const [scanning, setScanning] = useState(false)

  const scan = (force = false): void => {
    setScanning(true)
    void api.java
      .list(force)
      .then(setJavas)
      .finally(() => setScanning(false))
  }
  useEffect(() => scan(), [])

  if (!s) return <div className="page" />
  const set = (p: Partial<Settings>): void => void updateSettings(p)
  const totalMem = info?.totalMemoryMb ?? 8192

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="large-title">Ajustes</h1>
      </div>
      <div className="page-scroll">
        <div className="settings-wrap">
          <Section title="Aparência">
            <FormRow label="Tema">
              <Segmented
                value={s.theme}
                onChange={(v) => set({ theme: v })}
                options={[
                  { value: 'auto', label: 'Auto', icon: SunMoon },
                  { value: 'light', label: 'Claro', icon: Sun },
                  { value: 'dark', label: 'Escuro', icon: Moon }
                ]}
              />
            </FormRow>
            <FormRow label="Cor de destaque">
              <div className="swatches">
                {ACCENTS.map((a) => (
                  <button key={a.id} className="swatch" data-tip={a.name} aria-pressed={s.accent === a.id} style={{ background: a.color }} onClick={() => set({ accent: a.id })} />
                ))}
              </div>
            </FormRow>
            <FormRow label="Fundo da janela" hint={info?.supportsMaterial ? 'Acrílico e Mica deixam a área de trabalho aparecer através da janela' : 'Acrílico e Mica exigem Windows 11 22H2+'}>
              <Segmented
                value={s.windowMaterial}
                onChange={(v) => set({ windowMaterial: v })}
                options={[
                  ...(info?.supportsMaterial
                    ? [
                        { value: 'acrylic' as const, label: 'Acrílico' },
                        { value: 'mica' as const, label: 'Mica' }
                      ]
                    : []),
                  { value: 'wallpaper' as const, label: 'Papel de parede' }
                ]}
              />
            </FormRow>
            {s.windowMaterial === 'wallpaper' && (
              <>
            <div className="group-row" style={{ flexDirection: 'column', alignItems: 'stretch', padding: 0 }}>
              <div className="row" style={{ padding: '12px 16px 0' }}>
                <GlyphTile icon={WallpaperIcon} from="#c0a6ff" to="#6a3dff" />
                <span>Papel de parede</span>
              </div>
              <div className="wp-grid">
                {WALLPAPERS.map((w) => (
                  <button key={w.id} className="wp-thumb" aria-pressed={s.wallpaper === w.id} onClick={() => set({ wallpaper: w.id })}>
                    <div className="img" style={{ background: wallpaperPreview(w) }} />
                    {w.name}
                  </button>
                ))}
                <button
                  className="wp-thumb"
                  aria-pressed={s.wallpaper === 'custom'}
                  onClick={async () => {
                    if (s.customWallpaper && s.wallpaper !== 'custom') return set({ wallpaper: 'custom' })
                    const [file] = await api.app.pickFiles({ title: 'Escolher papel de parede', filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
                    if (file) await guard(() => api.app.setWallpaper(file))
                  }}
                  onContextMenu={async () => {
                    const [file] = await api.app.pickFiles({ title: 'Escolher papel de parede', filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
                    if (file) await guard(() => api.app.setWallpaper(file))
                  }}
                >
                  <div className="img" style={s.customWallpaper ? { backgroundImage: `url("${s.customWallpaper}")` } : { background: 'var(--fill-2)' }}>
                    {!s.customWallpaper && <ImagePlus size={20} />}
                  </div>
                  {s.customWallpaper ? 'Personalizado' : 'Escolher…'}
                </button>
              </div>
            </div>
            <FormRow label="Papel de parede animado">
              <Switch checked={s.animatedWallpaper} onChange={(v) => set({ animatedWallpaper: v })} />
            </FormRow>
              </>
            )}
            <FormRow label="Refração líquida" hint="Bordas que distorcem o fundo como vidro de verdade">
              <Switch checked={s.refraction} onChange={(v) => set({ refraction: v })} />
            </FormRow>
            <FormRow label="Reduzir transparência" hint="Materiais sólidos, melhor desempenho">
              <Switch checked={s.reduceTransparency} onChange={(v) => set({ reduceTransparency: v })} />
            </FormRow>
          </Section>

          <Section title="Java">
            <FormRow label="Escolher Java automaticamente" hint="Usa a versão exigida por cada Minecraft e baixa se faltar">
              <Switch checked={s.autoJava} onChange={(v) => set({ autoJava: v })} />
            </FormRow>
            {!s.autoJava && (
              <FormRow label="Java padrão">
                <Select
                  width={280}
                  value={s.javaPath || null}
                  placeholder="Selecionar"
                  onChange={(v) => set({ javaPath: v })}
                  options={(javas ?? []).map((j) => ({ value: j.path, label: `Java ${j.major} · ${j.vendor || j.arch}`, hint: j.version }))}
                />
              </FormRow>
            )}
            <div className="group-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row">
                <GlyphTile icon={Coffee} from="#ffb88a" to="#c0532a" />
                <span style={{ flex: 1 }}>Instalações encontradas</span>
                <button className="btn sm ghost" onClick={() => scan(true)}>
                  <RefreshCw className={scanning ? 'spin' : undefined} /> Procurar
                </button>
              </div>
              <div className="col" style={{ gap: 6, marginTop: 6 }}>
                {javas === null && <span className="caption">Procurando…</span>}
                {javas?.length === 0 && <span className="caption">Nenhum Java encontrado — o Lumen baixa automaticamente quando precisar.</span>}
                {javas?.map((j) => (
                  <div key={j.path} className="row java-row" style={{ padding: '4px 0' }}>
                    <span className="badge accent">Java {j.major}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5 }}>
                        {j.version} · {j.vendor} · {j.arch}
                        {j.managed && <span className="badge green" style={{ marginLeft: 6 }}>Lumen</span>}
                      </div>
                      <div className="path truncate">{j.path}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="caption" style={{ flex: 1 }}>Baixar runtime:</span>
                {[8, 17, 21, 25].map((m) => (
                  <button
                    key={m}
                    className="btn sm"
                    onClick={async () => {
                      const j = await guard(() => api.java.download(m), `Falha ao baixar Java ${m}`)
                      if (j) {
                        toast('success', `Java ${m} instalado`, j.version)
                        scan(true)
                      }
                    }}
                  >
                    Java {m}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Memória e desempenho">
            <FormRow label="Memória máxima" hint={`${memLabel(s.maxMem)} de ${memLabel(totalMem)}`}>
              <div style={{ width: 300 }}>
                <Slider value={s.maxMem} min={1024} max={Math.max(2048, totalMem)} step={256} onChange={(v) => set({ maxMem: v, minMem: Math.min(s.minMem, v) })} />
              </div>
            </FormRow>
            <FormRow label="Memória mínima" hint={memLabel(s.minMem)}>
              <div style={{ width: 300 }}>
                <Slider value={s.minMem} min={256} max={s.maxMem} step={256} onChange={(v) => set({ minMem: v })} />
              </div>
            </FormRow>
            <div className="group-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="row">
                <GlyphTile icon={Cpu} from="#8af0c8" to="#1a8a6a" />
                <span>Argumentos JVM</span>
              </div>
              <input className="field mono" style={{ fontSize: 12 }} value={s.jvmArgs} placeholder="-XX:+UseG1GC" onChange={(e) => set({ jvmArgs: e.target.value })} />
            </div>
            <FormRow label="Downloads simultâneos" hint={`${s.concurrentDownloads} conexões`}>
              <div style={{ width: 220 }}>
                <Slider value={s.concurrentDownloads} min={2} max={48} step={1} onChange={(v) => set({ concurrentDownloads: v })} />
              </div>
            </FormRow>
          </Section>

          <Section title="Jogo">
            <FormRow label="Tamanho da janela">
              <input className="field" type="number" style={{ width: 90 }} value={s.width} onChange={(e) => set({ width: Number(e.target.value) || 854 })} />
              <span className="tertiary">×</span>
              <input className="field" type="number" style={{ width: 90 }} value={s.height} onChange={(e) => set({ height: Number(e.target.value) || 480 })} />
            </FormRow>
            <FormRow label="Ao abrir o jogo">
              <Select
                width={220}
                value={s.onLaunch}
                onChange={(v) => set({ onLaunch: v })}
                options={[
                  { value: 'keep', label: 'Manter o Lumen aberto' },
                  { value: 'minimize', label: 'Minimizar o Lumen' },
                  { value: 'hide', label: 'Esconder o Lumen' }
                ]}
              />
            </FormRow>
            <FormRow label="Mostrar console ao iniciar">
              <Switch checked={s.showConsoleOnLaunch} onChange={(v) => set({ showConsoleOnLaunch: v })} />
            </FormRow>
          </Section>

          <Section title="Pastas">
            <FormRow label="Instâncias" hint={s.instancesDir}>
              <button
                className="btn sm"
                onClick={async () => {
                  const dir = await api.app.pickFolder('Pasta de instâncias')
                  if (dir) set({ instancesDir: dir })
                }}
              >
                Alterar…
              </button>
              <button className="btn sm icon ghost" data-tip="Abrir" onClick={() => void api.app.openPath(s.instancesDir)}>
                <FolderOpen />
              </button>
            </FormRow>
            {info?.prismDataDir && (
              <FormRow label="Compartilhar downloads com o Prism" hint="Usa as bibliotecas e assets já baixados pelo Prism Launcher">
                <Switch checked={s.shareWithPrism} onChange={(v) => set({ shareWithPrism: v })} />
              </FormRow>
            )}
            {info?.prismDataDir && (
              <FormRow label="Prism Launcher encontrado" hint="Use as mesmas instâncias nos dois launchers">
                <button className="btn sm tinted" onClick={() => set({ instancesDir: `${info.prismDataDir}\\instances` })}>
                  Usar instâncias do Prism
                </button>
              </FormRow>
            )}
            <FormRow label="Dados do Lumen" hint={info?.dataDir}>
              <button className="btn sm icon ghost" data-tip="Abrir" onClick={() => info && void api.app.openPath(info.dataDir)}>
                <FolderOpen />
              </button>
            </FormRow>
          </Section>

          <Section title="Avançado">
            <div className="group-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="row">
                <GlyphTile icon={Gauge} from="#b6c8e8" to="#4a5f8a" />
                <div className="label" style={{ flex: 1 }}>
                  <div>Client ID da Microsoft (Azure)</div>
                  <div className="caption">Padrão: o mesmo ID público usado pelas builds do Prism Launcher.</div>
                </div>
                {s.msaClientId !== PRISM_CLIENT_ID && (
                  <button className="btn sm ghost" onClick={() => set({ msaClientId: PRISM_CLIENT_ID })}>
                    Restaurar
                  </button>
                )}
              </div>
              <input className="field mono" style={{ fontSize: 12 }} value={s.msaClientId} onChange={(e) => set({ msaClientId: e.target.value })} />
            </div>
            <div className="group-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="row">
                <GlyphTile icon={Package} from="#ff9f6a" to="#e0533a" />
                <div className="label" style={{ flex: 1 }}>
                  <div>Chave de API do CurseForge</div>
                  <div className="caption">Necessária para importar modpacks do CurseForge. Pegue a sua grátis no console do CurseForge.</div>
                </div>
                <button className="btn sm" onClick={() => void api.app.openExternal('https://console.curseforge.com/?#/api-keys')}>
                  <ExternalLink /> Obter chave
                </button>
              </div>
              <input className="field mono" style={{ fontSize: 12 }} placeholder="Cole aqui a sua chave de API" value={s.curseforgeApiKey} onChange={(e) => set({ curseforgeApiKey: e.target.value })} />
            </div>
          </Section>

          <Section title="Sobre">
            <div className="group-row">
              <div className="brand-mark" style={{ width: 44, height: 44, borderRadius: 13 }}>
                <Sparkles />
              </div>
              <div className="label">
                <div style={{ fontWeight: 700, fontSize: 15 }}>Lumen {info?.version}</div>
                <div className="caption">Launcher de Minecraft com interface Liquid Glass. Recriado a partir do Prism Launcher — software livre sob a GPL-3.0.</div>
              </div>
            </div>
            <UpdateRow />
            <FormRow label="Créditos" hint="Prism Launcher, MultiMC, Modrinth, ForgeWrapper">
              <button className="btn sm" onClick={() => void api.app.openExternal('https://prismlauncher.org')}>
                <Info /> prismlauncher.org
              </button>
            </FormRow>
            <FormRow label="Atalhos">
              <span className="caption">
                <kbd>Ctrl</kbd> <kbd>N</kbd> nova instância · <kbd>Ctrl</kbd> <kbd>F</kbd> buscar · <kbd>Ctrl</kbd> <kbd>,</kbd> ajustes
              </span>
            </FormRow>
          </Section>
        </div>
      </div>
    </div>
  )
}
