// Development-only end-to-end check: creates an instance, launches it with a temporary
// offline profile, waits until the game finishes loading, then cleans everything up.
// Run with:  PRISMA_SELFTEST=1 PRISMA_DEV_OFFLINE=1 electron .
// Optional:  PRISMA_SELFTEST_LOADER=forge|fabric|quilt|neoforge|vanilla  PRISMA_SELFTEST_MC=1.20.1

import type { LoaderId } from '@shared/types'
import { addOffline, listAccounts, removeAccount, setActive } from './auth/accounts'
import { listContent } from './instances/content'
import { createInstance, deleteInstance } from './instances/instances'
import { gameEvents, killGame, launchInstance } from './minecraft/launch'
import { listLoaderVersions, listVersions } from './minecraft/meta'
import { LOADER_UIDS } from '@shared/types'
import { taskEvents } from './tasks'

const LOADED = /Sound engine started|textures\/atlas\/blocks\.png-atlas|Created: \d+x\d+x\d+ minecraft:textures\/atlas/
const WINDOW = /Backend library: LWJGL|LWJGL Version/

export async function selfTest(): Promise<boolean> {
  const log = (...a: unknown[]): void => console.log('[selftest]', ...a)
  if (process.env['PRISMA_SELFTEST'] === 'cf-zip') {
    const path = await import('path')
    const { promises: fs } = await import('fs')
    const { importFromZip } = await import('./curseforge/curseforge')
    const { getInstance, deleteInstance } = await import('./instances/instances')
    const zip = process.env['PRISMA_SELFTEST_ZIP'] ?? ''
    const r = await importFromZip(zip)
    const inst = await getInstance(r.instanceId)
    const cfg = await fs.readdir(path.join(inst.gameDir, 'config')).catch(() => [] as string[])
    const jars = (await fs.readdir(path.join(inst.gameDir, 'mods')).catch(() => [] as string[])).filter((f) => f.endsWith('.jar'))
    log(`importou: ${inst.name} / ${inst.loader} ${inst.loaderVersion} / mc ${inst.mcVersion} / configs=${cfg.length} / mods-baixados=${jars.length} / faltando=${r.blocked.length}`)
    log(`faltando (ex): ${r.blocked.slice(0, 5).map((b) => b.name).join(' | ')}`)
    const ok = inst.loader === 'forge' && inst.mcVersion === '1.20.1' && cfg.length > 10 && jars.length > 0
    if (process.env['PRISMA_SELFTEST_KEEP'] !== '1') await deleteInstance(r.instanceId).catch(() => undefined)
    log(ok ? 'SELFTEST OK' : 'SELFTEST FALHOU')
    return ok
  }
  if (process.env['PRISMA_SELFTEST'] === 'cf-folder') {
    const os = await import('os')
    const path = await import('path')
    const { promises: fs } = await import('fs')
    const { importFolder } = await import('./curseforge/curseforge')
    const { getInstance, deleteInstance } = await import('./instances/instances')
    const tmp = path.join(os.tmpdir(), `lumen-cf-${Date.now()}`)
    await fs.mkdir(path.join(tmp, 'mods'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'mods', 'testmod.jar'), 'dummy')
    await fs.mkdir(path.join(tmp, 'config'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'config', 'x.toml'), 'a=1')
    await fs.writeFile(path.join(tmp, 'minecraftinstance.json'), JSON.stringify({ name: 'Pack Teste CF', baseModLoader: { name: 'forge-47.4.10', forgeVersion: '47.4.10', minecraftVersion: '1.20.1' }, installedModpack: { addonID: 123456, name: 'Pack Teste CF' } }))
    try {
      const r = await importFolder(tmp, null)
      const inst = await getInstance(r.instanceId)
      const mods = await fs.readdir(path.join(inst.gameDir, 'mods')).catch(() => [] as string[])
      const ok = inst.loader === 'forge' && inst.mcVersion === '1.20.1' && mods.includes('testmod.jar') && inst.managedPack?.type === 'flame'
      log(`importou: ${inst.name} / ${inst.loader} ${inst.loaderVersion} / mc ${inst.mcVersion} / mods=${mods.join(',')} / managed=${inst.managedPack?.type}`)
      await deleteInstance(r.instanceId).catch(() => undefined)
      log(ok ? 'SELFTEST OK' : 'SELFTEST FALHOU')
      return ok
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  if (process.env['PRISMA_SELFTEST'] === 'server') {
    const { createServer, acceptEula, deleteServer } = await import('./servers/servers')
    const { startServer, stopServer, serverRunEvents } = await import('./servers/run')
    const loader = (process.env['PRISMA_SELFTEST_LOADER'] ?? 'vanilla') as LoaderId
    const mc = process.env['PRISMA_SELFTEST_MC'] ?? '1.20.1'
    log(`criando servidor ${loader} ${mc}…`)
    const srv = await createServer({ name: `Selftest srv ${loader}`, mcVersion: mc, loader, loaderVersion: null, onlineMode: false, fromInstanceId: null, worldFolder: null, copyMods: false, copyConfig: false })
    log(`servidor criado: ${srv.id}; aceitando EULA`)
    await acceptEula(srv.id)
    let done = false
    serverRunEvents.on('log', (_id, lines: { text: string; level: string }[]) => {
      for (const l of lines) {
        if (/Done \(|FAILED TO BIND|Starting Minecraft server|ERROR/.test(l.text)) console.log('[srv]', l.text.slice(0, 160))
        if (/Done \(/.test(l.text)) done = true
      }
    })
    const started = Date.now()
    await startServer(srv.id)
    await Promise.race([
      new Promise<void>((r) => serverRunEvents.on('state', (s: { status: string }) => s.status === 'stopped' && r())),
      new Promise<void>((r) => {
        const iv = setInterval(() => {
          if (done || Date.now() - started > 240000) {
            clearInterval(iv)
            r()
          }
        }, 500)
      })
    ])
    log(`servidor ${done ? 'INICIOU (Done)' : 'NÃO iniciou'} em ${Math.round((Date.now() - started) / 1000)}s`)
    stopServer(srv.id)
    await new Promise((r) => setTimeout(r, 6000))
    if (process.env['PRISMA_SELFTEST_KEEP'] !== '1') await deleteServer(srv.id).catch(() => undefined)
    log(done ? 'SELFTEST OK' : 'SELFTEST FALHOU')
    return done
  }
  if (process.env['PRISMA_SELFTEST'] === 'offline-create') {
    const before = await listAccounts()
    log(`contas antes: ${before.length} (msa: ${before.filter((a) => a.type === 'msa').length})`)
    try {
      const acc = await addOffline(process.env['PRISMA_SELFTEST_NAME'] ?? 'TesteOffline')
      log(`CRIOU perfil offline: ${acc.name} uuid=${acc.uuid} ativa=${acc.active}`)
      await removeAccount(acc.id)
      log('OK — criado sem conta Microsoft')
      return true
    } catch (e) {
      log('FALHOU:', (e as Error).message)
      return false
    }
  }
  if (process.env['PRISMA_SELFTEST'] === 'content') {
    const id = process.env['PRISMA_SELFTEST_ID'] ?? ''
    const t = Date.now()
    const items = await Promise.race([listContent(id, 'mods'), new Promise<null>((r) => setTimeout(() => r(null), 20000))])
    log(items ? `${items.length} mods em ${Date.now() - t}ms; ex: ${items.slice(0, 3).map((i) => `${i.name} ${i.version}`).join(' | ')}` : 'TIMEOUT')
    return !!items
  }
  const loader = (process.env['PRISMA_SELFTEST_LOADER'] ?? 'forge') as LoaderId
  const mc = process.env['PRISMA_SELFTEST_MC'] ?? '1.20.1'
  const timeoutMs = Number(process.env['PRISMA_SELFTEST_TIMEOUT'] ?? 300000)

  let loaderVersion: string | null = null
  if (loader !== 'vanilla') {
    const list = loader === 'fabric' || loader === 'quilt' ? await listVersions(LOADER_UIDS[loader]) : await listLoaderVersions(LOADER_UIDS[loader], mc)
    loaderVersion = (list.find((v) => v.recommended) ?? list[0])?.version ?? null
  }
  log(`instância: ${loader} ${loaderVersion ?? ''} / Minecraft ${mc}`)

  const before = new Set((await listAccounts()).map((a) => a.id))
  const prevActive = (await listAccounts()).find((a) => a.active)?.id
  const acc = await addOffline('PrismaTester')
  await setActive(acc.id)
  const inst = await createInstance({ name: `Selftest ${loader} ${mc}`, group: null, iconKey: 'glass:flask', mcVersion: mc, loader, loaderVersion })

  let lastDetail = ''
  taskEvents.on('update', (t) => {
    const line = `${t.title}: ${t.detail}${t.progress !== null ? ` ${Math.round(t.progress * 100)}%` : ''}`
    if (t.detail !== lastDetail && (t.progress === null || Math.round((t.progress ?? 0) * 100) % 25 === 0 || t.state !== 'running')) console.log('[task]', line)
    lastDetail = t.detail
  })

  let windowUp = false
  let loaded = false
  let exited: number | null | undefined
  const done = new Promise<void>((resolve) => {
    gameEvents.on('log', (_id, lines: { text: string; level: string }[]) => {
      for (const l of lines) {
        if (l.level === 'launcher' || l.level === 'error' || WINDOW.test(l.text) || LOADED.test(l.text)) console.log(`[game:${l.level}]`, l.text.slice(0, 300))
        if (WINDOW.test(l.text)) windowUp = true
        if (LOADED.test(l.text)) {
          loaded = true
          resolve()
        }
      }
    })
    gameEvents.on('state', (s: { state: string; exitCode?: number | null }) => {
      log('estado:', s.state, s.exitCode ?? '')
      if (s.state === 'exited') {
        exited = s.exitCode
        resolve()
      }
    })
    setTimeout(resolve, timeoutMs)
  })

  const started = Date.now()
  try {
    await launchInstance(inst.id)
    await done
  } catch (e) {
    log('ERRO ao iniciar:', (e as Error).message)
  }
  log(`resultado: janela=${windowUp} carregado=${loaded} saída=${exited ?? 'rodando'} em ${Math.round((Date.now() - started) / 1000)}s`)

  if (process.env['PRISMA_SELFTEST_KEEP'] === '1') {
    log('mantendo o jogo aberto (PRISMA_SELFTEST_KEEP=1); encerre o processo para sair')
    await new Promise(() => undefined) // keep Electron (and the child game) alive
  }
  killGame(inst.id)
  await new Promise((r) => setTimeout(r, 3000))
  for (const a of await listAccounts()) if (!before.has(a.id)) await removeAccount(a.id)
  if (prevActive) await setActive(prevActive)
  if (process.env['PRISMA_SELFTEST_KEEP'] !== '1') await deleteInstance(inst.id).catch((e) => log('limpeza:', e.message))
  log(loaded ? 'SELFTEST OK' : 'SELFTEST FALHOU')
  return loaded
}
