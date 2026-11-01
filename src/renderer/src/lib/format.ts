import { type Instance, LOADER_NAMES } from '@shared/types'

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

export function timeAgo(ms: number): string {
  if (!ms) return 'Nunca jogado'
  const diff = (ms - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'agora mesmo'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function duration(seconds: number): string {
  if (!seconds) return '0 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h >= 100) return `${h} h`
  if (h) return `${h} h ${m} min`
  return `${Math.max(1, m)} min`
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`
}

const compactFmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
export const compact = (n: number): string => compactFmt.format(n)

export function versionLabel(i: Pick<Instance, 'loader' | 'mcVersion' | 'loaderVersion'>): string {
  const mc = i.mcVersion ?? '?'
  return i.loader === 'vanilla' ? `Minecraft ${mc}` : `${LOADER_NAMES[i.loader]} ${mc}`
}

export function memLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB` : `${mb} MB`
}

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ')
