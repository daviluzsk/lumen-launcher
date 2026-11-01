import { createHash } from 'crypto'
import { createReadStream, promises as fs } from 'fs'
import path from 'path'

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(p: string): Promise<string> {
  await fs.mkdir(p, { recursive: true })
  return p
}

export async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Writes through a temp file so a crash never leaves half-written JSON behind. */
export async function writeFileAtomic(p: string, data: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(p))
  const tmp = `${p}.${process.pid}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, p)
}

export async function writeJson(p: string, value: unknown, indent = 4): Promise<void> {
  await writeFileAtomic(p, JSON.stringify(value, null, indent) + '\n')
}

export function hashFile(p: string, algo: 'sha1' | 'sha256' | 'sha512' = 'sha1'): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash(algo)
    createReadStream(p)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

export function hashString(s: string, algo: 'sha1' | 'sha256' | 'md5' = 'sha256'): string {
  return createHash(algo).update(s).digest('hex')
}

export async function dirSize(p: string, limit = 20000): Promise<number> {
  let total = 0
  let seen = 0
  const walk = async (d: string): Promise<void> => {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (++seen > limit) return
      const full = path.join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else {
        try {
          total += (await fs.stat(full)).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(p)
  return total
}

/** Strips characters Windows does not allow in file names. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
  return cleaned || 'Instancia'
}

export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}
