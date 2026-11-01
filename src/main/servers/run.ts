// Runs a local server process: start/stop, console streaming, command input, player tracking.

import { type ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import type { LogLevel, LogLine, ServerState, ServerStatus } from '@shared/types'
import { resolveJava } from '../java/java'
import { runTask } from '../tasks'
import { getServer, hasEula, launchArgs, serverDir, serverEvents, serverJavaMajors } from './servers'
import { promises as fs } from 'fs'
import path from 'path'

export const serverRunEvents = new EventEmitter()

interface Running {
  child: ChildProcess | null
  state: ServerState
  logs: LogLine[]
  pending: LogLine[]
  stopping: boolean
}

const running = new Map<string, Running>()
const MAX_LOG = 8000

function push(r: Running, level: LogLevel, text: string): void {
  const line = { t: Date.now(), level, text }
  r.logs.push(line)
  if (r.logs.length > MAX_LOG) r.logs.splice(0, r.logs.length - MAX_LOG)
  r.pending.push(line)
}

setInterval(() => {
  for (const [id, r] of running) {
    if (!r.pending.length) continue
    serverRunEvents.emit('log', id, r.pending)
    r.pending = []
  }
}, 150)

function setStatus(r: Running, status: ServerStatus, patch: Partial<ServerState> = {}): void {
  r.state.status = status
  Object.assign(r.state, patch)
  serverRunEvents.emit('state', { ...r.state, players: [...r.state.players] })
}

export const serverStates = (): ServerState[] => [...running.values()].map((r) => ({ ...r.state, players: [...r.state.players] }))
export const serverLogs = (id: string): LogLine[] => running.get(id)?.logs ?? []
export const isServerBusy = (id: string): boolean => {
  const s = running.get(id)?.state.status
  return s === 'starting' || s === 'running' || s === 'stopping'
}

function classify(text: string): LogLevel {
  const m = text.match(/\]\s*\[[^\]]*\/(WARN|ERROR|FATAL)\]/) ?? text.match(/\/(WARN|ERROR|FATAL)\]:/)
  if (m) return m[1] === 'WARN' ? 'warn' : 'error'
  if (/^\s+at |Exception|Caused by:/.test(text)) return 'error'
  return 'info'
}

function trackPlayers(r: Running, text: string): void {
  const join = text.match(/: ([A-Za-z0-9_]{1,16}) joined the game/)
  const left = text.match(/: ([A-Za-z0-9_]{1,16}) left the game/)
  if (join && !r.state.players.includes(join[1])) {
    r.state.players.push(join[1])
    serverRunEvents.emit('state', { ...r.state, players: [...r.state.players] })
  }
  if (left) {
    r.state.players = r.state.players.filter((p) => p !== left[1])
    serverRunEvents.emit('state', { ...r.state, players: [...r.state.players] })
  }
}

export async function startServer(id: string): Promise<void> {
  if (isServerBusy(id)) throw new Error('O servidor já está em execução')
  const server = await getServer(id)
  if (!server.ready) throw new Error('Servidor ainda não instalado')
  if (!(await hasEula(id))) throw new Error('EULA_REQUIRED')

  const r: Running = { child: null, state: { serverId: id, status: 'starting', startedAt: Date.now(), players: [] }, logs: [], pending: [], stopping: false }
  running.set(id, r)
  setStatus(r, 'starting')
  push(r, 'launcher', `Iniciando "${server.name}" (${server.loader} ${server.mcVersion})…`)

  try {
    await runTask(`Iniciando ${server.name}`, async (task) => {
      const majors = await serverJavaMajors(server.mcVersion)
      const java = await resolveJava(majors, undefined, true, task)
      push(r, 'launcher', `Java ${java.version} — ${java.path}`)
      const mem = [`-Xms${Math.min(server.minMem, server.maxMem)}m`, `-Xmx${Math.max(server.minMem, server.maxMem)}m`]
      const args = [...mem, '-Dfile.encoding=UTF-8', ...launchArgs(server)]
      task.update('Abrindo o servidor…', null)

      const child = spawn(java.path.replace(/javaw\.exe$/i, 'java.exe'), args, { cwd: server.dir, windowsHide: true })
      r.child = child
      const pipe = (stream: NodeJS.ReadableStream | null): void => {
        let buf = ''
        stream?.setEncoding('utf8')
        stream?.on('data', (chunk: string) => {
          buf += chunk
          const lines = buf.split(/\r?\n/)
          buf = lines.pop() ?? ''
          for (const l of lines) {
            if (!l.length) continue
            push(r, classify(l), l)
            trackPlayers(r, l)
            if (/\]: Done \(/.test(l)) setStatus(r, 'running')
            if (/FAILED TO BIND TO PORT|Address already in use/i.test(l)) push(r, 'error', `A porta ${server.props.port} já está em uso — mude a porta nas configurações do servidor.`)
          }
        })
      }
      pipe(child.stdout)
      pipe(child.stderr)
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })

      void fs
        .readFile(path.join(serverDir(id), 'server.json'), 'utf8')
        .then((t) => fs.writeFile(path.join(serverDir(id), 'server.json'), t.replace(/"lastStarted":\s*\d+/, `"lastStarted": ${Date.now()}`)))
        .then(() => serverEvents.emit('changed'))
        .catch(() => undefined)

      child.once('exit', (code) => {
        const crashed = !r.stopping && code !== 0
        push(r, crashed ? 'error' : 'launcher', r.stopping ? 'Servidor parado.' : `O servidor fechou (código ${code}).`)
        setStatus(r, 'stopped', { exitCode: code })
        setTimeout(() => {
          if (running.get(id)?.state.status === 'stopped') running.delete(id)
          serverRunEvents.emit('state', { serverId: id, status: 'stopped', startedAt: 0, players: [] })
        }, 1500)
      })
    }, undefined)
  } catch (e) {
    push(r, 'error', `Erro: ${(e as Error).message}`)
    setStatus(r, 'stopped', { exitCode: null })
    running.delete(id)
    throw e
  }
}

export function sendCommand(id: string, command: string): void {
  const r = running.get(id)
  if (!r?.child || r.state.status !== 'running') throw new Error('O servidor não está em execução')
  push(r, 'launcher', `> ${command}`)
  r.child.stdin?.write(command.replace(/\n/g, '') + '\n')
}

export function stopServer(id: string): void {
  const r = running.get(id)
  if (!r?.child) return
  r.stopping = true
  setStatus(r, 'stopping')
  push(r, 'launcher', 'Parando o servidor…')
  try {
    r.child.stdin?.write('stop\n')
  } catch {
    r.child.kill()
  }
  setTimeout(() => {
    if (r.child && r.child.exitCode === null) r.child.kill()
  }, 12000)
}

export function killAllServers(): void {
  for (const r of running.values()) r.child?.kill()
}
