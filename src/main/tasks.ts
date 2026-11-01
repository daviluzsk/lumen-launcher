import { EventEmitter } from 'events'
import type { TaskInfo } from '@shared/types'

export const taskEvents = new EventEmitter()
const tasks = new Map<string, TaskInfo>()
let seq = 0

export class Task {
  readonly info: TaskInfo
  private lastEmit = 0

  constructor(title: string, instanceId?: string) {
    this.info = { id: `t${++seq}`, title, detail: '', progress: null, state: 'running', instanceId, startedAt: Date.now() }
    tasks.set(this.info.id, this.info)
    this.emit(true)
  }

  update(detail: string, progress: number | null = this.info.progress): void {
    this.info.detail = detail
    this.info.progress = progress
    this.emit()
  }

  done(detail = 'Concluído'): void {
    this.info.state = 'done'
    this.info.detail = detail
    this.info.progress = 1
    this.emit(true)
    setTimeout(() => tasks.delete(this.info.id), 4000)
  }

  fail(err: unknown): void {
    this.info.state = 'error'
    this.info.error = err instanceof Error ? err.message : String(err)
    this.emit(true)
    setTimeout(() => tasks.delete(this.info.id), 8000)
  }

  /** Throttled so thousands of asset downloads do not flood IPC. */
  private emit(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < 80) return
    this.lastEmit = now
    taskEvents.emit('update', { ...this.info })
  }
}

export async function runTask<T>(title: string, fn: (t: Task) => Promise<T>, instanceId?: string): Promise<T> {
  const t = new Task(title, instanceId)
  try {
    const r = await fn(t)
    t.done()
    return r
  } catch (e) {
    t.fail(e)
    throw e
  }
}

export const listTasks = (): TaskInfo[] => [...tasks.values()]
