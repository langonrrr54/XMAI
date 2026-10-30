/**
 * 单章写作流水线：细纲 → 上下文编排 → 正文流式生成 → 记忆固化 → 审校 → 可选修稿
 */
import type { Book, Chapter, ConsistencyIssue } from '@shared/types'
import { chatStream, LlmError } from '../llm/client'
import * as P from '../llm/prompts'
import { loadSettings } from '../settings'
import { bookRepo, chapterRepo, memoryRepo, outlineRepo } from '../db/repo'
import { buildChapterContext } from '../memory/context'
import { checkConsistency, fixChapter, issuesToFix, persistDigest, summarizeChapter } from '../memory/memoryService'
import { generateChapterOutlines, generateShortStructure, volumeOfChapter } from './bookForge'

export interface WriteOptions {
  bookId: string
  chapterNo?: number
  signal?: AbortSignal
  onDelta?: (delta: string, full: string) => void
  onPhase?: (phase: string, message: string) => void
  autoReview?: boolean
  consistencyCheck?: boolean
  /** 结局章：强制收束主线与伏笔，不留新钩子 */
  finale?: boolean
}

/** 清洗模型输出：去掉章节标题重复、Markdown 围栏与前言 */
export function cleanNovelText(raw: string, chapterNo: number): string {
  let text = raw.replace(/\r\n/g, '\n').trim()
  text = text.replace(/^```[a-zA-Z]*\s*/g, '').replace(/```\s*$/g, '').trim()
  // 去掉"以下是正文：""好的，我来写"之类的开场
  text = text.replace(/^(好的|当然|没问题)[^\n]{0,40}\n+/g, '')
  text = text.replace(/^以下是[^\n]{0,60}[:：]\s*\n+/g, '')
  // 去掉与章号重复的标题行
  const lines = text.split('\n')
  const titleRe = new RegExp(`^\\s*第?\\s*${chapterNo}\\s*章[\\s:：、.．-].{0,30}$`)
  while (lines.length && (!lines[0].trim() || titleRe.test(lines[0].trim()))) lines.shift()
  text = lines.join('\n').trim()
  // 去掉结尾的"未完待续 / 本章完"
  text = text.replace(/\n*(本章完|未完待续|（本章完）|\(本章完\))\s*$/g, '').trim()
  return text
}

function pickChapterNo(bookId: string): number {
  const last = chapterRepo.lastCompleted(bookId) || chapterRepo.last(bookId)
  return (last?.chapterNo || 0) + 1
}

export async function writeChapter(opts: WriteOptions): Promise<{ chapter: Chapter; issues: ConsistencyIssue[] }> {
  const settings = loadSettings()
  const book = bookRepo.get(opts.bookId)
  if (!book) throw new Error('书籍不存在')

  if (book.workType === 'short') return writeShortStory(book, opts)

  const chapterNo = opts.chapterNo || pickChapterNo(opts.bookId)
  opts.onPhase?.('outline', `准备第 ${chapterNo} 章细纲`)

  // 1) 细纲：没有就先生成
  let outline = outlineRepo.chapters(opts.bookId).find((o) => o.seq === chapterNo)
  if (!outline) {
    await generateChapterOutlines(opts.bookId, chapterNo, 5)
    outline = outlineRepo.chapters(opts.bookId).find((o) => o.seq === chapterNo)
  }
  const chapterTitle = outline?.title || `第${chapterNo}章`
  const beats = outline?.beats || []
  const goal = outline?.goal || ''

  // 2) 上下文
  opts.onPhase?.('context', '编排分层记忆上下文')
  const pack = await buildChapterContext({
    book,
    chapterNo,
    chapterTitle,
    outline: goal,
    beats
  })
  const prev = chapterRepo.getByNo(opts.bookId, chapterNo - 1)
  const userPrompt = P.chapterUserPrompt({
    book,
    chapterNo,
    chapterTitle,
    outline: goal,
    beats,
    contextBlocks: pack.blocks.map((b) => ({ label: b.label, content: b.content })),
    previousTail: prev?.content ? prev.content.slice(-700) : ''
  })

  // 3) 生成正文
  opts.onPhase?.('writing', `正在写第 ${chapterNo} 章（已注入 ${pack.blocks.length} 层记忆，约 ${pack.estimatedTokens} tokens）`)
  const res = await chatStream(
    settings.model,
    [
      { role: 'system', content: P.writerSystem(book.styleProfile, book.wordsPerChapter, opts.finale) },
      { role: 'user', content: userPrompt }
    ],
    {
      purpose: 'writer',
      temperature: settings.model.temperature,
      maxTokens: Math.max(3000, Math.ceil(book.wordsPerChapter * 2.2)),
      onDelta: opts.onDelta,
      signal: opts.signal
    }
  )

  let content = cleanNovelText(res.content, chapterNo)
  if (!content) throw new LlmError('生成为空，请检查模型配置')

  // 4) 篇幅不足时补写一次（只补一次，避免无限循环）
  const target = book.wordsPerChapter
  // 低于目标 80% 就补写：60% 太松，容易交出明显偏短的章节
  if (content.length < target * 0.8) {
    opts.onPhase?.('extend', `正文偏短（${content.length} 字），补写中`)
    try {
      const ext = await chatStream(
        settings.model,
        [
          {
            role: 'system',
            content: `${P.writerSystem(book.styleProfile, book.wordsPerChapter, opts.finale)}\n\n你已经写了本章前半部分，现在紧接着往下写，直到把本章节拍全部完成。不要重复已写内容，不要重新开头。`
          },
          {
            role: 'user',
            content: `【本章任务】${goal}\n【节拍】${beats.join('；')}\n【已写内容（末尾）】\n${content.slice(-1200)}\n\n请直接续写后文。`
          }
        ],
        {
          purpose: 'writer',
          temperature: settings.model.temperature,
          maxTokens: Math.max(2000, Math.ceil(target * 1.6)),
          signal: opts.signal,
          onDelta: opts.onDelta
        }
      )
      const more = cleanNovelText(ext.content, chapterNo)
      if (more && !content.endsWith(more.slice(0, 20))) content = `${content}\n\n${more}`
    } catch (err) {
      console.warn('[writer] 补写失败，保留当前正文', err)
      opts.onPhase?.('extend-failed', `补写未成功（${content.length}/${target} 字），保留现有正文`)
    }
  }
  if (content.length < target * 0.6) {
    opts.onPhase?.('short', `正文偏短：${content.length} 字（目标 ${target}）`)
  }

  // 5) 落库
  const { volumeNo } = volumeOfChapter(opts.bookId, chapterNo)
  let chapter = chapterRepo.upsert({
    bookId: opts.bookId,
    chapterNo,
    volumeNo,
    title: chapterTitle,
    outline: [goal, ...beats.map((b, i) => `${i + 1}. ${b}`)].join('\n'),
    content,
    status: 'drafted'
  })
  outlineRepo.setStatus(opts.bookId, 'chapter', chapterNo, 'done')

  // 6) 记忆固化 + 7) 审校
  const reviewed = await reviewAndPersist(book, chapter.id, pack.factsDigest, opts)
  bookRepo.touch(book.id)
  return reviewed
}

/** 记忆固化 + 审校 + 可选修稿（长篇小说与短故事共用） */
async function reviewAndPersist(
  book: Book,
  chapterId: string,
  factsDigest: string,
  opts: WriteOptions
): Promise<{ chapter: Chapter; issues: ConsistencyIssue[] }> {
  const settings = loadSettings()
  let chapter = chapterRepo.get(chapterId)
  if (!chapter) throw new Error('章节不存在')
  const chapterNo = chapter.chapterNo

  opts.onPhase?.('memory', book.workType === 'short' ? '生成故事摘要与状态更新' : '生成本章摘要与状态更新')
  const digest = await summarizeChapter(chapterNo, chapter.title, chapter.content)
  await persistDigest(book, chapterId, chapterNo, digest)
  chapter = chapterRepo.get(chapterId)!

  let issues: ConsistencyIssue[] = []
  const autoReview = opts.autoReview ?? settings.writing.autoReview
  const doConsistency = opts.consistencyCheck ?? settings.writing.consistencyCheck
  if (autoReview || doConsistency) {
    opts.onPhase?.('review', '一致性审校')
    issues = await checkConsistency(chapter.content, factsDigest)
    const serious = issues.filter((i) => i.severity !== 'low')
    if (serious.length) {
      const label = book.workType === 'short' ? '短故事' : `第${chapterNo}章`
      memoryRepo.add(book.id, 'review', `${label}审校：${serious.map((i) => i.description).join('；')}`, 2)
    }
    // 自动修稿覆盖"严重 + 中等"：中等问题（如文风说教、总结式结尾）不改就会一直留在正文里
    const fixable = issuesToFix(issues, 'medium')
    if (autoReview && fixable.length) {
      opts.onPhase?.(
        'fix',
        `发现 ${fixable.length} 个问题（严重 ${issues.filter((i) => i.severity === 'high').length} 个），自动修稿`
      )
      try {
        const fixed = await fixChapter(chapter.content, fixable)
        if (fixed && fixed.length > chapter.content.length * 0.7) {
          chapter = chapterRepo.upsert({
            bookId: book.id,
            chapterNo,
            volumeNo: chapter.volumeNo,
            title: chapter.title,
            content: fixed,
            status: 'reviewed'
          })
          const newDigest = await summarizeChapter(chapterNo, chapter.title, fixed)
          await persistDigest(book, chapter.id, chapterNo, newDigest)
          chapter = chapterRepo.get(chapter.id)!
        }
      } catch (err) {
        console.warn('[writer] 自动修稿失败', err)
      }
    }
  }
  return { chapter, issues }
}

/**
 * 短故事：一次性写完整篇（不分章、不拆卷、不留连载钩子）
 */
async function writeShortStory(book: Book, opts: WriteOptions): Promise<{ chapter: Chapter; issues: ConsistencyIssue[] }> {
  const settings = loadSettings()
  const chapterNo = 1

  opts.onPhase?.('outline', '准备故事结构')
  let structure = outlineRepo.chapters(book.id).find((o) => o.seq === 1)
  if (!structure) {
    await generateShortStructure(book.id)
    structure = outlineRepo.chapters(book.id).find((o) => o.seq === 1)
  }
  const goal = structure?.goal || ''
  const beats = structure?.beats || []

  opts.onPhase?.('context', '编排人物与设定上下文')
  const pack = await buildChapterContext({
    book,
    chapterNo,
    chapterTitle: book.title,
    outline: goal,
    beats
  })
  const userPrompt = P.shortStoryUserPrompt({
    book,
    structure: { goal, beats },
    blocks: pack.blocks.map((b) => ({ label: b.label, content: b.content }))
  })

  const target = Math.max(1500, book.wordsPerChapter)
  opts.onPhase?.('writing', `正在写完整篇（目标 ${target} 字）`)
  const res = await chatStream(
    settings.model,
    [
      { role: 'system', content: P.shortStorySystem(book.styleProfile, target) },
      { role: 'user', content: userPrompt }
    ],
    {
      purpose: 'writer',
      temperature: settings.model.temperature,
      maxTokens: Math.min(32000, Math.max(4000, Math.ceil(target * 2.4))),
      onDelta: opts.onDelta,
      signal: opts.signal
    }
  )

  let content = cleanNovelText(res.content, 1)
  if (!content) throw new LlmError('生成为空，请检查模型配置')

  // 篇幅不足时补写一次，要求推进到结局
  if (content.length < target * 0.85) {
    opts.onPhase?.('extend', `正文偏短（${content.length} 字），补写中`)
    try {
      const ext = await chatStream(
        settings.model,
        [
          {
            role: 'system',
            content: `${P.shortStorySystem(book.styleProfile, target)}\n\n你已经写了故事的前半部分，现在接着写完后半部分，并给出完整结局。不要重复已写内容，不要重新开头。`
          },
          {
            role: 'user',
            content: `【故事结构】${goal}\n【已写内容（末尾）】\n${content.slice(-1200)}\n\n请直接续写至结局。`
          }
        ],
        {
          purpose: 'writer',
          temperature: settings.model.temperature,
          maxTokens: Math.max(2500, Math.ceil(target * 1.8)),
          onDelta: opts.onDelta,
          signal: opts.signal
        }
      )
      const more = cleanNovelText(ext.content, 1)
      if (more && !content.endsWith(more.slice(0, 20))) content = `${content}\n\n${more}`
    } catch (err) {
      console.warn('[writer] 短故事补写失败', err)
      opts.onPhase?.('extend-failed', `补写未成功（${content.length}/${target} 字），保留现有正文`)
    }
  }

  const chapter = chapterRepo.upsert({
    bookId: book.id,
    chapterNo: 1,
    volumeNo: 1,
    title: book.title,
    outline: [goal, ...beats.map((b, i) => `${i + 1}. ${b}`)].join('\n'),
    content,
    status: 'drafted'
  })
  outlineRepo.setStatus(book.id, 'chapter', 1, 'done')

  const reviewed = await reviewAndPersist(book, chapter.id, pack.factsDigest, opts)
  // 只有字数达到目标的 85% 才标记「已完成」；
  // 否则保留 writing 状态，让用户知道这是残篇，可以重写。
  const finalWords = chapterRepo.get(chapter.id)?.wordCount || 0
  const doneEnough = finalWords >= target * 0.85
  bookRepo.update(book.id, { status: doneEnough ? 'completed' : 'writing' })
  if (!doneEnough) {
    opts.onPhase?.('short', `字数不足（${finalWords}/${target}），已保留为草稿，可重写`)
  }
  bookRepo.touch(book.id)
  return reviewed
}

/**
 * 仅重写正文（沿用现有细纲）。
 * 先生成、成功后再替换旧正文：请求失败或用户中断时，原章节内容保持不变，
 * 不会出现"点重写 -> 网络抖动 -> 整章变空"的丢稿。
 */
export async function rewriteChapter(
  bookId: string,
  chapterNo: number,
  opts: Omit<WriteOptions, 'bookId' | 'chapterNo'>
): Promise<Chapter> {
  const existing = chapterRepo.getByNo(bookId, chapterNo)
  const backup = existing
    ? { title: existing.title, content: existing.content, status: existing.status, summary: existing.summary }
    : null
  const { chapter } = await writeChapter({ ...opts, bookId, chapterNo })
  if (!chapter.content.trim() && backup && backup.content.trim()) {
    chapterRepo.update(chapter.id, {
      title: backup.title,
      content: backup.content,
      status: backup.status,
      summary: backup.summary
    } as never)
    throw new Error('重写未产出正文，已保留原稿')
  }
  return chapter
}

export function nextChapterNo(book: Book): number {
  return pickChapterNo(book.id)
}
