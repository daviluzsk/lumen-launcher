// Microsoft account login using the OAuth device code flow, followed by the same
// Xbox Live → XSTS → Minecraft services chain that Prism's auth steps implement.
// Tokens are encrypted at rest with Electron safeStorage (Windows DPAPI).

import { safeStorage } from 'electron'
import { EventEmitter } from 'events'
import { createHash, randomUUID } from 'crypto'
import type { Account, LoginEvent } from '@shared/types'
import { getJson, HttpError, postForm, postJson } from '../net/http'
import { paths } from '../paths'
import { getSettings } from '../settings'
import { readJson, writeJson } from '../util/fsx'

export const accountEvents = new EventEmitter()

const SCOPE = 'XboxLive.SignIn XboxLive.offline_access'
const MS = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'

interface Stored {
  id: string
  type: 'msa' | 'offline'
  name: string
  uuid: string
  skinUrl: string | null
  active: boolean
  refresh?: string
  mcToken?: string
  mcExpires?: number
  status?: Account['status']
}

let accounts: Stored[] = []
let loaded = false

const seal = (s: string): string => (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : 'raw:' + s)
const unseal = (s?: string): string => {
  if (!s) return ''
  if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'))
  return s.replace(/^raw:/, '')
}

async function load(): Promise<void> {
  if (loaded) return
  accounts = (await readJson<{ accounts?: Stored[] }>(paths.accounts, {})).accounts ?? []
  loaded = true
}

async function save(): Promise<void> {
  await writeJson(paths.accounts, { formatVersion: 1, accounts }, 2)
  accountEvents.emit('changed')
}

const toPublic = (a: Stored): Account => ({
  id: a.id,
  type: a.type,
  name: a.name,
  uuid: a.uuid,
  skinUrl: a.skinUrl,
  active: a.active,
  status: a.status ?? 'ok'
})

export async function listAccounts(): Promise<Account[]> {
  await load()
  return accounts.map(toPublic)
}

export async function setActive(id: string): Promise<void> {
  await load()
  for (const a of accounts) a.active = a.id === id
  await save()
}

export async function removeAccount(id: string): Promise<void> {
  await load()
  const wasActive = accounts.find((a) => a.id === id)?.active
  accounts = accounts.filter((a) => a.id !== id)
  if (wasActive && accounts[0]) accounts[0].active = true
  await save()
}

/** Offline UUID derivation used by vanilla servers: UUID v3 of "OfflinePlayer:<name>". */
export function offlineUuid(name: string): string {
  const b = createHash('md5').update(`OfflinePlayer:${name}`).digest()
  b[6] = (b[6] & 0x0f) | 0x30
  b[8] = (b[8] & 0x3f) | 0x80
  return b.toString('hex')
}

export async function addOffline(name: string): Promise<Account> {
  await load()
  const clean = name.trim()
  if (!/^[A-Za-z0-9_]{3,16}$/.test(clean)) throw new Error('Use de 3 a 16 caracteres: letras, números ou _')
  // Offline profiles can be created freely (no Microsoft account required).
  if (accounts.some((a) => a.type === 'offline' && a.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`Já existe um perfil offline chamado "${clean}".`)
  }
  const acc: Stored = { id: randomUUID(), type: 'offline', name: clean, uuid: offlineUuid(clean), skinUrl: null, active: !accounts.length }
  accounts.push(acc)
  await save()
  return toPublic(acc)
}

const XSTS_ERRORS: Record<string, string> = {
  '2148916233': 'Esta conta Microsoft não tem um perfil Xbox. Crie um em xbox.com e tente de novo.',
  '2148916235': 'O Xbox Live não está disponível no seu país.',
  '2148916236': 'A conta precisa de verificação de idade (Coreia do Sul).',
  '2148916237': 'A conta precisa de verificação de idade (Coreia do Sul).',
  '2148916238': 'Conta de menor de idade: um adulto precisa adicioná-la a um grupo familiar Microsoft.'
}

interface McAuth {
  token: string
  expires: number
  name: string
  uuid: string
  skinUrl: string | null
}

async function minecraftFromMsa(msaAccess: string, progress: (s: string) => void): Promise<McAuth> {
  progress('Autenticando no Xbox Live…')
  const xbl = await postJson<{ Token: string; DisplayClaims: { xui: { uhs: string }[] } }>(
    'https://user.auth.xboxlive.com/user/authenticate',
    { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msaAccess}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' },
    { 'x-xbl-contract-version': '1' }
  )
  const uhs = xbl.DisplayClaims.xui[0].uhs

  progress('Autorizando com o XSTS…')
  let xsts: { Token: string }
  try {
    xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  } catch (e) {
    if (e instanceof HttpError) {
      let code = ''
      try {
        code = String(JSON.parse(e.body).XErr ?? '')
      } catch {
        /* non-JSON error body */
      }
      throw new Error(XSTS_ERRORS[code] ?? `Falha no XSTS (${code || e.status})`)
    }
    throw e
  }

  progress('Obtendo token do Minecraft…')
  const xtoken = `XBL3.0 x=${uhs};${xsts.Token}`
  let mc: { access_token: string; expires_in: number }
  try {
    mc = await postJson('https://api.minecraftservices.com/launcher/login', { xtoken, platform: 'PC_LAUNCHER' })
  } catch {
    mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: xtoken })
  }

  progress('Carregando perfil…')
  let profile: { id: string; name: string; skins?: { url: string; state: string }[] }
  try {
    profile = await getJson('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: `Bearer ${mc.access_token}` } })
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new Error('Esta conta não possui o Minecraft: Java Edition (ou ainda não criou um perfil).')
    throw e
  }
  const skin = profile.skins?.find((s) => s.state === 'ACTIVE')?.url ?? null
  return {
    token: mc.access_token,
    expires: Date.now() + mc.expires_in * 1000,
    name: profile.name,
    uuid: profile.id,
    skinUrl: skin ? skin.replace(/^http:/, 'https:') : null
  }
}

let loginCancel: (() => void) | null = null

export function cancelLogin(): void {
  loginCancel?.()
  loginCancel = null
}

export async function loginMicrosoft(emit: (e: LoginEvent) => void): Promise<void> {
  await load()
  cancelLogin()
  let cancelled = false
  loginCancel = () => (cancelled = true)
  const clientId = getSettings().msaClientId
  try {
    const dc = await postForm<{ user_code: string; device_code: string; verification_uri: string; expires_in: number; interval: number; error_description?: string }>(
      `${MS}/devicecode`,
      { client_id: clientId, scope: SCOPE }
    )
    if (!dc.ok) throw new Error(dc.data.error_description ?? 'Não foi possível iniciar o login Microsoft')
    emit({ type: 'code', userCode: dc.data.user_code, verificationUri: dc.data.verification_uri, expiresIn: dc.data.expires_in })

    let interval = Math.max(2, dc.data.interval || 5) * 1000
    const deadline = Date.now() + dc.data.expires_in * 1000
    let tokens: { access_token: string; refresh_token: string } | null = null
    while (!tokens) {
      await new Promise((r) => setTimeout(r, interval))
      if (cancelled) return
      if (Date.now() > deadline) throw new Error('O código expirou. Tente novamente.')
      const res = await postForm<{ access_token: string; refresh_token: string; error?: string; error_description?: string }>(`${MS}/token`, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: dc.data.device_code
      })
      if (res.ok) tokens = res.data
      else if (res.data.error === 'slow_down') interval += 5000
      else if (res.data.error !== 'authorization_pending') {
        throw new Error(res.data.error === 'authorization_declined' ? 'Login recusado.' : (res.data.error_description ?? 'Falha no login'))
      }
    }

    const mc = await minecraftFromMsa(tokens.access_token, (step) => emit({ type: 'progress', step }))
    if (cancelled) return
    const existing = accounts.find((a) => a.type === 'msa' && a.uuid === mc.uuid)
    const acc: Stored = existing ?? { id: randomUUID(), type: 'msa', name: mc.name, uuid: mc.uuid, skinUrl: null, active: false }
    Object.assign(acc, { name: mc.name, skinUrl: mc.skinUrl, refresh: seal(tokens.refresh_token), mcToken: seal(mc.token), mcExpires: mc.expires, status: 'ok' })
    if (!existing) accounts.push(acc)
    for (const a of accounts) a.active = a.id === acc.id
    await save()
    emit({ type: 'done', account: toPublic(acc) })
  } catch (e) {
    if (!cancelled) emit({ type: 'error', message: (e as Error).message })
  } finally {
    if (!cancelled) loginCancel = null
  }
}

async function refreshMsa(acc: Stored): Promise<void> {
  const res = await postForm<{ access_token: string; refresh_token: string; error_description?: string }>(`${MS}/token`, {
    grant_type: 'refresh_token',
    client_id: getSettings().msaClientId,
    refresh_token: unseal(acc.refresh),
    scope: SCOPE
  })
  if (!res.ok) {
    acc.status = 'expired'
    await save()
    throw new Error('A sessão Microsoft expirou. Entre novamente na aba Contas.')
  }
  const mc = await minecraftFromMsa(res.data.access_token, () => undefined)
  Object.assign(acc, { name: mc.name, skinUrl: mc.skinUrl, refresh: seal(res.data.refresh_token), mcToken: seal(mc.token), mcExpires: mc.expires, status: 'ok' })
  await save()
}

export async function refreshAccount(id: string): Promise<Account> {
  await load()
  const acc = accounts.find((a) => a.id === id)
  if (!acc) throw new Error('Conta não encontrada')
  if (acc.type === 'msa') await refreshMsa(acc)
  return toPublic(acc)
}

export interface LaunchSession {
  name: string
  uuid: string
  accessToken: string
  // Same values Prism Launcher passes to --userType: "msa" for Microsoft, "offline" for offline
  // profiles. Offline accounts play the full single-player game (not demo); they just can't join
  // online-mode (premium) servers, which is Minecraft's own rule, not something a launcher sets.
  userType: 'msa' | 'offline'
}

/** Resolves the account for a launch: the instance's pinned account if set and present, else the active one. */
export async function getLaunchSession(accountId?: string | null): Promise<LaunchSession> {
  await load()
  const acc = (accountId ? accounts.find((a) => a.id === accountId) : undefined) ?? accounts.find((a) => a.active) ?? accounts[0]
  if (!acc) throw new Error('Nenhuma conta configurada. Adicione uma conta na aba Contas.')
  if (acc.type === 'offline') return { name: acc.name, uuid: acc.uuid, accessToken: '0', userType: 'offline' }
  if (!acc.mcToken || !acc.mcExpires || acc.mcExpires < Date.now() + 5 * 60 * 1000) await refreshMsa(acc)
  return { name: acc.name, uuid: acc.uuid, accessToken: unseal(acc.mcToken), userType: 'msa' }
}
