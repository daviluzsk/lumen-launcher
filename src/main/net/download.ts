import { createHash } from 'crypto'
import { createWriteStream, promises as fs } from 'fs'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { getSettings } from '../settings'
import { ensureDir, hashFile } from '../util/fsx'
import { HttpError, request } from './http'

export interface DownloadItem {
  url: string
  path: string
  sha1?: string
  size?: number
}

export interface DownloadProgress {
  done: number
  total: number
  bytes: number
  totalBytes: number
}

async function needsDownload(item: DownloadItem): Promise<boolean> {
  try {
    const st = await fs.stat(item.path)
    if (item.size && st.size !== item.size) return true
    return st.size === 0
  } catch {
    return true
  }
}

async function fetchOne(item: DownloadItem, onBytes: (n: number) => void): Promise<void> {
  await ensureDir(path.dirname(item.path))
  const part = `${item.path}.part`
  let lastErr: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    let received = 0
    try {
      // Generous timeout: these are streamed file bodies, not quick API calls.
      const res = await request(item.url, {}, 1, 10 * 60 * 1000)
      if (!res.ok || !res.body) throw new HttpError(res.status, item.url, '')
      const hash = createHash('sha1')
      const meter = new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk)
          received += chunk.length
          onBytes(chunk.length)
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), meter, createWriteStream(part))
      const digest = hash.digest('hex')
      if (item.sha1 && digest !== item.sha1.toLowerCase()) throw new Error(`Checksum inválido: ${path.basename(item.path)}`)
      await fs.rename(part, item.path)
      return
    } catch (e) {
      lastErr = e
      onBytes(-received)
      await fs.rm(part, { force: true }).catch(() => undefined)
      if (e instanceof HttpError && e.status === 404) break
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new Error(`Não foi possível baixar ${path.basename(item.path)} (${reason})`)
}

/** Downloads every missing/mismatched file with a bounded worker pool. */
export async function downloadAll(
  items: DownloadItem[],
  onProgress: (p: DownloadProgress) => void,
  concurrency = getSettings().concurrentDownloads
): Promise<void> {
  const unique = new Map<string, DownloadItem>()
  for (const it of items) unique.set(path.normalize(it.path).toLowerCase(), it)
  const checks = await Promise.all([...unique.values()].map(async (it) => ((await needsDownload(it)) ? it : null)))
  const queue = checks.filter((x): x is DownloadItem => x !== null)

  const progress: DownloadProgress = {
    done: 0,
    total: queue.length,
    bytes: 0,
    totalBytes: queue.reduce((s, i) => s + (i.size ?? 0), 0)
  }
  onProgress(progress)
  if (!queue.length) return

  let next = 0
  let failure: unknown = null
  const worker = async (): Promise<void> => {
    while (failure === null && next < queue.length) {
      const item = queue[next++]
      try {
        await fetchOne(item, (n) => {
          progress.bytes += n
          onProgress(progress)
        })
        progress.done++
        onProgress(progress)
      } catch (e) {
        failure = e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker))
  if (failure) throw failure
}

export async function downloadFile(url: string, target: string, sha1?: string): Promise<void> {
  if (!(await needsDownload({ url, path: target }))) {
    if (!sha1 || (await hashFile(target)) === sha1.toLowerCase()) return
  }
  await fetchOne({ url, path: target, sha1 }, () => undefined)
}
