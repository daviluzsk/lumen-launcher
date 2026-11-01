import { createWriteStream, promises as fs } from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import yauzl from 'yauzl'
import { ensureDir, isInside } from './fsx'

function open(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err || !zip ? reject(err) : resolve(zip)))
  )
}

function streamOf(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (err, s) => (err || !s ? reject(err) : resolve(s)))
  )
}

async function toBuffer(s: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of s) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

/** Walks every entry; the visitor may return a buffer request for that entry. */
async function walk(
  file: string,
  visit: (entry: yauzl.Entry, read: () => Promise<Buffer>, stream: () => Promise<NodeJS.ReadableStream>) => Promise<boolean | void>
): Promise<void> {
  const zip = await open(file)
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.on('entry', async (entry: yauzl.Entry) => {
        try {
          const stop = await visit(
            entry,
            async () => toBuffer(await streamOf(zip, entry)),
            () => streamOf(zip, entry)
          )
          if (stop === true) resolve()
          else zip.readEntry()
        } catch (e) {
          reject(e)
        }
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
}

/** Reads the named entries (exact paths) into memory. Missing entries are absent from the result. */
export async function readEntries(file: string, wanted: (name: string) => boolean, maxBytes = 4 * 1024 * 1024): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  await walk(file, async (entry, read) => {
    if (!entry.fileName.endsWith('/') && wanted(entry.fileName) && entry.uncompressedSize <= maxBytes) {
      out.set(entry.fileName, await read())
    }
  })
  return out
}

export async function listEntries(file: string): Promise<string[]> {
  const names: string[] = []
  await walk(file, async (entry) => {
    names.push(entry.fileName)
  })
  return names
}

/**
 * Extracts entries into dest. `map` returns the relative output path for an entry, or null to skip it.
 * Paths that would escape dest (zip-slip) are always skipped.
 */
export async function extract(file: string, dest: string, map: (name: string) => string | null = (n) => n): Promise<number> {
  let count = 0
  await walk(file, async (entry, _read, stream) => {
    const rel = map(entry.fileName)
    if (!rel) return
    const target = path.resolve(dest, rel)
    if (!isInside(target, path.resolve(dest))) return
    if (entry.fileName.endsWith('/')) {
      await ensureDir(target)
      return
    }
    await ensureDir(path.dirname(target))
    await pipeline(await stream(), createWriteStream(target))
    count++
  })
  return count
}

export async function writeBuffer(target: string, buf: Buffer): Promise<void> {
  await ensureDir(path.dirname(target))
  await fs.writeFile(target, buf)
}
