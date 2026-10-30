/**
 * IPC 注册中心：渲染进程通过 window.api 调用。
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  BibleKind,
  Book,
  BookCreateInput,
  Chapter,
  ConceptOption,
  ConceptRequest,
  ConsistencyIssue,
  MemoryOverview,
  PipelineEvent
} from '@shared/types'
import {
  bibleRepo,
  bookRepo,
  captureRepo,
  chapterRepo,
  deaiRepo,
  countWords,
  embeddingRepo,
  foreshadowRepo,
  outlineRepo,
  publishRepo,
  volumeSummaryRepo
} from '../db/repo'
import { getDataDir, getDbFilePath, persistNow } from '../db/database'
import { loadSettings, saveSettings } from '../settings'
import { chat, embedDetailed, listModels, normalizeBaseUrl } from '../llm/client'
import {
  generateBible,
  generateChapterOutlines,
  generateConcepts,
  generateShortStructure,
  generateVolumeOutline
} from '../pipeline/bookForge'
import { writeChapter, rewriteChapter } from '../pipeline/chapterWriter'
import { writingRunner } from '../pipeline/runner'
import { runTask, taskCenter } from '../tasks'
import { updater } from '../updater'
import { buildChapterContext } from '../memory/context'
import { ensureAllIndexesFresh, rebuildBookIndex, retrieve } from '../memory/retriever'
import {
  checkConsistency,
  deAiRewrite,
  extractStyle,
  fixChapter,
  issuesToFix,
  persistDigest,
  summarizeChapter
} from '../memory/memoryService'
import { exportBook } from '../exporter'
import { generateCover, importCover, readCoverAsDataUrl } from '../cover/generator'
import { activateProvider, createProvider, listProviders, removeProvider, updateProvider } from '../providers'
import { fanqie } from '../publish/fanqie'
import {
  FANQIE_TAG_SNAPSHOT,
  SHORT_TAG_TOTAL,
  TAG_LIMITS,
  normalizeTagPick,
  suggestFanqieTags,
  tagVocabulary
} from '../publish/tags'
import type { RawCapture } from '../publish/fanqie'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function handle(channel: string, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await (fn as (...a: unknown[]) => unknown)(...args)
    } catch (err) {
      console.error(`[ipc] ${channel} 失败：`, err)
      throw new Error((err as Error)?.message || String(err))
    }
  })
}

let ipcBound = false

export function registerIpc(): void {
  if (ipcBound) return
  ipcBound = true

  /* ---------------- app ---------------- */
  handle('app:info', () => {
    const archLabel =
      process.arch === 'x64'
        ? '64 位 (x64)'
        : process.arch === 'arm64'
          ? 'ARM64'
          : process.arch === 'ia32'
            ? '32 位 (x86)'
            : process.arch
    const osLabel =
      process.platform === 'win32'
        ? (os.version?.().match(/Windows\s+\d+/i)?.[0] || 'Windows')
        : process.platform === 'darwin'
          ? 'macOS'
          : 'Linux'
    return {
      version: app.getVersion(),
      dataDir: getDataDir(),
      dbPath: getDbFilePath(),
      platform: process.platform,
      arch: process.arch,
      platformLabel: `${osLabel} · ${archLabel}`,
      electron: process.versions.electron || ''
    }
  })
  handle('app:openDataDir', async () => {
    await shell.openPath(getDataDir())
  })
  handle('app:openPath', async (p) => {
    const target = String(p)
    if (fs.existsSync(target)) await shell.openPath(target)
  })

  /* ---------------- settings ---------------- */
  handle('settings:get', () => loadSettings())
  handle('settings:save', (patch) => saveSettings(patch as never))
  handle('settings:models', async (override) => {
    const base = loadSettings().model
    const model = override ? { ...base, ...(override as object) } : base
    return runTask(
      { kind: 'models', title: '拉取模型列表' },
      async (task) => {
        taskCenter.update(task.id, { phase: 'request', message: '正在请求供应商…' })
        const list = await listModels(model)
        return { result: list, message: `拿到 ${list.length} 个模型` }
      }
    )
  })
  handle('settings:test', async (override) => {
    const base = loadSettings().model
    const model = { ...base, ...((override as object) || {}) }
    const started = Date.now()
    if (!normalizeBaseUrl(model.baseUrl)) return { ok: false, message: '请填写 API 地址：选择供应商预设，或填写自定义服务地址' }
    if (!model.apiKey) return { ok: false, message: '请填写 API Key' }
    taskCenter.clearFinished('test', 'settings')
    const task = taskCenter.start({ kind: 'test', title: '测试模型连接', refId: 'settings' })
    try {
      taskCenter.update(task.id, { phase: 'models', message: '正在拉取模型列表…' })
      const models = await listModels(model)
      taskCenter.update(task.id, { phase: 'chat', message: '正在发送测试请求…' })
      const res = await chat(model, [{ role: 'user', content: '请只回复两个字：可用' }], {
        model: model.models.default,
        maxTokens: 32,
        temperature: 0,
        retries: 1,
        timeoutMs: 40000
      })
      const payload = {
        ok: true,
        message: `连接成功，模型回复：${res.content.slice(0, 20)}`,
        models,
        latencyMs: Date.now() - started
      }
      taskCenter.done(task.id, payload, `连接成功（${payload.latencyMs}ms）`)
      return payload
    } catch (err) {
      const msg = `连接失败：${(err as Error).message}`
      taskCenter.fail(task.id, (err as Error).message)
      return { ok: false, message: msg }
    }
  })

  /** 测试向量模型：明确告诉用户是走远程还是回退本地 */
  handle('settings:testEmbedding', async (override) => {
    const base = loadSettings().model
    const model = { ...base, ...((override as object) || {}) }
    if (!model.models?.embedding) {
      return { ok: false, mode: 'local', message: '未填写向量模型名，当前使用本地哈希向量（中文召回较弱）' }
    }
    const started = Date.now()
    const r = await embedDetailed(model, ['测试文本：陈砚在雨夜捡到一把银钥匙'])
    if (!r.vecs || !r.vecs[0]) {
      return {
        ok: false,
        mode: 'local',
        message: `向量服务不可用：${r.error}。已自动回退到本地哈希向量`,
        latencyMs: Date.now() - started
      }
    }
    const dim = r.vecs[0].length
    return {
      ok: true,
      mode: 'remote',
      dim,
      message: `向量模型可用（维度 ${dim}），检索会走语义向量`,
      latencyMs: Date.now() - started
    }
  })

  /* ---------------- 供应商配置 ---------------- */
  /** 配置变更后延迟检查索引（避免每次切换都立刻重建） */
  let indexCheckTimer: NodeJS.Timeout | null = null
  const scheduleIndexCheck = (): void => {
    if (indexCheckTimer) clearTimeout(indexCheckTimer)
    indexCheckTimer = setTimeout(() => {
      indexCheckTimer = null
      void (async () => {
        try {
          const rebuilt = await ensureAllIndexesFresh()
          if (rebuilt.length) {
            broadcast('memory:autoRebuilt', rebuilt)
            console.log('[memory] 配置变更后自动重建索引:', rebuilt.length)
          }
        } catch (err) {
          console.warn('[memory] 配置变更索引检查失败', err)
        }
      })()
    }, 1500)
  }
  handle('providers:list', () => listProviders())
  handle('providers:create', (input, activate) => {
    const settings = createProvider(input as never, activate !== false)
    scheduleIndexCheck()
    return { providers: listProviders(), settings }
  })
  handle('providers:update', (id, patch) => {
    const settings = updateProvider(String(id), patch as never)
    scheduleIndexCheck()
    return { providers: listProviders(), settings }
  })
  handle('providers:remove', (id) => {
    const settings = removeProvider(String(id))
    return { providers: listProviders(), settings }
  })
  handle('providers:activate', (id) => {
    const settings = activateProvider(String(id))
    scheduleIndexCheck()
    return { providers: listProviders(), settings }
  })

  /* ---------------- books ---------------- */
  handle('books:list', () => bookRepo.list())
  handle('books:get', (id) => bookRepo.get(String(id)))
  handle('books:concept', async (req) => {
    const request = req as ConceptRequest
    return runTask(
      { kind: 'concept', title: '生成选题方案' },
      async (task) => {
        taskCenter.update(task.id, { phase: 'planning', message: '正在构思选题与书名…' })
        const options = await generateConcepts(request)
        return { result: options, message: `生成 ${options.length} 个方案` }
      }
    )
  })

/**
 * 规范化 concept：所有字段给默认值。
 * 模型/外部输入可能缺 sellingPoints 等字段，直接入库会让界面 .join() 抛错导致白屏。
 */
function normalizeConceptInput(raw: unknown): ConceptOption {
  const c = (raw || {}) as Partial<ConceptOption>
  return {
    title: String(c.title || '未命名作品'),
    synopsis: String(c.synopsis || ''),
    tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
    genre: String(c.genre || ''),
    hook: String(c.hook || ''),
    protagonist: String(c.protagonist || ''),
    goldenFinger: String(c.goldenFinger || ''),
    sellingPoints: Array.isArray(c.sellingPoints) ? c.sellingPoints.map(String) : [],
    openingScene: String(c.openingScene || ''),
    structure: c.structure ? String(c.structure) : undefined
  }
}

  handle('books:create', async (input) => {
    const data = input as BookCreateInput
    const workType = data.workType === 'short' ? 'short' : 'novel'
    const concept = normalizeConceptInput(data.concept)
    const book = bookRepo.create({
      title: concept.title,
      synopsis: concept.synopsis,
      tags: concept.tags,
      genre: concept.genre,
      concept,
      workType,
      targetChapters: workType === 'short' ? 1 : data.targetChapters,
      wordsPerChapter: data.wordsPerChapter,
      styleProfile: data.styleProfile || null,
      status: 'planning'
    })
    broadcast('pipeline:event', {
      type: 'log',
      bookId: book.id,
      message: workType === 'short' ? `已创建短故事《${book.title}》，开始建人物与设定` : `已创建《${book.title}》，开始搭建设定库`,
      progress: { current: 1, total: 4 }
    } satisfies PipelineEvent)
    let warning = ''
    try {
      const count = await generateBible(book.id)
      broadcast('pipeline:event', {
        type: 'log',
        bookId: book.id,
        message: workType === 'short' ? `人物与设定完成：${count} 条` : `设定库完成：${count} 条`,
        progress: { current: 2, total: 4 }
      } satisfies PipelineEvent)

      if (workType === 'short') {
        await generateShortStructure(book.id)
        broadcast('pipeline:event', {
          type: 'log',
          bookId: book.id,
          message: '故事结构完成（7 拍）',
          progress: { current: 3, total: 4 }
        } satisfies PipelineEvent)
      } else {
        await generateVolumeOutline(book.id)
        broadcast('pipeline:event', {
          type: 'log',
          bookId: book.id,
          message: '分卷大纲完成',
          progress: { current: 3, total: 4 }
        } satisfies PipelineEvent)
        await generateChapterOutlines(book.id, 1, 5).catch(() => undefined)
      }
      bookRepo.update(book.id, { status: 'writing' })
    } catch (err) {
      warning = `${
        workType === 'short' ? '结构/设定' : '大纲/设定'
      }生成中断：${(err as Error).message}。可在作品页重试。`
    }
    try {
      await generateCover(book.id, false)
    } catch (err) {
      console.warn('[ipc] 自动封面失败', err)
    }
    const final = bookRepo.get(book.id)!
    broadcast('pipeline:event', {
      type: 'done',
      bookId: book.id,
      message: '初始化完成',
      progress: { current: 4, total: 4 }
    } satisfies PipelineEvent)
    return { book: final, warning }
  })

  handle('books:createBlank', async (input) => {
    const data = input as {
      title: string
      workType?: 'novel' | 'short'
      genre?: string
      synopsis?: string
      tags?: string[]
      targetChapters?: number
      wordsPerChapter?: number
    }
    const workType = data.workType === 'short' ? 'short' : 'novel'
    const book = bookRepo.create({
      title: data.title,
      genre: data.genre || (workType === 'short' ? '情感' : '都市'),
      synopsis: data.synopsis || '',
      tags: data.tags || [],
      workType,
      targetChapters: workType === 'short' ? 1 : data.targetChapters || 500,
      wordsPerChapter: data.wordsPerChapter || (workType === 'short' ? 5000 : 2200),
      status: 'writing'
    })
    try {
      await generateCover(book.id, false)
    } catch {
      /* 忽略 */
    }
    return bookRepo.get(book.id)
  })

  handle('books:update', (id, patch) => {
    bookRepo.update(String(id), patch as Partial<Book>)
    return bookRepo.get(String(id))
  })
  handle('books:remove', (id) => bookRepo.remove(String(id)))
  handle('books:generateBible', (id) => {
    const bookId = String(id)
    return runTask(
      { kind: 'bible', title: '生成设定库', bookId, refId: bookId },
      async (task) => {
        taskCenter.update(task.id, { phase: 'bible', message: '正在搭建世界观与人物…' })
        const count = await generateBible(bookId)
        return { result: count, message: `完成 ${count} 条设定` }
      }
    )
  })
  handle('books:generateVolumes', (id) => {
    const bookId = String(id)
    return runTask(
      { kind: 'volumes', title: '生成分卷大纲', bookId, refId: bookId },
      async (task) => {
        taskCenter.update(task.id, { phase: 'outline', message: '正在拆分卷与核心矛盾…' })
        const nodes = await generateVolumeOutline(bookId)
        return { result: nodes, message: `完成 ${Array.isArray(nodes) ? nodes.length : 0} 卷` }
      }
    )
  })
  handle('books:generateStructure', (id) => {
    const bookId = String(id)
    return runTask(
      { kind: 'structure', title: '生成短故事结构', bookId, refId: bookId },
      async (task) => {
        taskCenter.update(task.id, { phase: 'structure', message: '正在编排 7 拍…' })
        const node = await generateShortStructure(bookId)
        return { result: node, message: '7 拍结构完成' }
      }
    )
  })

  /* ---------------- chapters ---------------- */
  handle('chapters:list', (bookId, withContent) => chapterRepo.list(String(bookId), withContent === true))
  handle('chapters:get', (id) => chapterRepo.get(String(id)))
  handle('chapters:save', (id, patch) => {
    const p = patch as Partial<Chapter>
    if (p.content !== undefined && p.status === undefined) p.status = 'drafted'
    chapterRepo.update(String(id), p)
    bookRepo.touch(p.bookId || chapterRepo.get(String(id))!.bookId)
    return chapterRepo.get(String(id))
  })
  handle('chapters:remove', (id) => {
    const chapterId = String(id)
    const chapter = chapterRepo.get(chapterId)
    if (chapter) {
      // 正文删了，摘要向量也要删，否则长程检索会命中已删除的章节
      embeddingRepo.deleteByRef(chapter.bookId, 'summary', chapterId)
      bookRepo.touch(chapter.bookId)
    }
    chapterRepo.remove(chapterId)
  })

  handle('chapters:write', async (bookId, chapterNo) => {
    const id = String(bookId)
    const no = chapterNo ? Number(chapterNo) : undefined
    return runTask(
      { kind: 'chapters', title: no ? `写第${no}章` : '写下一章', bookId: id, refId: id, total: 1 },
      async (task) => {
        taskCenter.update(task.id, { phase: 'writing', message: '正在生成正文…' })
        const res = await writingRunner.writeOne(id, no)
        return {
          result: res,
          message: `第${res.chapter.chapterNo}章完成（${res.chapter.wordCount}字）`
        }
      }
    )
  })

  handle('chapters:rewrite', async (bookId, chapterNo) => {
    const id = String(bookId)
    const no = Number(chapterNo)
    return runTask(
      { kind: 'rewrite', title: `重写第${no}章`, bookId: id, refId: id, total: 1 },
      async (task) => {
        taskCenter.update(task.id, { phase: 'writing', message: '正在重新生成正文…' })
        const chapter = await writingRunner.rewrite(id, no)
        // 重写后正文是新的，清掉去AI味标记，让它可以重新进入批量范围
        deaiRepo.unmark(chapter.id)
        return { result: { chapter, issues: [] }, message: `重写完成（${chapter.wordCount}字）` }
      }
    )
  })

  handle('chapters:generateOutlines', (bookId, from, count) => {
    const id = String(bookId)
    const start = Number(from)
    const total = Number(count)
    return runTask(
      { kind: 'outlines', title: `生成 ${total} 章细纲`, bookId: id, refId: id, total },
      async (task) => {
        taskCenter.update(task.id, { phase: 'outline', message: `正在写第 ${start} 章起的细纲…` })
        const nodes = await generateChapterOutlines(id, start, total)
        return { result: nodes, message: `完成 ${nodes.length} 章细纲` }
      }
    )
  })

  /**
   * 去 AI 味（单章）。
   * 只返回改写预览，不写库；任务状态在主进程，切页后仍能看到进度与结果。
   */
  handle('chapters:deAi', async (id, hint) => {
    const chapter = chapterRepo.get(String(id))
    if (!chapter) throw new Error('章节不存在')
    const book = bookRepo.get(chapter.bookId)
    if (!book) throw new Error('书籍不存在')
    const workType: 'novel' | 'short' = book.workType === 'short' ? 'short' : 'novel'
    const before = chapter.content
    if (!before.trim()) throw new Error('本章还没有正文')

    const running = taskCenter.findRunning('deai', chapter.id)
    if (running) throw new Error('这一章正在去AI味，请等它完成')
    taskCenter.clearFinished('deai', chapter.id)

    return runTask(
      {
        kind: 'deai',
        title: `去AI味 · 第${chapter.chapterNo}章`,
        bookId: book.id,
        refId: chapter.id,
        total: before.length
      },
      async (task) => {
        taskCenter.update(task.id, { phase: 'writing', message: '正在改写，保持情节不变…' })
        const result = await deAiRewrite(before, workType, hint ? String(hint) : undefined, (p) => {
          const pct = Math.min(99, Math.round((p.chars / p.expected) * 100))
          taskCenter.update(task.id, {
            progress: pct,
            detail: `${p.chars}/${p.expected} 字`,
            message: p.preview || '正在改写…'
          })
        })
        const payload = {
          text: result.text,
          changed: result.changed,
          beforeLength: before.length,
          afterLength: result.text.length,
          chapterId: chapter.id,
          chapterNo: chapter.chapterNo
        }
        return {
          result: payload,
          message: result.changed ? '改写完成，待你确认' : '模型返回内容异常，已保留原文供对比'
        }
      }
    )
  })

  /** 查询本书还有多少章没去AI味 */
  handle('chapters:deAiPending', (bookId) => {
    const id = String(bookId)
    // 用 withContent=true 才能判断「有正文」，否则 content 为空会被算成 0
    const all = chapterRepo
      .list(id, true)
      .filter((c) => c.content.trim() && c.status !== 'planned')
    const pending = all.filter((c) => (c.deaiDoneAt || 0) === 0)
    return {
      pending: pending.length,
      done: all.length - pending.length,
      total: all.length,
      chapters: pending.slice(0, 200).map((c) => ({ id: c.id, chapterNo: c.chapterNo, title: c.title }))
    }
  })

  /**
   * 采纳某章的去AI味结果：写库、备份原稿、打标记、重建记忆。
   */
  handle('chapters:deAiAdopt', async (chapterId, text) => {
    const id = String(chapterId)
    const chapter = chapterRepo.get(id)
    if (!chapter) throw new Error('章节不存在')
    const next = String(text || '')
    if (!next.trim()) throw new Error('改写内容为空')
    // 先备份原稿，再覆盖
    deaiRepo.backup({
      bookId: chapter.bookId,
      chapterId: id,
      chapterNo: chapter.chapterNo,
      content: chapter.content
    })
    chapterRepo.upsert({
      bookId: chapter.bookId,
      chapterNo: chapter.chapterNo,
      volumeNo: chapter.volumeNo,
      title: chapter.title,
      content: next,
      status: chapter.status === 'published' ? 'published' : 'drafted'
    })
    deaiRepo.mark(chapter.bookId, id)
    const book = bookRepo.get(chapter.bookId)
    if (book) {
      try {
        const digest = await summarizeChapter(chapter.chapterNo, chapter.title, next)
        await persistDigest(book, id, chapter.chapterNo, digest)
      } catch (err) {
        console.warn('[ipc] 去AI味后重建记忆失败', err)
      }
      bookRepo.touch(book.id)
    }
    return { chapter: chapterRepo.get(id), hasBackup: true }
  })

  /** 回滚：恢复去AI味之前的原稿，并清除标记 */
  handle('chapters:deAiRollback', async (chapterId) => {
    const id = String(chapterId)
    const chapter = chapterRepo.get(id)
    if (!chapter) throw new Error('章节不存在')
    const backup = deaiRepo.getBackup(id)
    if (!backup) throw new Error('这一章没有可回滚的原稿')
    chapterRepo.upsert({
      bookId: chapter.bookId,
      chapterNo: chapter.chapterNo,
      volumeNo: chapter.volumeNo,
      title: chapter.title,
      content: backup.content,
      status: chapter.status === 'published' ? 'published' : 'drafted'
    })
    deaiRepo.unmark(id)
    const book = bookRepo.get(chapter.bookId)
    if (book) {
      try {
        const digest = await summarizeChapter(chapter.chapterNo, chapter.title, backup.content)
        await persistDigest(book, id, chapter.chapterNo, digest)
      } catch (err) {
        console.warn('[ipc] 回滚后重建记忆失败', err)
      }
      bookRepo.touch(book.id)
    }
    return { chapter: chapterRepo.get(id), restoredAt: backup.createdAt }
  })

  /**
   * 批量去AI味。
   * 默认只处理「没做过」的章节，所以今天 20 章、明天新增 10 章，只会跑新的 10 章。
   * force=true 时才会连做过的章节一起重跑。
   */
  handle('chapters:deAiBatch', async (bookId, opts) => {
    const id = String(bookId)
    const book = bookRepo.get(id)
    if (!book) throw new Error('书籍不存在')
    const options = (opts as { force?: boolean; limit?: number }) || {}
    const force = options.force === true
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 999))

    let targets = force
      ? chapterRepo
          .list(id)
          .filter((c) => c.content.trim() && c.status !== 'planned')
          .map((c) => ({ id: c.id, chapterNo: c.chapterNo, title: c.title }))
      : deaiRepo.pendingChapters(id)
    targets = targets.slice(0, limit)
    if (!targets.length) {
      return { processed: 0, failed: 0, skipped: 0, message: '没有需要处理的章节（都已去过AI味）' }
    }

    return runTask(
      {
        kind: 'deai',
        title: force ? `批量去AI味（含重跑）${targets.length} 章` : `批量去AI味 ${targets.length} 章`,
        bookId: id,
        refId: id,
        total: targets.length
      },
      async (task) => {
        let processed = 0
        let failed = 0
        const errors: { chapterNo: number; error: string }[] = []

        for (let i = 0; i < targets.length; i++) {
          const target = targets[i]
          const chapter = chapterRepo.get(target.id)
          if (!chapter || !chapter.content.trim()) {
            failed++
            continue
          }
          taskCenter.update(task.id, {
            phase: 'batch',
            progress: Math.round((i / targets.length) * 100),
            detail: `${i + 1}/${targets.length}`,
            message: `正在处理第 ${target.chapterNo} 章（${target.title}）`
          })

          try {
            const result = await deAiRewrite(chapter.content, book.workType === 'short' ? 'short' : 'novel')
            if (!result.changed || !result.text.trim()) {
              throw new Error('改写结果异常，保留原文')
            }
            deaiRepo.backup({
              bookId: book.id,
              chapterId: chapter.id,
              chapterNo: chapter.chapterNo,
              content: chapter.content
            })
            chapterRepo.upsert({
              bookId: book.id,
              chapterNo: chapter.chapterNo,
              volumeNo: chapter.volumeNo,
              title: chapter.title,
              content: result.text,
              status: chapter.status === 'published' ? 'published' : 'drafted'
            })
            deaiRepo.mark(book.id, chapter.id)
            processed++
          } catch (err) {
            failed++
            errors.push({ chapterNo: target.chapterNo, error: (err as Error).message })
          }

          // 每章之间稍作停顿，避免把接口打爆
          await new Promise((r) => setTimeout(r, 600))
        }

        bookRepo.touch(book.id)
        return {
          result: { processed, failed, skipped: 0, errors },
          message: `完成 ${processed} 章${failed ? `，失败 ${failed} 章` : ''}`
        }
      }
    )
  })

  handle('chapters:summarize', async (id) => {
    const chapter = chapterRepo.get(String(id))
    if (!chapter) throw new Error('章节不存在')
    const book = bookRepo.get(chapter.bookId)
    if (!book) throw new Error('书籍不存在')
    return runTask(
      {
        kind: 'summary',
        title: `写入记忆 · 第${chapter.chapterNo}章`,
        bookId: book.id,
        refId: chapter.id
      },
      async (task) => {
        taskCenter.update(task.id, { phase: 'summary', message: '正在生成摘要与事实…' })
        const digest = await summarizeChapter(chapter.chapterNo, chapter.title, chapter.content)
        taskCenter.update(task.id, { phase: 'persist', message: '正在写入记忆库…' })
        await persistDigest(book, chapter.id, chapter.chapterNo, digest)
        return { result: chapterRepo.get(String(id)), message: '摘要与状态已写入记忆库' }
      }
    )
  })

  handle('chapters:check', async (id) => {
    const chapter = chapterRepo.get(String(id))
    if (!chapter) throw new Error('章节不存在')
    const book = bookRepo.get(chapter.bookId)
    if (!book) throw new Error('书籍不存在')
    return runTask(
      {
        kind: 'review',
        title: `一致性审校 · 第${chapter.chapterNo}章`,
        bookId: book.id,
        refId: chapter.id
      },
      async (task) => {
        taskCenter.update(task.id, { phase: 'context', message: '正在整理设定与事实…' })
        const pack = await buildChapterContext({
          book,
          chapterNo: chapter.chapterNo,
          chapterTitle: chapter.title,
          outline: chapter.outline,
          beats: []
        })
        taskCenter.update(task.id, { phase: 'checking', message: '正在逐条比对设定…' })
        const issues = await checkConsistency(chapter.content, pack.factsDigest)
        return {
          result: issues,
          message: issues.length ? `发现 ${issues.length} 个问题` : '未发现明显冲突'
        }
      }
    )
  })

  /**
   * 手动审校 + 自动修稿（一步完成）。
   * 任务中心记录阶段：审校 → 修稿 → 重建记忆，切页可见。
   */
  handle('chapters:reviewFix', async (id, level) => {
    const chapterId = String(id)
    const chapter = chapterRepo.get(chapterId)
    if (!chapter) throw new Error('章节不存在')
    const book = bookRepo.get(chapter.bookId)
    if (!book) throw new Error('书籍不存在')
    const minLevel: 'high' | 'medium' = level === 'high' ? 'high' : 'medium'

    type ReviewFixResult = {
      chapter: Chapter | null
      issues: ConsistencyIssue[]
      fixed: boolean
      fixedCount: number
      warning?: string
    }

    return runTask<ReviewFixResult>(
      {
        kind: 'reviewFix',
        title: `审校并修稿 · 第${chapter.chapterNo}章`,
        bookId: book.id,
        refId: chapterId
      },
      async (task) => {
        taskCenter.update(task.id, { phase: 'context', message: '正在整理设定与事实…' })
        const pack = await buildChapterContext({
          book,
          chapterNo: chapter.chapterNo,
          chapterTitle: chapter.title,
          outline: chapter.outline,
          beats: []
        })
        taskCenter.update(task.id, { phase: 'checking', message: '正在审校…' })
        const issues = await checkConsistency(chapter.content, pack.factsDigest)
        const targets = issuesToFix(issues, minLevel)
        if (!targets.length) {
          const clean: ReviewFixResult = { chapter: chapterRepo.get(chapterId), issues, fixed: false, fixedCount: 0 }
          return { result: clean, message: '没有需要修改的问题' }
        }

        taskCenter.update(task.id, { phase: 'fixing', message: `正在修改 ${targets.length} 个问题…` })
        const fixed = await fixChapter(chapter.content, targets)
        if (!fixed || fixed.length < chapter.content.length * 0.6) {
          const kept: ReviewFixResult = {
            chapter: chapterRepo.get(chapterId),
            issues,
            fixed: false,
            fixedCount: 0,
            warning: '修稿结果异常，已保留原正文'
          }
          return { result: kept, message: '修稿结果异常，已保留原正文' }
        }
        chapterRepo.upsert({
          bookId: book.id,
          chapterNo: chapter.chapterNo,
          volumeNo: chapter.volumeNo,
          title: chapter.title,
          content: fixed,
          status: 'reviewed'
        })
        const updated = chapterRepo.get(chapterId)!
        taskCenter.update(task.id, { phase: 'memory', message: '正在重建摘要与记忆…' })
        try {
          const digest = await summarizeChapter(updated.chapterNo, updated.title, updated.content)
          await persistDigest(book, chapterId, updated.chapterNo, digest)
        } catch (err) {
          console.warn('[ipc] 修稿后重建记忆失败', err)
        }
        bookRepo.touch(book.id)
        const done: ReviewFixResult = {
          chapter: chapterRepo.get(chapterId),
          issues,
          fixed: true,
          fixedCount: targets.length
        }
        return { result: done, message: `已修改 ${targets.length} 个问题` }
      }
    )
  })

  /**
   * 手动审校 + 自动修稿（一步完成）。
   * 任务中心记录阶段：审校 → 修稿 → 重建记忆，切页可见。
   */
    /* ---------------- bible ---------------- */
  handle('bible:list', (bookId) => bibleRepo.list(String(bookId)))
  handle('bible:save', (entry) => {
    const e = entry as {
      bookId: string
      kind: BibleKind
      name: string
      id?: string
      content?: string
      state?: Record<string, unknown>
      importance?: number
      locked?: boolean
    }
    bibleRepo.upsert({
      id: e.id || undefined,
      bookId: e.bookId,
      kind: e.kind,
      name: e.name,
      content: e.content || '',
      state: e.state,
      importance: e.importance,
      locked: e.locked
    })
    bookRepo.touch(e.bookId)
    return bibleRepo.list(e.bookId)
  })
  handle('bible:remove', (id) => {
    bibleRepo.remove(String(id))
  })

  /* ---------------- outline ---------------- */
  handle('outline:list', (bookId) => outlineRepo.list(String(bookId)))

  /* ---------------- memory ---------------- */
  handle('memory:overview', (bookId): MemoryOverview => {
    const id = String(bookId)
    const chapters = chapterRepo.list(id)
    const bible = bibleRepo.list(id)
    const fsList = foreshadowRepo.list(id)
    const lastSummary = [...chapters].reverse().find((c) => c.summary.trim())
    return {
      bookId: id,
      chapterCount: chapters.length,
      wordCount: chapterRepo.totalWords(id),
      bibleCount: bible.length,
      openForeshadowing: fsList.filter((f) => f.status === 'open').length,
      totalForeshadowing: fsList.length,
      lastSummaryChapter: lastSummary?.chapterNo || 0,
      volumes: volumeSummaryRepo.list(id),
      recentChapters: chapters
        .filter((c) => c.summary.trim())
        .slice(-5)
        .reverse()
        .map((c) => ({ chapterNo: c.chapterNo, title: c.title, summary: c.summary })),
      entityCount: bible.filter((b) => ['character', 'faction', 'item', 'location'].includes(b.kind)).length,
      vectorCount: embeddingRepo.count(id)
    }
  })

  handle('memory:search', async (bookId, query) => {
    const book = bookRepo.get(String(bookId))
    if (!book) throw new Error('书籍不存在')
    return retrieve(book, String(query), { topK: 20 })
  })

  handle('memory:rebuild', (bookId) => {
    const id = String(bookId)
    return runTask(
      { kind: 'index', title: '重建记忆索引', bookId: id, refId: id },
      async (task) => {
        taskCenter.update(task.id, { phase: 'index', message: '正在重新向量化全部章节…' })
        const n = await rebuildBookIndex(id)
        return { result: n, message: `索引完成：${n}` }
      }
    )
  })
  handle('memory:volumes', (bookId) => volumeSummaryRepo.list(String(bookId)))
  handle('memory:foreshadowing', (bookId) => foreshadowRepo.list(String(bookId)))
  handle('memory:addForeshadowing', (input) => {
    const i = input as { bookId: string; name: string; note?: string; plantedChapterNo?: number; resolveByChapterNo?: number }
    foreshadowRepo.upsert({ ...i })
    return foreshadowRepo.list(i.bookId)
  })
  handle('memory:resolveForeshadowing', (bookId, name) => {
    foreshadowRepo.resolve(String(bookId), String(name))
    return foreshadowRepo.list(String(bookId))
  })
  handle('memory:extractStyle', (sample) => {
    const text = String(sample)
    return runTask(
      { kind: 'style', title: '提取文风卡' },
      async (task) => {
        taskCenter.update(task.id, { phase: 'analyze', message: '正在分析句式与节奏…' })
        const profile = await extractStyle(text)
        return { result: profile, message: profile ? '文风卡已提取' : '样本太短，未能提取' }
      }
    )
  })
  handle('memory:contextPreview', async (bookId, chapterNo) => {
    const id = String(bookId)
    const book = bookRepo.get(id)
    if (!book) throw new Error('书籍不存在')
    const no = Number(chapterNo) || (chapterRepo.lastCompleted(id)?.chapterNo || 0) + 1
    const outline = outlineRepo.chapters(id).find((o) => o.seq === no)
    const pack = await buildChapterContext({
      book,
      chapterNo: no,
      chapterTitle: outline?.title || `第${no}章`,
      outline: outline?.goal || '',
      beats: outline?.beats || []
    })
    return {
      chapterNo: no,
      estimatedTokens: pack.estimatedTokens,
      blocks: pack.blocks.map((b) => ({ label: b.label, tokens: b.tokens, preview: b.content.slice(0, 300) })),
      hits: pack.hits.slice(0, 10)
    }
  })

  /* ---------------- 导出 ---------------- */
  handle('export:book', async (bookId, format, saveAs) => {
    const id = String(bookId)
    const book = bookRepo.get(id)
    if (!book) throw new Error('书籍不存在')
    const fmt = format === 'epub' ? 'epub' : 'txt'
    let target: string | undefined
    if (saveAs !== false) {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      const safeTitle = book.title.replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || '未命名'
      const res = await dialog.showSaveDialog(win, {
        title: '导出作品',
        defaultPath: path.join(app.getPath('downloads'), `${safeTitle}.${fmt}`),
        filters:
          fmt === 'epub'
            ? [{ name: 'EPUB 电子书', extensions: ['epub'] }]
            : [{ name: '文本文件', extensions: ['txt'] }]
      })
      if (res.canceled || !res.filePath) return null
      target = res.filePath
    }
    return exportBook(id, fmt, target)
  })

  /* ---------------- cover ---------------- */
  handle('cover:generate', async (bookId, useAi, variant) => {
    const id = String(bookId)
    const ai = useAi !== false
    const v = Number(variant) || 0
    return runTask(
      { kind: 'cover', title: ai ? '生成 AI 封面' : '生成封面', bookId: id, refId: id },
      async (task) => {
        taskCenter.update(task.id, { phase: 'cover', message: ai ? '正在请求绘图模型…' : '正在排版本地模板…' })
        const r = await generateCover(id, ai, v)
        return {
          result: { path: r.path, dataUrl: r.dataUrl, mode: r.mode },
          message: `封面完成（${r.mode}）`
        }
      }
    )
  })
  handle('cover:read', (bookId) => readCoverAsDataUrl(String(bookId)))
  handle('cover:pick', async (bookId) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: '选择封面图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return importCover(String(bookId), result.filePaths[0])
  })

  /* ---------------- pipeline ---------------- */
  handle('pipeline:start', async (bookId, from, count, opts) => {
    if (writingRunner.isRunning()) throw new Error('已有写作任务在运行，请先等待或停止')
    // run() 内部已广播 error 事件，这里仅吞掉抛出以避免未处理拒绝
    writingRunner.run(String(bookId), Number(from) || 0, Number(count) || 1, (opts as never) || {}).catch(() => {})
    return writingRunner.getStatus()
  })
  handle('pipeline:pause', () => {
    writingRunner.pause()
    return writingRunner.getStatus()
  })
  handle('pipeline:stop', () => {
    writingRunner.stop()
    return writingRunner.getStatus()
  })
  handle('pipeline:status', () => writingRunner.getStatus())

  /* ---------------- 番茄阅读标签 ---------------- */
  handle('tags:vocabulary', (bookId) => {
    const book = bookId ? bookRepo.get(String(bookId)) : null
    const mode: 'novel' | 'short' = book && book.workType === 'short' ? 'short' : 'novel'
    return {
      snapshot: FANQIE_TAG_SNAPSHOT,
      mode,
      groups: tagVocabulary(mode),
      limits: mode === 'short' ? { main: 1, total: SHORT_TAG_TOTAL } : TAG_LIMITS
    }
  })
  handle('tags:suggest', async (bookId) => {
    const book = bookRepo.get(String(bookId))
    if (!book) throw new Error('书籍不存在')
    return runTask(
      { kind: 'tags', title: '自动选标签', bookId: book.id, refId: book.id },
      async (task) => {
        taskCenter.update(task.id, { phase: 'analyze', message: '正在按番茄词表匹配…' })
        const pick = await suggestFanqieTags(book)
        const saved = { ...pick, analyzedAt: Date.now() }
        bookRepo.update(book.id, { fanqieTags: saved })
        return {
          result: { pick: saved, book: bookRepo.get(book.id) },
          message: `已选：${saved.main || '未定'}`
        }
      }
    )
  })
  handle('tags:save', (bookId, pick) => {
    const book = bookRepo.get(String(bookId))
    if (!book) throw new Error('书籍不存在')
    const mode: 'novel' | 'short' = book.workType === 'short' ? 'short' : 'novel'
    const normalized = { ...normalizeTagPick(pick as never, mode), analyzedAt: Date.now() }
    bookRepo.update(book.id, { fanqieTags: normalized })
    return { pick: normalized, book: bookRepo.get(book.id) }
  })

  /* ---------------- 自动更新 ---------------- */
  handle('update:state', () => updater.getState())
  handle('update:check', () => updater.check(false))
  handle('update:download', () => updater.download())
  handle('update:install', () => {
    updater.install()
    return true
  })

  /* ---------------- 后台任务 ---------------- */
  handle('tasks:list', () => taskCenter.list())
  handle('tasks:get', (id) => taskCenter.get(String(id)))
  handle('tasks:cancel', (id) => {
    taskCenter.cancel(String(id))
    return taskCenter.get(String(id))
  })

  /* ---------------- publish ---------------- */
  handle('publish:status', () => fanqie.status())
  handle('publish:open', () => fanqie.open(true))
  handle('publish:close', () => fanqie.close())
  handle('publish:probe', () => fanqie.pageProbe())
  handle('publish:captures', () => fanqie.readCaptures())
  handle('publish:clearCaptures', () => fanqie.clearCaptures())
  handle('publish:templates', () => captureRepo.list())
  handle('publish:saveCapture', (capture, role, name) => {
    fanqie.saveCapture([capture as RawCapture], role as never, String(name))
    return captureRepo.list()
  })
  handle('publish:setRole', (id, role) => {
    captureRepo.setRole(String(id), role as never)
    return captureRepo.list()
  })
  handle('publish:removeTemplate', (id) => {
    captureRepo.remove(String(id))
    return captureRepo.list()
  })
  handle('publish:updateTemplate', (id, patch) => {
    const p = patch as { name?: string; body?: string }
    if (p.name !== undefined) captureRepo.rename(String(id), p.name)
    if (p.body !== undefined) captureRepo.updateBody(String(id), p.body)
    return captureRepo.list()
  })
  handle('publish:replay', (id, vars) => {
    const tpl = captureRepo.list().find((t) => t.id === String(id))
    if (!tpl) throw new Error('模板不存在')
    return runTask(
      { kind: 'replay', title: `回放接口 · ${tpl.role}`, refId: tpl.id },
      async (task) => {
        taskCenter.update(task.id, { phase: 'replay', message: '正在回放请求…' })
        const res = await fanqie.replay(tpl, vars as never)
        return { result: res, message: `HTTP ${res.status}` }
      }
    )
  })
  handle('publish:fill', (title, content) => fanqie.fillEditor(String(title), String(content)))
  /**
   * 勾选到番茄后台。
   * pick 由前端传入当前界面的选择（可能还没点保存），
   * 这里先按作品类型校验并落库，再执行勾选——避免"界面已选、库里为空"导致失败。
   */
  handle('publish:applyTags', (bookId, pick) => {
    const book = bookRepo.get(String(bookId))
    if (!book) throw new Error('书籍不存在')
    const mode: 'novel' | 'short' = book.workType === 'short' ? 'short' : 'novel'
    const source = (pick as never) || book.fanqieTags
    const normalized = normalizeTagPick(source, mode)
    if (!normalized.main) throw new Error('请先选择主分类（必选）')
    const saved = { ...normalized, analyzedAt: Date.now() }
    bookRepo.update(book.id, { fanqieTags: saved })
    return runTask(
      { kind: 'publishTags', title: '勾选阅读标签到后台', bookId: book.id, refId: book.id },
      async (task) => {
        taskCenter.update(task.id, { phase: 'open', message: '正在打开番茄后台…' })
        const r = (await fanqie.applyTags(saved)) as { ok?: boolean; missing?: string[] }
        const message = r && r.ok ? '已勾选完成，请在后台确认' : `部分未勾上：${(r && r.missing) || []}`
        return { result: r, message }
      }
    )
  })
  handle('publish:readTags', () => fanqie.readTags())
  handle('publish:publishChapter', (bookId, chapterId, mode) => {
    const bid = String(bookId)
    const cid = String(chapterId)
    const m = mode as 'api' | 'dom' | 'manual'
    return runTask(
      { kind: 'publish', title: '发布到番茄', bookId: bid, refId: cid },
      async (task) => {
        taskCenter.update(task.id, { phase: 'publish', message: '正在提交到番茄后台…' })
        const res = await fanqie.publishChapter(bid, cid, m)
        return { result: res, message: res.message }
      }
    )
  })
  handle('publish:jobs', (bookId) => publishRepo.list(String(bookId)))

  /* ---------------- misc ---------------- */
  handle('misc:copy', (text) => clipboard.writeText(String(text)))
  handle('misc:persist', () => {
    persistNow()
    return true
  })
  handle('misc:wordCount', (text) => countWords(String(text)))
  handle('misc:openCover', async (bookId) => {
    const p = path.join(getDataDir(), 'covers', `${bookId}.png`)
    if (fs.existsSync(p)) await shell.openPath(p)
  })

  // 运行器事件广播
  writingRunner.on('event', (e: PipelineEvent) => broadcast('pipeline:event', e))
  // 后台任务事件广播（去AI味 / 审校 / 修稿 / 写记忆）
  taskCenter.on('task', (t) => broadcast('task:event', t))
}
