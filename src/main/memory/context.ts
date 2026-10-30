/**
 * 分层上下文编排器（长篇连贯性的核心）
 *
 * 记忆层级（由贵到贱，预算不足时自下而上裁剪）：
 *   L0 硬设定（locked / rule / power / world）
 *   L1 人物与势力状态卡（含随章更新的 state）
 *   L2 卷纲 + 全书卷级摘要（全书压缩史）
 *   L3 最近章节滚动摘要（细颗粒近况）
 *   L4 长程混合检索结果（久远但相关的情节）
 *   L5 上一章结尾原文（语感与衔接）
 *   L6 未回收伏笔台账 + 本章细纲
 */
import type { Book, Chapter } from '@shared/types'
import { estimateTokens } from '../llm/client'
import { bibleRepo, chapterRepo, foreshadowRepo, memoryRepo, volumeSummaryRepo } from '../db/repo'
import { loadSettings } from '../settings'
import { ensureIndexFresh, retrieve, type MemoryHit } from './retriever'

export interface ContextBlock {
  label: string
  content: string
  tokens: number
}

export interface ContextPack {
  blocks: ContextBlock[]
  estimatedTokens: number
  hits: MemoryHit[]
  /** 供审校使用的紧凑事实摘要 */
  factsDigest: string
}

function cut(text: string, maxTokens: number): string {
  if (!text) return ''
  const maxChars = Math.floor(maxTokens / 0.75)
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`
}

export async function buildChapterContext(input: {
  book: Book
  chapterNo: number
  chapterTitle: string
  outline: string
  beats: string[]
}): Promise<ContextPack> {
  const { book, chapterNo, chapterTitle, outline, beats } = input
  const settings = loadSettings()
  const budget = Math.max(6000, settings.writing.contextBudget)
  const usable = Math.floor(budget * 0.85)

  const bible = bibleRepo.list(book.id)
  const volumes = volumeSummaryRepo.list(book.id)
  const openFs = foreshadowRepo.open(book.id)
  const recent = chapterRepo
    .ranges(book.id, Math.max(1, chapterNo - 12), chapterNo - 1)
    .filter((c) => c.summary.trim() || c.content.trim())
  const prev = chapterRepo.getByNo(book.id, chapterNo - 1)

  // 写之前对齐索引：配置变了就自动重建，用户不必记得点按钮
  try {
    await ensureIndexFresh(book.id)
  } catch (err) {
    console.warn('[memory] 索引对齐失败，继续用现有索引', err)
  }

  // ---------- 检索查询 ----------
  // 细纲为空时查询只剩「第N章 标题」，检索等于没有锚点。
  // 这时补上最近几章摘要与关键实体名，保证长程检索有实质内容。
  const hasOutline = !!(outline && outline.trim()) || beats.length > 0
  const fallbackQuery = hasOutline
    ? ''
    : [
        ...recent.map((c) => c.summary).slice(-3),
        ...bible
          .filter((b) => b.importance >= 3)
          .slice(0, 12)
          .map((b) => b.name)
      ].join(' ')

  const queryParts = [
    `第${chapterNo}章 ${chapterTitle}`,
    outline,
    beats.join(' '),
    prev?.summary || '',
    openFs.map((f) => f.name).join(' '),
    prev?.keyEvents?.join(' ') || '',
    bible.filter((b) => b.importance >= 4).map((b) => b.name).join(' '),
    prev?.content ? prev.content.slice(-200) : '',
    fallbackQuery
  ].filter(Boolean)
  const hits = await retrieve(book, queryParts.join('\n'), {
    topK: 8,
    currentChapterNo: chapterNo
  })
  // 已经被"最近章节"覆盖的检索结果不重复注入
  const recentIds = new Set(recent.map((c) => c.id))
  const longRangeHits = hits.filter((h) => h.refType !== 'chapter' || !recentIds.has(h.refId))

  // ---------- 组装 ----------
  const blocks: ContextBlock[] = []
  const push = (label: string, content: string, maxTokens: number): void => {
    const trimmed = cut(content.trim(), maxTokens)
    if (!trimmed) return
    blocks.push({ label, content: trimmed, tokens: estimateTokens(trimmed) })
  }

  // L0 硬设定
  const hard = bible.filter((b) => b.locked || b.kind === 'rule' || b.kind === 'power' || b.kind === 'world')
  push(
    '核心设定（不可违背）',
    hard.map((b) => `【${b.kind}｜${b.name}】${b.content}`).join('\n'),
    Math.min(4500, usable * 0.18)
  )

  // L1 人物/势力/道具状态卡
  const entities = bible.filter((b) => !hard.includes(b) && ['character', 'faction', 'item', 'location'].includes(b.kind))
  const mentioned = entities.filter((e) => queryParts.join(' ').includes(e.name))
  const orderedEntities = [...mentioned, ...entities.filter((e) => !mentioned.includes(e) && e.importance >= 4)]
  push(
    '人物与势力档案（含最新状态）',
    orderedEntities
      .slice(0, 24)
      .map((e) => {
        const state = Object.keys(e.state || {}).length ? `｜状态：${JSON.stringify(e.state)}` : ''
        return `【${e.name}｜${e.kind}】${e.content}${state}（更新至第${e.lastChapterNo || 0}章）`
      })
      .join('\n'),
    Math.min(3500, usable * 0.14)
  )

  // L2 全书卷级摘要
  push(
    '全书前情（分卷摘要）',
    volumes.map((v) => `第${v.volumeNo}卷：${v.content}`).join('\n\n'),
    Math.min(3000, usable * 0.12)
  )

  // L2.5 既定事实（由各章摘要抽取，不可违背）
  // 去重后按时间取，避免旧的关键事实被新事实挤出上下文
  const facts = memoryRepo.factsRelevant(book.id, queryParts.join(' '), 40)
  push(
    '既定事实',
    facts.map((m) => `- ${m.content}`).join('\n'),
    Math.min(2200, usable * 0.09)
  )

  // L3 最近章节滚动摘要
  const recentOrdered = [...recent].sort((a, b) => b.chapterNo - a.chapterNo)
  const recentText = recentOrdered
    .map((c, idx) => {
      const detail = idx < 3 ? c.summary : cut(c.summary, Math.max(80, 200 - idx * 20))
      return `第${c.chapterNo}章 ${c.title}：${detail}`
    })
    .join('\n')
  push('最近章节脉络', recentText, Math.min(4200, usable * 0.18))

  // L4 长程检索
  push(
    '相关往事（长程检索）',
    longRangeHits
      .map((h) => (h.refType === 'chapter' ? `第${h.chapterNo}章 ${h.title}：${h.text}` : `【设定】${h.title}：${h.text}`))
      .join('\n'),
    Math.min(3200, usable * 0.13)
  )

  // L6 伏笔台账：逾期未回收的排前面并显式标注，逼着模型优先收尾
  const overdue = openFs.filter((f) => f.resolveByChapterNo > 0 && chapterNo > f.resolveByChapterNo)
  const normalFs = openFs.filter((f) => !overdue.includes(f))
  const fsLines = [...overdue, ...normalFs].map((f) => {
    const isOverdue = overdue.includes(f)
    const due = f.resolveByChapterNo > 0 ? '计划第' + f.resolveByChapterNo + '章前回收' : '未定回收章'
    const flag = isOverdue ? '【逾期未回收，本章必须处理或明确交代】' : ''
    return flag + f.name + '（第' + f.plantedChapterNo + '章埋下，' + due + '）：' + f.note
  })
  push('待回收伏笔', fsLines.join('\n'), Math.min(1400, usable * 0.05))

  // L5 上一章结尾原文
  if (prev?.content) {
    const tail = prev.content.slice(-900)
    push('上一章结尾（衔接）', `第${prev.chapterNo}章 ${prev.title} 结尾：\n…${tail}`, 1400)
  }

  // 兜底：按预算裁剪。
  // 关键：不能按「从尾部往前」的顺序删——上一章结尾恰好在最后，
  // 那样一超预算就先丢衔接内容，写出来的下一章会接不上前文。
  // 按重要性从低到高依次丢弃，硬设定与伏笔永不丢。
  const DROP_ORDER = [
    '相关往事（长程检索）',
    '既定事实',
    '全书前情（分卷摘要）',
    '人物与势力档案（含最新状态）',
    '最近章节脉络',
    '上一章结尾（衔接）'
  ]
  let total = blocks.reduce((s, b) => s + b.tokens, 0)
  for (const target of DROP_ORDER) {
    if (total <= usable) break
    const idx = blocks.findIndex((b) => b.label === target)
    if (idx < 0) continue
    total -= blocks[idx].tokens
    blocks.splice(idx, 1)
  }
  // 还超预算（极端情况）：继续从最不重要的往后删，但保留硬设定与伏笔
  while (total > usable && blocks.length > 2) {
    const idx = blocks.findIndex((b) => !b.label.includes('核心设定') && !b.label.includes('伏笔'))
    if (idx < 0) break
    total -= blocks[idx].tokens
    blocks.splice(idx, 1)
  }

  // 审校用的事实清单：给总长上限，避免设定多了之后把上下文撑爆
  const FACTS_DIGEST_MAX = 1800
  const factsDigest = cut(
    [
      hard.map((b) => `- ${b.name}：${b.content}`).join('\n'),
      orderedEntities
        .slice(0, 12)
        .map(
          (e) =>
            `- ${e.name}：${e.content}${Object.keys(e.state || {}).length ? `｜状态 ${JSON.stringify(e.state)}` : ''}`
        )
        .join('\n'),
      recentOrdered.slice(0, 5).map((c) => `- 第${c.chapterNo}章：${c.summary}`).join('\n'),
      openFs.length ? `- 待回收伏笔：${openFs.map((f) => f.name).join('、')}` : ''
    ]
      .filter(Boolean)
      .join('\n'),
    FACTS_DIGEST_MAX
  )

  return {
    blocks,
    estimatedTokens: blocks.reduce((s, b) => s + b.tokens, 0),
    hits,
    factsDigest
  }
}

/** 为细纲生成提供的前文脉络（更短、更宏观） */
export function buildOutlineDigest(book: Book, upToChapter: number): string {
  const volumes = volumeSummaryRepo.list(book.id)
  const recent = chapterRepo.ranges(book.id, Math.max(1, upToChapter - 12), upToChapter)
  const parts: string[] = []
  if (volumes.length) {
    parts.push('【分卷摘要】')
    for (const v of volumes.slice(-6)) parts.push(`第${v.volumeNo}卷：${cut(v.content, 500)}`)
  }
  if (recent.length) {
    parts.push('【最近章节】')
    for (const c of recent) parts.push(`第${c.chapterNo}章 ${c.title}：${cut(c.summary, 120)}`)
  }
  const last = chapterRepo.getByNo(book.id, upToChapter)
  if (last?.content) parts.push(`【上一章结尾】…${last.content.slice(-400)}`)
  return parts.join('\n')
}

export function tailOf(chapter: Chapter | null, chars = 600): string {
  if (!chapter?.content) return ''
  return chapter.content.slice(-chars)
}
