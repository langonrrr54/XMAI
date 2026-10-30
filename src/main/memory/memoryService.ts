/**
 * 记忆固化服务：章节完成后把正文转化为可长期复用的结构化记忆。
 * 每一步都可独立失败，不阻断主流程（降级为本地规则）。
 */
import type { Book, ConsistencyIssue, StyleProfile } from '@shared/types'
import { chat, chatStream, extractJson } from '../llm/client'
import * as P from '../llm/prompts'
import { loadSettings } from '../settings'
import {
  bibleRepo,
  chapterRepo,
  foreshadowRepo,
  memoryRepo,
  volumeSummaryRepo
} from '../db/repo'
import { indexChapter } from './retriever'

export interface ChapterDigest {
  summary: string
  keyEvents: string[]
  stateUpdates: { kind: string; name: string; content: string; state: Record<string, unknown> }[]
  facts: string[]
  foreshadowPlanted: string[]
  foreshadowResolved: string[]
  nextHook: string
  /** 检索关键词：没有 embedding 模型时靠它提升跨章节召回 */
  searchTerms?: string[]
}

const FALLBACK_KINDS: BibleKindKind[] = ['character', 'item', 'faction', 'location']
type BibleKindKind = 'world' | 'power' | 'character' | 'location' | 'item' | 'faction' | 'rule' | 'timeline'

/** 摘要失败时的兜底检索词：从正文里抽出现频次最高的 2~4 字片段 */
function fallbackTerms(content: string): string[] {
  const text = content.replace(/\s+/g, '')
  const freq = new Map<string, number>()
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i + len <= text.length; i++) {
      const w = text.slice(i, i + len)
      if (!/^[\u4e00-\u9fff]+$/.test(w)) continue
      freq.set(w, (freq.get(w) || 0) + 1)
    }
  }
  return Array.from(freq.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([w]) => w)
}

/** 生成章节摘要（失败时退化为截断正文，保证流程可继续） */
export async function summarizeChapter(chapterNo: number, title: string, content: string): Promise<ChapterDigest> {
  const settings = loadSettings().model
  try {
    const res = await chat(settings, [
      { role: 'system', content: P.summarySystem() },
      { role: 'user', content: P.summaryUserPrompt(chapterNo, title, content) }
    ], { purpose: 'summarizer', temperature: 0.2, maxTokens: 2000, json: true })
    const data = extractJson<ChapterDigest>(res.content)
    return {
      summary: data.summary || '',
      keyEvents: Array.isArray(data.keyEvents) ? data.keyEvents.slice(0, 10) : [],
      stateUpdates: Array.isArray(data.stateUpdates) ? data.stateUpdates : [],
      facts: Array.isArray(data.facts) ? data.facts : [],
      foreshadowPlanted: Array.isArray(data.foreshadowPlanted) ? data.foreshadowPlanted : [],
      foreshadowResolved: Array.isArray(data.foreshadowResolved) ? data.foreshadowResolved : [],
      nextHook: data.nextHook || '',
      searchTerms: Array.isArray(data.searchTerms) ? data.searchTerms.slice(0, 16).map(String) : []
    }
  } catch (err) {
    console.warn('[memory] 摘要生成失败，使用降级方案', err)
    // 降级也要留下可检索的东西：截取更长的正文 + 抽高频词做检索词，
    // 否则这一章在长程检索里等于不存在，后续写作会「忘记」它。
    const plain = content.replace(/\s+/g, '')
    const terms = fallbackTerms(content)
    return {
      summary: plain.slice(0, 500),
      keyEvents: [],
      stateUpdates: [],
      facts: [],
      foreshadowPlanted: [],
      foreshadowResolved: [],
      nextHook: '',
      searchTerms: terms
    }
  }
}

/** 把摘要与事实写回记忆库 */
export async function persistDigest(book: Book, chapterId: string, chapterNo: number, digest: ChapterDigest): Promise<void> {
  const chapter = chapterRepo.get(chapterId)
  const keptStatus =
    chapter?.status === 'published' ? 'published' : chapter?.status === 'reviewed' ? 'reviewed' : 'drafted'
  chapterRepo.update(chapterId, {
    summary: digest.summary,
    keyEvents: digest.keyEvents,
    searchTerms: digest.searchTerms || [],
    status: keptStatus
  })

  for (const fact of digest.facts) {
    if (fact.trim()) memoryRepo.add(book.id, 'fact', fact.trim(), 4)
  }

  for (const upd of digest.stateUpdates) {
    const kind = (FALLBACK_KINDS.includes(upd.kind as BibleKindKind) ? upd.kind : 'character') as BibleKindKind
    const existing = bibleRepo.getByName(book.id, upd.name)
    bibleRepo.upsert({
      bookId: book.id,
      kind: existing?.kind || kind,
      name: upd.name,
      content: upd.content || existing?.content || '',
      state: upd.state || {},
      importance: existing?.importance ?? 3,
      lastChapterNo: chapterNo
    })
  }

  for (const name of digest.foreshadowPlanted) {
    if (name.trim()) {
      foreshadowRepo.upsert({
        bookId: book.id,
        name: name.trim(),
        note: `第${chapterNo}章埋下`,
        plantedChapterNo: chapterNo,
        resolveByChapterNo: chapterNo + 60
      })
    }
  }
  for (const name of digest.foreshadowResolved) {
    if (name.trim()) foreshadowRepo.resolve(book.id, name.trim())
  }

  // 索引文本里带上检索词：没有 embedding 模型时，这是跨章节召回的关键
  const terms = (digest.searchTerms || []).filter((x) => x && x.trim()).slice(0, 16)
  const indexText = digest.summary
    ? [
        `第${chapterNo}章 ${chapter?.title || ''}：${digest.summary}`,
        terms.length ? `检索词：${terms.join(' ')}` : ''
      ]
        .filter(Boolean)
        .join(' ')
    : ''
  await indexChapter(book.id, chapterId, chapterNo, indexText)

  // 每 6 章滚动更新本卷摘要（10 章太稀，中途停更会导致卷摘要长期为空）
  if (chapterNo % 6 === 0) {
    try {
      await refreshVolumeSummary(book.id, chapter?.volumeNo || 1)
    } catch (err) {
      console.warn('[memory] 卷摘要更新失败，跳过', err)
    }
  }
}

/** 卷级摘要滚动合并 */
export async function refreshVolumeSummary(bookId: string, volumeNo: number): Promise<string> {
  const all = chapterRepo.list(bookId).filter((c) => c.volumeNo === volumeNo && c.summary.trim())
  if (!all.length) return ''
  const settings = loadSettings().model
  // 只喂最近 40 章，并附上已有卷摘要做增量合并：卷写到几百章时不会把上下文撑爆
  const recent = all.slice(-40)
  const previous = volumeSummaryRepo.list(bookId).find((v) => v.volumeNo === volumeNo)?.content || ''
  const materials = [
    previous ? `【已有卷摘要（请在此基础上补充新内容，不要重写）】\n${previous}` : '',
    `【本卷最近 ${recent.length} 章】`,
    recent.map((c) => `第${c.chapterNo}章 ${c.title}：${c.summary}`).join('\n')
  ]
    .filter(Boolean)
    .join('\n\n')
  try {
    const res = await chat(settings, [
      { role: 'system', content: P.volumeSummarySystem() },
      { role: 'user', content: `第${volumeNo}卷章节摘要：\n${materials}` }
    ], { purpose: 'summarizer', temperature: 0.3, maxTokens: 3000 })
    const summary = res.content.trim()
    volumeSummaryRepo.put(bookId, volumeNo, summary)
    return summary
  } catch (err) {
    console.warn('[memory] 卷摘要生成失败', err)
    return ''
  }
}

/** 审校：返回确定存在的问题 */
export async function checkConsistency(content: string, facts: string): Promise<ConsistencyIssue[]> {
  const settings = loadSettings().model
  try {
    const res = await chat(settings, [
      { role: 'system', content: P.reviewSystem() },
      { role: 'user', content: P.reviewUserPrompt(content, facts) }
    ], {
      purpose: 'judge',
      temperature: 0.1,
      // 长章要更多预算装问题清单，否则 JSON 会被截断导致审校结果为空
      maxTokens: Math.min(4096, Math.max(1200, Math.ceil(content.length * 0.35))),
      json: true
    })
    const data = extractJson<{ issues?: ConsistencyIssue[]; score?: number }>(res.content)
    return (data.issues || []).filter((i) => i && i.description).slice(0, 20)
  } catch (err) {
    console.warn('[memory] 一致性审校失败', err)
    return []
  }
}

/** 按级别筛选需要修稿的问题（medium = 中等及以上） */
export function issuesToFix(issues: ConsistencyIssue[], level: 'high' | 'medium' = 'medium'): ConsistencyIssue[] {
  const rank = { low: 0, medium: 1, high: 2 }
  const min = rank[level]
  return issues.filter((i) => rank[i.severity] >= min)
}

/** 根据问题清单修稿 */
export async function fixChapter(content: string, issues: ConsistencyIssue[]): Promise<string> {
  if (!issues.length) return content
  const settings = loadSettings().model
  const list = issues
    .map((i, n) => `${n + 1}. [${i.type}/${i.severity}] ${i.description}｜证据：${i.evidence}｜建议：${i.suggestion}`)
    .join('\n')
  const res = await chat(settings, [
    { role: 'system', content: P.fixSystem() },
    { role: 'user', content: `【问题清单】\n${list}\n\n【原文】\n${content}` }
  ], {
    purpose: 'writer',
    temperature: 0.5,
    // 修稿要完整重写正文：按 1.5 倍估算，交给 client 的 clampMaxTokens 兜上限
    maxTokens: Math.max(3000, Math.ceil(content.length * 1.5))
  })
  return res.content.trim()
}

/**
 * 去 AI 味：只返回改写结果，不写库。
 * 走流式，按已生成字数回报进度，页面切走也能看到真实进展。
 */
export async function deAiRewrite(
  content: string,
  workType: 'novel' | 'short' = 'novel',
  hint?: string,
  onProgress?: (p: { chars: number; expected: number; preview: string }) => void
): Promise<{ text: string; changed: boolean }> {
  if (!content.trim()) throw new Error('正文为空')
  const settings = loadSettings().model
  const expected = Math.max(1, content.length)
  const res = await chatStream(
    settings,
    [
      { role: 'system', content: P.deAiSystem(workType) },
      { role: 'user', content: P.deAiUserPrompt(content, hint) }
    ],
    {
      purpose: 'writer',
      temperature: 0.75,
      maxTokens: Math.max(4000, Math.ceil(content.length * 1.5)),
      timeoutMs: 300000,
      onDelta: (_d, full) => {
        onProgress?.({ chars: full.length, expected, preview: full.slice(-120) })
      }
    }
  )
  const text = res.content
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .replace(/^(好的|当然|没问题)[^\n]{0,40}\n+/, '')
    .replace(/^以下是[^\n]{0,60}[:：]\s*\n+/, '')
    .trim()
  if (!text) throw new Error('模型没有返回内容')
  const ratio = text.length / content.length
  if (ratio < 0.7 || ratio > 1.6) {
    return { text, changed: false }
  }
  return { text, changed: text !== content.trim() }
}

/** 从样章提取文风卡 */
export async function extractStyle(sample: string): Promise<StyleProfile | null> {
  if (!sample.trim()) return null
  const settings = loadSettings().model
  try {
    const res = await chat(settings, [
      { role: 'system', content: P.styleExtractSystem() },
      { role: 'user', content: sample.slice(0, 6000) }
    ], { purpose: 'planner', temperature: 0.3, maxTokens: 1200, json: true })
    const data = extractJson<StyleProfile>(res.content)
    return {
      tone: data.tone || '',
      pov: data.pov || '',
      sentence: data.sentence || '',
      dialogue: data.dialogue || '',
      pacing: data.pacing || '',
      taboos: Array.isArray(data.taboos) ? data.taboos : [],
      sample: data.sample || ''
    }
  } catch {
    return null
  }
}
