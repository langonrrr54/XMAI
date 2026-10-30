/**
 * 长程记忆检索器
 * 混合策略：BM25（章摘要 + 设定条目） + 向量相似度（摘要） + 新近度加权
 * 目标：在 1000+ 章的规模下，稳定召回"与本章相关的旧情节/人物/设定"。
 */
import type { Book } from '@shared/types'
import { embed } from '../llm/client'
import { loadSettings } from '../settings'
import { bibleRepo, bookRepo, chapterRepo, embeddingRepo, settingsRepo } from '../db/repo'
import { bm25Search, cosine, localEmbed } from './vector'

export interface MemoryHit {
  refType: 'chapter' | 'bible' | 'volume'
  refId: string
  chapterNo: number
  title: string
  text: string
  score: number
  sources: string[]
}

/**
 * 索引指纹：用来判断「当前配置」和「已建好的索引」是否匹配。
 * 换 embedding 模型 / 换维度 / 从远程切到本地，都会导致旧向量失效，
 * 需要自动重建，而不是让用户自己记得点按钮。
 */
export function currentIndexFingerprint(): string {
  const s = loadSettings().model
  const remote = !!(s.models.embedding && s.apiKey)
  if (!remote) return 'local:hash512'
  return `remote:${s.models.embedding}`
}

export function embeddingSignature(): 'remote' | 'local' {
  const s = loadSettings().model
  return s.models.embedding && s.apiKey ? 'remote' : 'local'
}

/**
 * 检查索引是否与当前配置匹配；不匹配就自动重建。
 * 触发场景：换了 embedding 模型、维度变了、从远程切到本地（或反之）。
 * 返回 { rebuilt, reason }，调用方可据此提示用户。
 */
export async function ensureIndexFresh(bookId: string): Promise<{ rebuilt: boolean; reason: string }> {
  const want = currentIndexFingerprint()
  const saved = settingsRepo.get<string>(`index_fp:${bookId}`, '')
  if (saved === want) return { rebuilt: false, reason: '' }

  // 索引里没有向量时不必重建（还没写过东西）
  const count = embeddingRepo.count(bookId)
  if (count === 0) {
    settingsRepo.set(`index_fp:${bookId}`, want)
    return { rebuilt: false, reason: '' }
  }

  const reason = saved
    ? `索引配置变了（${saved} → ${want}），正在自动重建`
    : `首次建立索引（${want}）`
  await rebuildBookIndex(bookId)
  settingsRepo.set(`index_fp:${bookId}`, want)
  return { rebuilt: true, reason }
}

/**
 * 全库检查：启动时跑一遍，把所有配置不匹配的书自动重建。
 */
export async function ensureAllIndexesFresh(): Promise<{ bookId: string; title: string; reason: string }[]> {
  const results: { bookId: string; title: string; reason: string }[] = []
  for (const book of bookRepo.list()) {
    try {
      const r = await ensureIndexFresh(book.id)
      if (r.rebuilt) results.push({ bookId: book.id, title: book.title, reason: r.reason })
    } catch (err) {
      console.warn('[memory] 索引检查失败', book.title, err)
    }
  }
  return results
}

/** 为单章建立索引（幂等：先删后插）。summary 传完整的"第N章 标题：摘要"文本。 */
export async function indexChapter(bookId: string, chapterId: string, chapterNo: number, summary: string): Promise<void> {
  if (!summary.trim()) return
  embeddingRepo.deleteByRef(bookId, 'summary', chapterId)
  const settings = loadSettings().model
  let vec: Float32Array | null = null
  if (embeddingSignature() === 'remote') {
    const remote = await embed(settings, [summary])
    vec = remote?.[0] || null
  }
  if (!vec) vec = localEmbed(summary)
  embeddingRepo.insertMany(bookId, [
    { refType: 'summary', refId: chapterId, chunkIndex: 0, text: summary, vec }
  ])
}

/** 重建整本书索引 */
export async function rebuildBookIndex(bookId: string): Promise<number> {
  // 重建完成后同步指纹，避免下次误判为不匹配
  const chapters = chapterRepo.list(bookId)
  embeddingRepo.clear(bookId)
  let n = 0
  for (const ch of chapters) {
    if (!ch.summary?.trim()) continue
    await indexChapter(bookId, ch.id, ch.chapterNo, `第${ch.chapterNo}章 ${ch.title}：${ch.summary}`)
    n++
  }
  settingsRepo.set(`index_fp:${bookId}`, currentIndexFingerprint())
  return n
}

function norm(scores: number[]): (v: number) => number {
  const max = Math.max(...scores, 1e-9)
  return (v) => v / max
}

/**
 * 检索与当前写作任务最相关的历史记忆
 * @param query 查询文本（当前章细纲 + 上一章钩子 + 关键人物）
 */
export async function retrieve(
  book: Book,
  query: string,
  opts: { topK?: number; currentChapterNo?: number; excludeRecent?: number } = {}
): Promise<MemoryHit[]> {
  const topK = opts.topK ?? 8
  const current = opts.currentChapterNo ?? book.targetChapters
  const excludeRecent = opts.excludeRecent ?? 3
  const chapters = chapterRepo.list(book.id).filter((c) => c.chapterNo <= current - excludeRecent && c.summary.trim())
  const bible = bibleRepo.list(book.id)

  if (!chapters.length && !bible.length) return []

  // 1) BM25 over chapter summaries + bible
  const docs = [
    ...chapters.map((c) => ({
      id: `chapter:${c.id}`,
      // 把摘要时生成的检索词一起进索引：不同措辞也能命中（如「师父」↔「教剑的人」）
      text: `第${c.chapterNo}章 ${c.title} ${c.summary} ${c.keyEvents.join(' ')} ${(c.searchTerms || []).join(' ')}`
    })),
    ...bible.map((b) => ({ id: `bible:${b.id}`, text: `${b.name} ${b.content} ${JSON.stringify(b.state)}` }))
  ]
  const lexical = bm25Search(docs, query, topK * 4)
  const lexicalMax = lexical[0]?.score || 1

  // 2) 向量相似度（仅摘要）
  const semHits = new Map<string, number>()
  const rows = embeddingRepo.list(book.id)
  if (rows.length) {
    const settings = loadSettings().model
    let qvec: Float32Array | null = null
    if (embeddingSignature() === 'remote') {
      const r = await embed(settings, [query])
      qvec = r?.[0] || null
    }
    const useRemote = !!qvec
    if (!qvec) qvec = localEmbed(query)
    for (const row of rows) {
      if (row.refType !== 'summary') continue
      // 查询向量与库内向量维度不一致时跳过，避免无意义比较
      if (row.dim !== qvec.length) continue
      if (useRemote && row.dim !== qvec.length) continue
      const sim = cosine(qvec, row.vec)
      if (sim > 0.05) semHits.set(row.refId, sim)
    }
  }
  const semMax = Math.max(...semHits.values(), 1e-9)

  // 从查询里抽「专有名词」候选：连续 2~4 个汉字且出现次数少，作为实体名补充加分
  const queryTerms = new Set(
    (query.match(/[\u4e00-\u9fff]{2,4}/g) || []).filter((w) => w.length >= 2)
  )

  const byId = new Map<string, MemoryHit>()
  for (const c of chapters) {
    const lex = lexical.find((l) => l.id === `chapter:${c.id}`)
    // 实体名精确命中（例如「机械义肢」），比模糊相似更可信
    const docText = `第${c.chapterNo}章 ${c.title} ${c.summary} ${c.keyEvents.join(' ')} ${(c.searchTerms || []).join(' ')}`
    let entityBoost = 0
    for (const term of queryTerms) {
      if (term.length >= 3 && docText.includes(term)) entityBoost += 0.06
    }
    entityBoost = Math.min(entityBoost, 0.24)
    const sem = semHits.get(c.id) || 0
    if (!lex && sem <= 0.05) continue
    const recency = 1 / (1 + (current - c.chapterNo) / 60)
    // 关键词为主（本地哈希向量对中文召回弱），向量只做补充，新近度小幅加权
    const score = 0.62 * ((lex?.score || 0) / lexicalMax) + 0.23 * (sem / semMax) + 0.15 * recency
    byId.set(`chapter:${c.id}`, {
      refType: 'chapter',
      refId: c.id,
      chapterNo: c.chapterNo,
      title: c.title,
      text: c.summary,
      score: score + entityBoost,
      sources: [lex ? 'keyword' : '', sem ? 'vector' : '', 'recency'].filter(Boolean)
    })
  }
  for (const b of bible) {
    const lex = lexical.find((l) => l.id === `bible:${b.id}`)
    if (!lex) continue
    byId.set(`bible:${b.id}`, {
      refType: 'bible',
      refId: b.id,
      chapterNo: b.lastChapterNo,
      title: `${b.name}`,
      text: `${b.content}${b.state && Object.keys(b.state).length ? `（当前状态：${JSON.stringify(b.state)}）` : ''}`,
      score: 0.6 * (lex.score / lexicalMax),
      sources: ['keyword']
    })
  }

  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
