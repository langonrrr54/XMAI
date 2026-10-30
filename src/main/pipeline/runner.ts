/**
 * 连续写作调度器：批量生成章节、暂停/继续、进度广播、按剧情完结判断收尾。
 * 单本串行执行（保证记忆按章推进），跨本排队。
 */
import { EventEmitter } from 'node:events'
import type { Chapter, ConsistencyIssue, EndingJudgement, PipelineEvent, PipelineStatus } from '@shared/types'
import { cleanNovelText, writeChapter, rewriteChapter } from './chapterWriter'
import { chapterRepo, bookRepo } from '../db/repo'
import { persistNow } from '../db/database'
import { ensureChapterTitle, volumeOfChapter } from './bookForge'
import { judgeEnding } from './ending'

export interface RunOptions {
  autoReview?: boolean
  consistencyCheck?: boolean
  /** 达到目标章数后，按剧情完成度判断是否收尾 */
  untilComplete?: boolean
}

export class WritingRunner extends EventEmitter {
  private ctrl: AbortController | null = null
  private paused = false
  private stopping = false
  private running = false
  private writeOneBookId: string | null = null
  private writeOneRequestedNo?: number
  private writeOneOpts: RunOptions = {}
  private status: PipelineStatus = {
    running: false,
    bookId: null,
    mode: null,
    current: 0,
    done: 0,
    total: 0,
    phase: '',
    message: '',
    error: '',
    startedAt: 0
  }

  getStatus(): PipelineStatus {
    return { ...this.status }
  }

  pause(): void {
    this.paused = true
    this.stopping = false
    this.ctrl?.abort()
    this.status.phase = 'paused'
    this.status.message = '已暂停'
    this.emitEvent('paused', '已暂停')
  }

  resume(): void {
    this.paused = false
  }

  stop(): void {
    this.paused = false
    this.stopping = true
    this.ctrl?.abort()
    this.status.phase = 'idle'
    this.status.message = '正在停止…'
    this.emitEvent('paused', '已停止')
  }

  isRunning(): boolean {
    return this.running
  }

  emitEvent(type: PipelineEvent['type'], message: string, extra: Record<string, unknown> = {}): void {
    const event: PipelineEvent = {
      type,
      bookId: this.status.bookId || undefined,
      chapterNo: this.status.current || undefined,
      phase: this.status.phase,
      message,
      progress: { current: this.status.current, total: this.status.total },
      at: Date.now(),
      ...extra
    }
    this.emit('event', event)
  }

  /** 流式过程中每 6 秒保存一次草稿，防止关闭软件丢失已生成内容 */
  private savePartial(bookId: string, chapterNo: number, full: string): void {
    if (full.length < 200) return
    try {
      const existing = chapterRepo.getByNo(bookId, chapterNo)
      if (existing && existing.content && existing.status !== 'planned') return
      const cleaned = cleanNovelText(full, chapterNo)
      if (cleaned.length < 200) return
      const { volumeNo } = volumeOfChapter(bookId, chapterNo)
      chapterRepo.upsert({
        bookId,
        chapterNo,
        volumeNo,
        title: ensureChapterTitle(bookId, chapterNo),
        content: cleaned,
        status: 'planned'
      })
    } catch (err) {
      console.warn('[runner] 草稿保存失败', err)
    }
  }

  /**
   * 单章写作（点「写一章 / 写完整篇」）
   * 通过统一调度器执行：与批量写作共用进度条、日志、暂停/停止，切换到其它页面不会中断。
   */
  async writeOne(bookId: string, chapterNo?: number, opts: RunOptions = {}): Promise<{ chapter: Chapter; issues: ConsistencyIssue[] }> {
    this.writeOneBookId = bookId
    this.writeOneRequestedNo = chapterNo
    this.writeOneOpts = opts
    try {
      const book = bookRepo.get(bookId)
      if (!book) throw new Error('书籍不存在')
      const isShort = book.workType === 'short'
      // 续写下一章：末章已完结章号 + 1（括号不能省，否则 + 会先于 || 结合）
      const from = isShort ? 1 : chapterNo || (chapterRepo.lastCompleted(bookId)?.chapterNo || 0) + 1
      const total = isShort ? 1 : 1
      await this.run(bookId, from, total, { ...opts, untilComplete: false })
      const written = chapterRepo.getByNo(bookId, isShort ? 1 : from)
      if (!written) throw new Error('写作完成后未找到章节')
      const issues: ConsistencyIssue[] = []
      return { chapter: written, issues }
    } finally {
      this.writeOneBookId = null
    }
  }

  /**
   * 重写单章 / 重写短故事全文。
   * 走与连续写作同一套锁、进度与事件通道：切到其它页面时进度条与日志仍在，
   * 且重写期间不会被另一个写作任务并发覆盖同一本书。
   */
  async rewrite(bookId: string, chapterNo: number): Promise<Chapter> {
    if (this.running) throw new Error('已有写作任务在运行，请先等待或停止')
    const book = bookRepo.get(bookId)
    if (!book) throw new Error('书籍不存在')
    const isShort = book.workType === 'short'
    const no = isShort ? 1 : Number(chapterNo) || 1

    this.running = true
    this.paused = false
    this.stopping = false
    this.status = {
      running: true,
      bookId,
      mode: 'chapters',
      current: no,
      done: 0,
      total: 1,
      phase: 'starting',
      message: `准备重写第 ${no} 章`,
      error: '',
      startedAt: Date.now()
    }
    this.emitEvent('start', this.status.message)

    const ctrl = new AbortController()
    this.ctrl = ctrl
    let lastFlush = 0
    try {
      const chapter = await rewriteChapter(bookId, no, {
        autoReview: true,
        consistencyCheck: true,
        signal: ctrl.signal,
        onPhase: (phase, message) => {
          this.status.phase = phase
          this.status.message = message
          this.emitEvent('log', message)
        },
        onDelta: (_d, full) => {
          const now = Date.now()
          if (now - lastFlush < 350) return
          lastFlush = now
          this.emit('event', {
            type: 'log',
            bookId,
            chapterNo: no,
            phase: 'streaming',
            message: full.slice(-400),
            progress: { current: no, total: 1 },
            at: Date.now()
          } satisfies PipelineEvent)
        }
      })
      this.status.done = 1
      this.status.phase = 'done'
      this.status.message = `第 ${no} 章已重写（${chapter.wordCount} 字）`
      this.emitEvent('done', this.status.message, { chapterId: chapter.id, wordCount: chapter.wordCount })
      return chapter
    } catch (err) {
      const msg = (err as Error)?.message || ''
      const interrupted = this.stopping || (err as Error).name === 'AbortError' || msg.includes('已取消')
      if (interrupted) {
        this.status.phase = 'idle'
        this.status.message = '已停止重写，原稿保留'
        this.emitEvent('paused', this.status.message)
        throw new Error('已停止重写，原稿保留')
      }
      this.status.phase = 'error'
      this.status.error = msg || '重写失败'
      this.status.message = `重写中断：${this.status.error}`
      this.emitEvent('error', this.status.message, { error: this.status.error })
      throw err
    } finally {
      this.running = false
      this.ctrl = null
      persistNow()
      this.stopping = false
      setTimeout(() => {
        if (!this.running) this.status.running = false
      }, 100)
    }
  }

  /**
   * 连续写作
   * @param startChapter 起始章号，0 表示接着最后一章
   */
  async run(bookId: string, startChapter: number, count: number, opts: RunOptions = {}): Promise<void> {
    if (this.running) throw new Error('已有写作任务在运行，请先等待或停止')
    this.running = true
    this.paused = false
    this.stopping = false

    const book = bookRepo.get(bookId)
    const isShort = book?.workType === 'short'
    const target = isShort ? 1 : book?.targetChapters || 0
    const plannedTotal = isShort ? 1 : Math.max(1, count)
    const lastNo = chapterRepo.lastCompleted(bookId)?.chapterNo || 0
    const from = isShort ? 1 : startChapter > 0 ? startChapter : lastNo + 1
    const untilComplete = !isShort && opts.untilComplete === true
    const hardCap = Math.max(from + plannedTotal - 1, target + Math.max(10, Math.ceil(target * 0.1)))
    const progressTotal = untilComplete ? Math.max(1, target - from + 1) : plannedTotal

    this.status = {
      running: true,
      bookId,
      mode: 'chapters',
      current: from - 1,
      done: 0,
      total: progressTotal,
      phase: 'starting',
      message: isShort
        ? '开始生成短故事全文'
        : untilComplete
          ? `从第 ${from} 章开始，写到剧情完结（目标 ${target} 章）`
          : `从第 ${from} 章开始，共 ${plannedTotal} 章`,
      error: '',
      startedAt: Date.now()
    }
    this.emitEvent('start', this.status.message)

    let done = 0
    let i = 0
    let finaleMode = false
    try {
      while (true) {
        if (this.paused) {
          this.status.phase = 'paused'
          this.emitEvent('paused', `已暂停：完成 ${done} 章`)
          break
        }
        const chapterNo = from + i
        if (!isShort && chapterNo > hardCap) {
          this.status.phase = 'paused'
          this.status.message = `已达安全上限（第 ${hardCap} 章），剧情仍未完全收束`
          this.emitEvent('paused', this.status.message)
          break
        }
        if (!untilComplete && i >= plannedTotal) break

        this.status.current = chapterNo
        this.status.phase = 'writing'
        this.status.message = `第 ${chapterNo} 章`
        this.emitEvent('progress', `开始第 ${chapterNo} 章${finaleMode ? '（结局章）' : ''}`)

        const ctrl = new AbortController()
        this.ctrl = ctrl
        let lastFlush = 0
        let lastPartial = 0
        try {
          const { chapter, issues } = await writeChapter({
            bookId,
            chapterNo,
            signal: ctrl.signal,
            autoReview: opts.autoReview,
            consistencyCheck: opts.consistencyCheck,
            finale: finaleMode,
            onDelta: (_d, full) => {
              const now = Date.now()
              if (now - lastFlush > 350) {
                lastFlush = now
                this.emit('event', {
                  type: 'log',
                  bookId,
                  chapterNo,
                  phase: 'streaming',
                  message: full.slice(-400),
                  progress: { current: chapterNo, total: this.status.total },
                  at: Date.now()
                } satisfies PipelineEvent)
              }
              if (now - lastPartial > 6000) {
                lastPartial = now
                this.savePartial(bookId, chapterNo, full)
              }
            },
            onPhase: (phase, message) => {
              this.status.phase = phase
              this.status.message = message
              this.emitEvent('log', message)
            }
          })
          done++
          this.status.done = done
          this.status.message = `第 ${chapterNo} 章完成（${chapter.wordCount} 字）`
          this.emitEvent('chapter_done', this.status.message, {
            chapterId: chapter.id,
            wordCount: chapter.wordCount,
            issues
          })
          persistNow()
        } catch (err) {
          const msg = (err as Error)?.message || ''
          const userInterrupted =
            this.paused || this.stopping || (err as Error).name === 'AbortError' || msg.includes('已取消')
          if (userInterrupted) {
            this.status.phase = this.stopping ? 'idle' : 'paused'
            this.emitEvent(
              'paused',
              this.stopping
                ? `已停止：完成 ${done} 章，中断章节已存为草稿`
                : `已暂停于第 ${chapterNo} 章，已生成部分已存为草稿`
            )
            break
          }
          throw err
        } finally {
          this.ctrl = null
        }

        if (isShort) {
          // 与 chapterWriter 一致：字数达标才算完成，否则提示残篇
          const words = chapterRepo.getByNo(bookId, 1)?.wordCount || 0
          const targetWords = book?.wordsPerChapter || 0
          const doneEnough = targetWords > 0 ? words >= targetWords * 0.85 : true
          bookRepo.update(bookId, { status: doneEnough ? 'completed' : 'writing' })
          this.status.phase = 'done'
          this.status.message = doneEnough
            ? `短故事已完成（${words} 字）`
            : `短故事字数不足（${words}/${targetWords} 字），已保留为草稿，可重写`
          this.emitEvent(doneEnough ? 'done' : 'paused', this.status.message)
          break
        }

        // 达到目标章数后，按剧情完成度判断是否收尾
        if (untilComplete && chapterNo >= target) {
          const sinceTarget = chapterNo - target
          if (sinceTarget === 0 || sinceTarget % 3 === 0) {
            this.status.phase = 'judging'
            this.emitEvent('log', '正在判断全书是否可以收尾…')
            let judgement: EndingJudgement | null = null
            try {
              judgement = await judgeEnding(bookId)
            } catch (err) {
              this.emitEvent('log', `完结判断失败，继续写作：${(err as Error).message}`)
            }
            if (judgement) {
              if (judgement.complete) {
                bookRepo.update(bookId, { status: 'completed' })
                this.status.phase = 'done'
                this.status.message = `剧情已收束，全书完结（第 ${chapterNo} 章）：${judgement.reason || '主线与伏笔已完成'}`
                this.emitEvent('done', this.status.message, { ending: judgement })
                break
              }
              finaleMode = judgement.suggestChapters > 0 && judgement.suggestChapters <= 2
              this.emitEvent(
                'log',
                `尚未完结：${judgement.reason || '主线尚未收束'}${
                  judgement.missing.length ? `；还缺：${judgement.missing.join('、')}` : ''
                }`
              )
            }
          }
        }

        i++
      }

      if (!['done', 'paused', 'idle'].includes(this.status.phase)) {
        this.status.phase = 'done'
        this.status.message = `本次完成 ${done} 章`
        this.emitEvent('done', this.status.message)
      }
    } catch (err) {
      const e = err as Error & { detail?: string }
      const detail =
        typeof e.detail === 'string' && e.detail.trim()
          ? `：${e.detail.replace(/\s+/g, ' ').slice(0, 400)}`
          : ''
      this.status.phase = 'error'
      this.status.error = `${e.message || '未知错误'}${detail}`
      this.status.message = `写作中断：${this.status.error}`
      this.emitEvent('error', this.status.message, { error: this.status.error })
      throw err
    } finally {
      this.running = false
      this.ctrl = null
      persistNow()
      setTimeout(() => {
        if (!this.running) this.status.running = false
      }, 100)
      this.stopping = false
    }
  }
}

export const writingRunner = new WritingRunner()
