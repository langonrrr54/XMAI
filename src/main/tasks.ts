/**
 * 后台任务中心。
 *
 * 解决的问题：以前「去AI味 / 审校 / 修稿 / 写记忆」的忙碌状态只存在页面组件的 useState 里，
 * 一离开页面组件卸载，状态就没了，用户看不到进度也不知道有没有做完。
 *
 * 这里把任务状态放在主进程，任何页面都能订阅；任务结果也保留在内存里，
 * 切回页面时可以直接拿回上次的产物（例如去AI味的改写稿）。
 */
import { EventEmitter } from 'node:events'
import type { AppTask, TaskKind } from '@shared/types'
import { newId } from './db/database'

const KEEP_DONE_MS = 30 * 60 * 1000
const MAX_TASKS = 60

class TaskCenter extends EventEmitter {
  private tasks = new Map<string, AppTask>()

  list(): AppTask[] {
    const now = Date.now()
    const out: AppTask[] = []
    for (const t of this.tasks.values()) {
      // 已完成任务保留一段时间，供用户回看结果
      if (t.status === 'done' || t.status === 'error') {
        if (now - (t.finishedAt || t.updatedAt) > KEEP_DONE_MS) {
          this.tasks.delete(t.id)
          continue
        }
      }
      out.push(t)
    }
    return out.sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_TASKS)
  }

  get(id: string): AppTask | null {
    return this.tasks.get(id) || null
  }

  /** 某个章节上是否已有同类任务在跑（用于避免重复点击） */
  findRunning(kind: TaskKind, refId: string): AppTask | null {
    for (const t of this.tasks.values()) {
      if (t.kind === kind && t.refId === refId && t.status === 'running') return t
    }
    return null
  }

  start(input: { kind: TaskKind; title: string; bookId?: string; refId?: string; total?: number }): AppTask {
    const now = Date.now()
    const task: AppTask = {
      id: newId('tk_'),
      kind: input.kind,
      title: input.title,
      bookId: input.bookId,
      refId: input.refId,
      status: 'running',
      progress: 0,
      phase: 'starting',
      message: '准备中…',
      detail: '',
      startedAt: now,
      updatedAt: now
    }
    this.tasks.set(task.id, task)
    this.prune()
    this.push(task)
    return task
  }

  update(
    id: string,
    patch: Partial<Pick<AppTask, 'progress' | 'phase' | 'message' | 'detail' | 'total'>>
  ): void {
    const t = this.tasks.get(id)
    if (!t) return
    Object.assign(t, patch)
    t.updatedAt = Date.now()
    this.push(t)
  }

  /** 记录进度：done/total，自动换算百分比 */
  tick(id: string, done: number, total: number, message?: string): void {
    const pct = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0
    this.update(id, { progress: pct, message, detail: total > 0 ? `${done}/${total}` : '' })
  }

  done(id: string, result?: unknown, message = '已完成'): void {
    const t = this.tasks.get(id)
    if (!t) return
    t.status = 'done'
    t.progress = 100
    t.phase = 'done'
    t.message = message
    t.result = result
    t.finishedAt = Date.now()
    t.updatedAt = t.finishedAt
    this.push(t)
  }

  fail(id: string, error: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    t.status = 'error'
    t.phase = 'error'
    t.error = error
    t.message = `失败：${error}`
    t.finishedAt = Date.now()
    t.updatedAt = t.finishedAt
    this.push(t)
  }

  cancel(id: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    t.status = 'cancelled'
    t.phase = 'cancelled'
    t.message = '已取消'
    t.finishedAt = Date.now()
    t.updatedAt = t.finishedAt
    this.push(t)
  }

  /** 清掉某章节的已结束任务（重新开始时用） */
  clearFinished(kind: TaskKind, refId: string): void {
    for (const [id, t] of this.tasks) {
      if (t.kind === kind && t.refId === refId && t.status !== 'running') this.tasks.delete(id)
    }
  }

  private prune(): void {
    const list = this.list()
    if (list.length <= MAX_TASKS) return
    for (const t of list.slice(MAX_TASKS)) this.tasks.delete(t.id)
  }

  private push(t: AppTask): void {
    this.emit('task', { ...t })
  }
}

export const taskCenter = new TaskCenter()

/** 包一层：自动 start / done / fail，并返回结果 */
export async function runTask<T>(
  input: { kind: TaskKind; title: string; bookId?: string; refId?: string; total?: number },
  fn: (task: AppTask) => Promise<{ result: T; message?: string }>
): Promise<T> {
  const task = taskCenter.start(input)
  try {
    const { result, message } = await fn(task)
    taskCenter.done(task.id, result, message)
    return result
  } catch (err) {
    taskCenter.fail(task.id, (err as Error)?.message || String(err))
    throw err
  }
}