/**
 * 书籍铸造：一句话灵感 → 选题方案 → 设定库 → 分卷大纲 → 章节细纲
 */
import type { Book, ConceptOption, ConceptRequest, OutlineNode } from '@shared/types'
import { chat, extractJson } from '../llm/client'
import * as P from '../llm/prompts'
import { loadSettings } from '../settings'
import { bibleRepo, bookRepo, chapterRepo, foreshadowRepo, outlineRepo, countWords } from '../db/repo'
import { buildOutlineDigest } from '../memory/context'

/* ---------------------------- 选题 ---------------------------- */

export async function generateConcepts(req: ConceptRequest): Promise<ConceptOption[]> {
  const settings = loadSettings().model
  const existing = bookRepo.list().map((b) => b.title)
  const count = Math.max(1, Math.min(5, req.count || 3))
  const workType = req.workType || 'novel'
  const auto = req.auto === true || !req.idea?.trim()
  const data = await chatJsonWithRetry<{ options?: ConceptOption[] } | ConceptOption[]>(
    settings,
    [
      { role: 'system', content: P.conceptSystem(existing, workType) },
      {
        role: 'user',
        content: auto
          ? P.conceptAutoPrompt({
              workType,
              count,
              lengthHint: req.lengthHint,
              audience: req.audience,
              genre: req.genre
            })
          : P.conceptUserPrompt({ ...req, count })
      }
    ],
    { purpose: 'planner', maxTokens: 3000, temperature: auto ? 1.0 : 0.95 }
  )
  const options = (Array.isArray(data) ? data : data.options || []).filter((o) => o?.title)
  if (!options.length) throw new Error('未解析到有效的选题方案，请重试')
  return options.slice(0, count).map((o) => ({
    title: o.title,
    synopsis: o.synopsis || '',
    tags: Array.isArray(o.tags) ? o.tags : [],
    genre: o.genre || req.genre || '',
    hook: o.hook || '',
    protagonist: o.protagonist || '',
    goldenFinger: o.goldenFinger || '',
    sellingPoints: Array.isArray(o.sellingPoints) ? o.sellingPoints : [],
    openingScene: o.openingScene || '',
    structure: o.structure || ''
  }))
}

/* ---------------------------- 设定库 ---------------------------- */

interface RawBible {
  world?: string
  tone?: string
  powerSystem?: { name?: string; levels?: string[]; cost?: string; ceiling?: string }
  characters?: { name: string; role?: string; profile?: string; desire?: string; weakness?: string; speech?: string; relations?: string; state?: Record<string, unknown> }[]
  factions?: { name: string; profile?: string }[]
  locations?: { name: string; profile?: string }[]
  items?: { name: string; profile?: string }[]
  rules?: string[]
  foreshadowing?: { name: string; note?: string; plantAt?: number; resolveBy?: number }[]
}

/**
 * 结构化调用：模型偶发返回非 JSON（带解释文字、截断、Markdown）时自动重试。
 * 开书链路里每个环节都要 JSON，一次失败就中断会让用户反复重开书。
 */
async function chatJsonWithRetry<T>(
  settings: ReturnType<typeof loadSettings>['model'],
  messages: { role: 'system' | 'user'; content: string }[],
  opts: { purpose: 'planner' | 'writer' | 'summarizer' | 'judge'; maxTokens: number; temperature?: number },
  attempts = 3
): Promise<T> {
  let lastErr: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await chat(settings, messages, {
        purpose: opts.purpose,
        temperature: opts.temperature ?? 0.8,
        maxTokens: opts.maxTokens,
        json: true
      })
      return extractJson<T>(res.content)
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function generateBible(bookId: string): Promise<number> {
  const book = bookRepo.get(bookId)
  if (!book) throw new Error('书籍不存在')
  const settings = loadSettings().model
  const concept: ConceptOption = book.concept || {
    title: book.title,
    synopsis: book.synopsis,
    tags: book.tags,
    genre: book.genre,
    hook: '',
    protagonist: '',
    goldenFinger: '',
    sellingPoints: [],
    openingScene: ''
  }
  const b = await chatJsonWithRetry<RawBible>(
    settings,
    [
      { role: 'system', content: P.bibleSystem(book.workType) },
      { role: 'user', content: P.conceptToBiblePrompt(concept, book) }
    ],
    { purpose: 'planner', maxTokens: 8000 }
  )
  bibleRepo.clear(bookId)

  if (b.world) bibleRepo.upsert({ bookId, kind: 'world', name: '世界观', content: b.world, importance: 5, locked: true })
  if (b.tone) bibleRepo.upsert({ bookId, kind: 'world', name: '叙事基调', content: b.tone, importance: 4 })
  if (b.powerSystem) {
    const ps = b.powerSystem
    const content = [
      `体系：${ps.name || '未命名'}`,
      ps.levels?.length ? `等级阶梯：${ps.levels.join(' → ')}` : '',
      ps.cost ? `晋升代价：${ps.cost}` : '',
      ps.ceiling ? `力量上限：${ps.ceiling}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    bibleRepo.upsert({
      bookId,
      kind: 'power',
      name: ps.name || '力量体系',
      content,
      state: { levels: ps.levels || [] },
      importance: 5,
      locked: true
    })
  }
  for (const c of b.characters || []) {
    if (!c?.name) continue
    const content = [
      c.role ? `身份：${c.role}` : '',
      c.profile || '',
      c.desire ? `核心欲望：${c.desire}` : '',
      c.weakness ? `致命弱点：${c.weakness}` : '',
      c.speech ? `说话习惯：${c.speech}` : '',
      c.relations ? `人物关系：${c.relations}` : ''
    ]
      .filter(Boolean)
      .join('；')
    bibleRepo.upsert({
      bookId,
      kind: 'character',
      name: c.name,
      content,
      state: c.state || {},
      importance: /主角|女主|反派/.test(c.role || '') ? 5 : 3
    })
  }
  for (const f of b.factions || []) {
    if (f?.name) bibleRepo.upsert({ bookId, kind: 'faction', name: f.name, content: f.profile || '', importance: 3 })
  }
  for (const l of b.locations || []) {
    if (l?.name) bibleRepo.upsert({ bookId, kind: 'location', name: l.name, content: l.profile || '', importance: 2 })
  }
  for (const it of b.items || []) {
    if (it?.name) bibleRepo.upsert({ bookId, kind: 'item', name: it.name, content: it.profile || '', importance: 3 })
  }
  for (const [i, r] of (b.rules || []).entries()) {
    if (r?.trim()) bibleRepo.upsert({ bookId, kind: 'rule', name: `硬设定 ${i + 1}`, content: r, importance: 5, locked: true })
  }
  for (const f of b.foreshadowing || []) {
    if (f?.name) {
      foreshadowRepo.upsert({
        bookId,
        name: f.name,
        note: f.note || '',
        plantedChapterNo: f.plantAt ?? 1,
        resolveByChapterNo: f.resolveBy ?? 60
      })
    }
  }
  bookRepo.touch(bookId)
  return bibleRepo.list(bookId).length
}

/* ---------------------------- 分卷大纲 ---------------------------- */

interface RawVolumes {
  volumes?: { seq?: number; title: string; goal?: string; conflict?: string; antagonist?: string; climax?: string; endState?: string; chapterRange?: string }[]
}

export function parseChapterRange(range: string | undefined, fallbackStart: number, fallbackCount: number): { start: number; end: number } {
  const m = (range || '').match(/(\d+)\s*[-~—到]\s*(\d+)/)
  if (m) return { start: Number(m[1]), end: Number(m[2]) }
  return { start: fallbackStart, end: fallbackStart + fallbackCount - 1 }
}

export async function generateVolumeOutline(bookId: string): Promise<number> {
  const book = bookRepo.get(bookId)
  if (!book) throw new Error('书籍不存在')
  if (book.workType === 'short') throw new Error('短故事没有分卷大纲，请使用「故事结构」')
  const settings = loadSettings().model
  const bible = bibleRepo.list(bookId)
  const digest = bible
    .slice(0, 25)
    .map((b) => `【${b.kind}】${b.name}：${b.content.slice(0, 180)}`)
    .join('\n')
  const data = await chatJsonWithRetry<RawVolumes | NonNullable<RawVolumes['volumes']>>(
    settings,
    [
      { role: 'system', content: P.volumeOutlineSystem() },
      { role: 'user', content: P.volumeOutlinePrompt(book, digest) }
    ],
    { purpose: 'planner', maxTokens: 6000 }
  )
  const rawVolumes = Array.isArray(data) ? data : data.volumes || []
  const volumes = rawVolumes.filter((v) => v?.title)
  if (!volumes.length) throw new Error('未解析到分卷大纲')

  const perVolume = Math.max(20, Math.round(book.targetChapters / volumes.length))
  let cursor = 1
  const nodes = volumes.map((v, idx) => {
    const range = parseChapterRange(v.chapterRange, cursor, perVolume)
    cursor = range.end + 1
    return {
      seq: v.seq ?? idx + 1,
      parentSeq: 0,
      title: v.title,
      goal: [
        v.goal ? `目标：${v.goal}` : '',
        v.conflict ? `核心矛盾：${v.conflict}` : '',
        v.antagonist ? `主要对手：${v.antagonist}` : '',
        v.climax ? `卷末高潮：${v.climax}` : '',
        v.endState ? `卷末状态：${v.endState}` : '',
        `章节区间：${range.start}-${range.end}`
      ]
        .filter(Boolean)
        .join('\n'),
      beats: [String(range.start), String(range.end)],
      status: 'pending' as const
    }
  })
  outlineRepo.replaceLevel(bookId, 'volume', nodes)
  bookRepo.touch(bookId)
  return nodes.length
}

/** 查找某章所属卷号 */
export function volumeOfChapter(bookId: string, chapterNo: number): { volumeNo: number; node: OutlineNode | null } {
  const volumes = outlineRepo.volumes(bookId)
  for (const v of volumes) {
    const start = Number(v.beats[0] || 0)
    const end = Number(v.beats[1] || 0)
    if (chapterNo >= start && chapterNo <= end) return { volumeNo: v.seq, node: v }
  }
  if (volumes.length) {
    const last = volumes[volumes.length - 1]
    return { volumeNo: last.seq, node: last }
  }
  return { volumeNo: 1, node: null }
}

/* ---------------------------- 短故事结构 ---------------------------- */

interface RawShortStructure {
  logline?: string
  theme?: string
  pov?: string
  setting?: string
  twist?: string
  ending?: string
  beats?: { name?: string; summary?: string }[]
}

/**
 * 为短故事生成 7 拍结构，并准备好唯一的「全文」章节记录。
 * 与长篇小说不同：不拆卷、不生成多章细纲。
 */
export async function generateShortStructure(bookId: string): Promise<OutlineNode | null> {
  const book = bookRepo.get(bookId)
  if (!book) throw new Error('书籍不存在')
  if (book.workType !== 'short') throw new Error('该作品不是短故事')

  const settings = loadSettings().model
  const bible = bibleRepo.list(bookId)
  const digest = bible
    .slice(0, 15)
    .map((b) => `【${b.kind}】${b.name}：${b.content.slice(0, 160)}`)
    .join('\n')
  const c = book.concept
  const conceptText = c
    ? [
        c.hook ? `开篇钩子：${c.hook}` : '',
        c.protagonist ? `主角：${c.protagonist}` : '',
        c.sellingPoints?.length ? `看点：${c.sellingPoints.join('；')}` : '',
        c.openingScene ? `开场：${c.openingScene}` : '',
        c.structure ? `方案结构：${c.structure}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  const s = await chatJsonWithRetry<RawShortStructure>(
    settings,
    [
      { role: 'system', content: P.shortStructureSystem() },
      { role: 'user', content: P.shortStructurePrompt(book, digest, conceptText) }
    ],
    { purpose: 'planner', maxTokens: 2500 }
  )
  const beats = (s.beats || [])
    .filter((b) => b?.summary)
    .map((b) => `${b.name ? `${b.name}：` : ''}${b.summary}`)
  const goal = [
    s.logline ? `故事线：${s.logline}` : '',
    s.theme ? `主题：${s.theme}` : '',
    s.pov ? `视角：${s.pov}` : '',
    s.setting ? `场景：${s.setting}` : '',
    s.twist ? `中点反转：${s.twist}` : '',
    s.ending ? `结局落点：${s.ending}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  outlineRepo.upsertChapter({
    bookId,
    seq: 1,
    parentSeq: 1,
    title: '全文',
    goal,
    beats,
    status: 'pending'
  })

  const existed = chapterRepo.getByNo(bookId, 1)
  chapterRepo.upsert({
    bookId,
    chapterNo: 1,
    volumeNo: 1,
    title: existed?.title || book.title,
    outline: [goal, ...beats.map((b, i) => `${i + 1}. ${b}`)].filter(Boolean).join('\n'),
    status: existed?.content ? existed.status : 'planned'
  })
  bookRepo.touch(bookId)

  return {
    id: '',
    bookId,
    level: 'chapter',
    seq: 1,
    parentSeq: 1,
    title: '全文',
    goal,
    beats,
    status: 'pending'
  }
}

/* ---------------------------- 章节细纲 ---------------------------- */

interface RawChapterOutlines {
  chapters?: { chapterNo?: number; title: string; goal?: string; beats?: string[]; foreshadowPlant?: string; foreshadowResolve?: string; hook?: string }[]
}

/**
 * 兜底细纲：模型没给出合法 JSON、或空白创建的书还没有大纲时使用。
 * 目的是让写作不因为「缺细纲」直接卡死——先能写，细纲后补。
 */
type RawChapterOutlineItem = NonNullable<RawChapterOutlines['chapters']>[number]
function buildFallbackOutline(book: Book, fromChapter: number, count: number): RawChapterOutlineItem[] {
  const concept = book.concept
  const goal = concept?.hook || book.synopsis || `${book.genre || '故事'}的主线推进`
  const beats = [
    `开场：把主角放进一个具体的麻烦里（${goal.slice(0, 40)}）`,
    '升级：麻烦变大，代价变高，主角必须做选择',
    '转折：出现新信息，主角的判断被推翻',
    '收束：主角做出决定，留下一个钩子'
  ]
  const out: RawChapterOutlineItem[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      chapterNo: fromChapter + i,
      title: `第${fromChapter + i}章`,
      goal: `${goal.slice(0, 60)}（第 ${fromChapter + i} 章推进）`,
      beats,
      foreshadowPlant: '',
      foreshadowResolve: '',
      hook: '留下一个未解决的悬念'
    })
  }
  return out
}

export async function generateChapterOutlines(bookId: string, fromChapter: number, count: number): Promise<OutlineNode[]> {
  const book = bookRepo.get(bookId)
  if (!book) throw new Error('书籍不存在')
  if (book.workType === 'short') {
    await generateShortStructure(bookId)
    return []
  }
  const settings = loadSettings().model
  const { volumeNo, node } = volumeOfChapter(bookId, fromChapter)
  const digest = buildOutlineDigest(book, fromChapter - 1)
  const openFs = foreshadowRepo.open(bookId).map((f) => f.name)

  const data = await chatJsonWithRetry<RawChapterOutlines | NonNullable<RawChapterOutlines['chapters']>>(
    settings,
    [
      { role: 'system', content: P.chapterOutlineSystem() },
      {
        role: 'user',
        content: P.chapterOutlinePrompt({
          book,
          volumeTitle: node?.title || `第${volumeNo}卷`,
          volumeGoal: node?.goal || '',
          fromChapter,
          count,
          contextDigest: digest,
          openForeshadowing: openFs
        })
      }
    ],
    { purpose: 'planner', maxTokens: 6000 }
  )
  let list: RawChapterOutlineItem[] = (Array.isArray(data) ? data : data.chapters || []).filter((c) => c?.title) as RawChapterOutlineItem[]
  if (!list.length) {
    console.warn('[forge] 使用兜底细纲', book.title, fromChapter)
    list = buildFallbackOutline(book, fromChapter, count)
  }

  const saved: OutlineNode[] = []
  list.forEach((c, idx) => {
    // 序号以请求的起始章为准，避免模型自行从 1 编号导致覆盖旧细纲
    const no = fromChapter + idx
    const beats = Array.isArray(c.beats) ? c.beats : []
    const goal = [
      c.goal ? `本章目标：${c.goal}` : '',
      c.hook ? `结尾钩子：${c.hook}` : '',
      c.foreshadowPlant ? `埋下伏笔：${c.foreshadowPlant}` : '',
      c.foreshadowResolve ? `回收伏笔：${c.foreshadowResolve}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    outlineRepo.upsertChapter({
      bookId,
      seq: no,
      parentSeq: volumeNo,
      title: c.title,
      goal,
      beats,
      status: 'pending'
    })
    saved.push({ id: '', bookId, level: 'chapter', seq: no, parentSeq: volumeNo, title: c.title, goal, beats, status: 'pending' })
  })
  bookRepo.touch(bookId)
  return saved
}

/* ---------------------------- 章节标题 ---------------------------- */

export function fallbackChapterTitle(chapterNo: number): string {
  return `第${chapterNo}章`
}

export function ensureChapterTitle(bookId: string, chapterNo: number): string {
  const outline = outlineRepo.chapters(bookId).find((c) => c.seq === chapterNo)
  if (outline?.title) return outline.title
  const chapter = chapterRepo.getByNo(bookId, chapterNo)
  if (chapter?.title && chapter.title !== `第${chapterNo}章`) return chapter.title
  return fallbackChapterTitle(chapterNo)
}

export function bookWordCount(bookId: string): number {
  return chapterRepo.totalWords(bookId)
}

export { countWords }
