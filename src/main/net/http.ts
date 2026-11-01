import { app } from 'electron'

export const USER_AGENT = `Lumen/${app.getVersion()} (Liquid Glass fork of Prism Launcher)`

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string
  ) {
    super(`HTTP ${status} em ${new URL(url).host}`)
  }
}

export async function request(url: string, init: RequestInit = {}, retries = 2, timeoutMs = 45000): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // A timeout signal stops a stalled connection from hanging the whole import.
      const res = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string> | undefined) }
      })
      if (res.status >= 500 && attempt < retries) {
        lastErr = new HttpError(res.status, url, '')
      } else {
        return res
      }
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Falha de rede: ${url}`)
}

export async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await request(url, init)
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''))
  return (await res.json()) as T
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body)
  }, 0)
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''))
  return (await res.json()) as T
}

export async function postForm<T>(url: string, form: Record<string, string>): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString()
  }, 0)
  const data = (await res.json().catch(() => ({}))) as T
  return { ok: res.ok, status: res.status, data }
}
