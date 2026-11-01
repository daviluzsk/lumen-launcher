// Minimal reader/writer for the Qt QSettings INI dialect Prism uses for instance.cfg.
// Unknown keys are preserved so a round trip through Lumen never loses Prism settings.

export type IniMap = Map<string, string>

function unquote(raw: string): string {
  const v = raw.trim()
  if (!(v.length >= 2 && v.startsWith('"') && v.endsWith('"'))) return v
  const body = v.slice(1, -1)
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const n = body[++i]
    if (n === 'n') out += '\n'
    else if (n === 't') out += '\t'
    else if (n === 'r') out += '\r'
    else if (n === 'x') {
      const hex = body.slice(i + 1).match(/^[0-9a-fA-F]{1,4}/)?.[0] ?? ''
      out += String.fromCharCode(parseInt(hex || '0', 16))
      i += hex.length
    } else out += n ?? ''
  }
  return out
}

function quote(v: string): string {
  if (!/[\n\r\t"\\;,=#]|^\s|\s$/.test(v)) return v
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"'
}

/** Parses the [General] section (or section-less legacy MultiMC files). */
export function parseIni(text: string): IniMap {
  const map: IniMap = new Map()
  let section = 'General'
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue
    const sec = trimmed.match(/^\[(.+)\]$/)
    if (sec) {
      section = sec[1]
      continue
    }
    if (section !== 'General') continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    map.set(line.slice(0, eq).trim(), unquote(line.slice(eq + 1)))
  }
  return map
}

export function serializeIni(map: IniMap): string {
  const lines = ['[General]']
  for (const [k, v] of map) lines.push(`${k}=${quote(v)}`)
  return lines.join('\n') + '\n'
}

export const iniBool = (map: IniMap, key: string, fallback = false): boolean => {
  const v = map.get(key)
  return v === undefined ? fallback : v === 'true' || v === '1'
}

export const iniInt = (map: IniMap, key: string, fallback = 0): number => {
  const n = parseInt(map.get(key) ?? '', 10)
  return Number.isFinite(n) ? n : fallback
}
