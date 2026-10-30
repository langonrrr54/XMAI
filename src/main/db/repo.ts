/**
 * 数据仓库层：所有表的结构化读写集中在此，返回驼峰命名的领域对象。
 */
import type {
  BibleEntry,
  BibleKind,
  Book,
  CapturedRequest,
  Chapter,
  ChapterStatus,
  ConceptOption,
  Foreshadowing,
  ModelSettings,
  OutlineNode,
  ProviderInput,
  ProviderProfile,
  PublishJob,
  StyleProfile,
  VolumeSummary,
  WorkType
} from '@shared/types'
import { decryptSecret, encryptSecret } from '../secrets'
import { allRaw, getRaw, newId, runRaw } from './database'

/* ----------------------------- 工具 ----------------------------- */

const now = (): number => Date.now()

function j<T>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback
  try {
    return JSON.parse(String(v)) as T
  } catch {
    return fallback
  }
}

export function countWords(text: string): number {
  if (!text) return 0
  const stripped = text.replace(/\s+/g, '')
  return stripped.length
}

/* ----------------------------- 书籍 ----------------------------- */

interface BookRow {
  id: string
  title: string
  subtitle: string
  synopsis: string
  tags: string
  genre: string
  cover_path: string
  status: string
  work_type: string
  target_chapters: number
  words_per_chapter: number
  style_profile: string | null
  concept: string | null
  fanqie_tags: string
  created_at: number
  updated_at: number
}

function mapBook(r: BookRow): Book {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    synopsis: r.synopsis,
    tags: j<string[]>(r.tags, []),
    genre: r.genre,
    coverPath: r.cover_path,
    status: r.status as Book['status'],
    workType: (r.work_type === 'short' ? 'short' : 'novel') as WorkType,
    targetChapters: r.target_chapters,
    wordsPerChapter: r.words_per_chapter,
    styleProfile: j<StyleProfile | null>(r.style_profile, null),
    concept: j<ConceptOption | null>(r.concept, null),
    fanqieTags: r.fanqie_tags ? j<Book['fanqieTags']>(r.fanqie_tags, null) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export const bookRepo = {
  list(): Book[] {
    return allRaw<BookRow>('SELECT * FROM books ORDER BY updated_at DESC').map(mapBook)
  },
  get(id: string): Book | null {
    const r = getRaw<BookRow>('SELECT * FROM books WHERE id = ?', [id])
    return r ? mapBook(r) : null
  },
  create(input: Partial<Book> & { title: string }): Book {
    const t = now()
    const book: Book = {
      id: input.id || newId('bk_'),
      title: input.title,
      subtitle: input.subtitle || '',
      synopsis: input.synopsis || '',
      tags: input.tags || [],
      genre: input.genre || '',
      coverPath: input.coverPath || '',
      status: input.status || 'planning',
      workType: input.workType || 'novel',
      targetChapters: input.targetChapters || 500,
      wordsPerChapter: input.wordsPerChapter || 2200,
      styleProfile: input.styleProfile || null,
      concept: input.concept || null,
      fanqieTags: input.fanqieTags || null,
      createdAt: t,
      updatedAt: t
    }
    runRaw(
      `INSERT INTO books(id,title,subtitle,synopsis,tags,genre,cover_path,status,work_type,target_chapters,words_per_chapter,style_profile,concept,fanqie_tags,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        book.id,
        book.title,
        book.subtitle,
        book.synopsis,
        JSON.stringify(book.tags),
        book.genre,
        book.coverPath,
        book.status,
        book.workType,
        book.targetChapters,
        book.wordsPerChapter,
        book.styleProfile ? JSON.stringify(book.styleProfile) : null,
        book.concept ? JSON.stringify(book.concept) : null,
        JSON.stringify(book.fanqieTags || {}),
        t,
        t
      ]
    )
    return book
  },
  update(id: string, patch: Partial<Book>): void {
    const current = bookRepo.get(id)
    if (!current) throw new Error('书籍不存在')
    const next = { ...current, ...patch, id, updatedAt: now() }
    runRaw(
      `UPDATE books SET title=?,subtitle=?,synopsis=?,tags=?,genre=?,cover_path=?,status=?,work_type=?,target_chapters=?,words_per_chapter=?,style_profile=?,concept=?,fanqie_tags=?,updated_at=? WHERE id=?`,
      [
        next.title,
        next.subtitle,
        next.synopsis,
        JSON.stringify(next.tags),
        next.genre,
        next.coverPath,
        next.status,
        next.workType,
        next.targetChapters,
        next.wordsPerChapter,
        next.styleProfile ? JSON.stringify(next.styleProfile) : null,
        next.concept ? JSON.stringify(next.concept) : null,
        JSON.stringify(next.fanqieTags || {}),
        next.updatedAt,
        id
      ]
    )
  },
  touch(id: string): void {
    runRaw('UPDATE books SET updated_at=? WHERE id=?', [now(), id])
  },
  remove(id: string): void {
    for (const table of [
      'chapters',
      'bible_entries',
      'outline_nodes',
      'foreshadowing',
      'volume_summaries',
      'embeddings',
      'memories',
      'publish_jobs'
    ]) {
      runRaw(`DELETE FROM ${table} WHERE book_id = ?`, [id])
    }
    runRaw('DELETE FROM books WHERE id = ?', [id])
  }
}

/* ----------------------------- 章节 ----------------------------- */

interface ChapterRow {
  id: string
  book_id: string
  volume_no: number
  chapter_no: number
  title: string
  outline: string
  content: string
  status: string
  word_count: number
  summary: string
  key_events: string
  search_terms: string
  deai_done_at: number
  created_at: number
  updated_at: number
}

function mapChapter(r: ChapterRow): Chapter {
  return {
    id: r.id,
    bookId: r.book_id,
    volumeNo: r.volume_no,
    chapterNo: r.chapter_no,
    title: r.title,
    outline: r.outline,
    content: r.content,
    status: r.status as ChapterStatus,
    wordCount: r.word_count,
    summary: r.summary,
    keyEvents: j<string[]>(r.key_events, []),
    searchTerms: j<string[]>(r.search_terms || '[]', []),
    deaiDoneAt: Number(r.deai_done_at || 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export const chapterRepo = {
  list(bookId: string, withContent = false): Chapter[] {
    const cols = withContent ? '*' : 'id,book_id,volume_no,chapter_no,title,outline,status,word_count,summary,key_events,search_terms,deai_done_at,created_at,updated_at'
    const rows = allRaw<ChapterRow>(`SELECT ${cols} FROM chapters WHERE book_id=? ORDER BY chapter_no ASC`, [bookId])
    return rows.map((r) => mapChapter({ ...r, content: r.content ?? '' }))
  },
  /** 摘要用：按章号窗口取 */
  ranges(bookId: string, fromNo: number, toNo: number): Chapter[] {
    return allRaw<ChapterRow>(
      'SELECT * FROM chapters WHERE book_id=? AND chapter_no>=? AND chapter_no<=? ORDER BY chapter_no ASC',
      [bookId, fromNo, toNo]
    ).map(mapChapter)
  },
  get(id: string): Chapter | null {
    const r = getRaw<ChapterRow>('SELECT * FROM chapters WHERE id=?', [id])
    return r ? mapChapter(r) : null
  },
  getByNo(bookId: string, chapterNo: number): Chapter | null {
    const r = getRaw<ChapterRow>('SELECT * FROM chapters WHERE book_id=? AND chapter_no=?', [bookId, chapterNo])
    return r ? mapChapter(r) : null
  },
  last(bookId: string): Chapter | null {
    const r = getRaw<ChapterRow>('SELECT * FROM chapters WHERE book_id=? ORDER BY chapter_no DESC LIMIT 1', [bookId])
    return r ? mapChapter(r) : null
  },
  /** 最后一章已完成的正文（跳过流式中断留下的 planned 草稿） */
  lastCompleted(bookId: string): Chapter | null {
    const r = getRaw<ChapterRow>(
      `SELECT * FROM chapters WHERE book_id=? AND status IN ('drafted','reviewed','published') AND content <> '' ORDER BY chapter_no DESC LIMIT 1`,
      [bookId]
    )
    return r ? mapChapter(r) : null
  },
  count(bookId: string): number {
    return Number(getRaw<{ c: number }>('SELECT COUNT(*) AS c FROM chapters WHERE book_id=?', [bookId])?.c || 0)
  },
  upsert(input: {
    id?: string
    bookId: string
    volumeNo?: number
    chapterNo: number
    title?: string
    outline?: string
    content?: string
    status?: ChapterStatus
    summary?: string
    keyEvents?: string[]
    searchTerms?: string[]
  }): Chapter {
    const existed = chapterRepo.getByNo(input.bookId, input.chapterNo)
    const t = now()
    const content = input.content ?? existed?.content ?? ''
    if (existed) {
      runRaw(
        `UPDATE chapters SET volume_no=?, title=?, outline=?, content=?, status=?, word_count=?, summary=?, key_events=?, search_terms=?, updated_at=? WHERE id=?`,
        [
          input.volumeNo ?? existed.volumeNo,
          input.title ?? existed.title,
          input.outline ?? existed.outline,
          content,
          input.status ?? existed.status,
          countWords(content),
          input.summary ?? existed.summary,
          JSON.stringify(input.keyEvents ?? existed.keyEvents),
          JSON.stringify(input.searchTerms ?? existed.searchTerms ?? []),
          t,
          existed.id
        ]
      )
      return chapterRepo.get(existed.id)!
    }
    const id = input.id || newId('ch_')
    runRaw(
      `INSERT INTO chapters(id,book_id,volume_no,chapter_no,title,outline,content,status,word_count,summary,key_events,search_terms,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.bookId,
        input.volumeNo ?? 1,
        input.chapterNo,
        input.title || `第${input.chapterNo}章`,
        input.outline || '',
        content,
        input.status || 'planned',
        countWords(content),
        input.summary || '',
        JSON.stringify(input.keyEvents || []),
        JSON.stringify(input.searchTerms || []),
        t,
        t
      ]
    )
    return chapterRepo.get(id)!
  },
  update(id: string, patch: Partial<Chapter>): void {
    const cur = chapterRepo.get(id)
    if (!cur) throw new Error('章节不存在')
    const next = { ...cur, ...patch }
    runRaw(
      `UPDATE chapters SET volume_no=?, title=?, outline=?, content=?, status=?, word_count=?, summary=?, key_events=?, search_terms=?, updated_at=? WHERE id=?`,
      [
        next.volumeNo,
        next.title,
        next.outline,
        next.content,
        next.status,
        countWords(next.content),
        next.summary,
        JSON.stringify(next.keyEvents),
        JSON.stringify(next.searchTerms || []),
        now(),
        id
      ]
    )
  },
  remove(id: string): void {
    runRaw('DELETE FROM chapters WHERE id=?', [id])
  },
  removeFrom(bookId: string, chapterNo: number): void {
    runRaw('DELETE FROM chapters WHERE book_id=? AND chapter_no>=?', [bookId, chapterNo])
  },
  totalWords(bookId: string): number {
    return Number(getRaw<{ w: number }>('SELECT COALESCE(SUM(word_count),0) AS w FROM chapters WHERE book_id=?', [bookId])?.w || 0)
  }
}

/* ----------------------------- 去AI味记录 ----------------------------- */

export const deaiRepo = {
  /** 标记该章已完成去AI味（批量时据此跳过） */
  mark(bookId: string, chapterId: string): void {
    runRaw('UPDATE chapters SET deai_done_at=? WHERE id=?', [now(), chapterId])
  },

  /** 清掉标记（重写正文后调用，让它重新进入批量范围） */
  unmark(chapterId: string): void {
    runRaw('UPDATE chapters SET deai_done_at=0 WHERE id=?', [chapterId])
  },

  /** 保存去AI味前的原稿，便于回滚 */
  backup(input: { bookId: string; chapterId: string; chapterNo: number; content: string }): void {
    runRaw('DELETE FROM deai_backups WHERE chapter_id=?', [input.chapterId])
    runRaw(
      'INSERT INTO deai_backups(id,book_id,chapter_id,chapter_no,content,created_at) VALUES(?,?,?,?,?,?)',
      [newId('db_'), input.bookId, input.chapterId, input.chapterNo, input.content, now()]
    )
  },

  /** 取最近一次备份（用于回滚） */
  getBackup(chapterId: string): { content: string; createdAt: number } | null {
    const r = getRaw<{ content: string; created_at: number }>(
      'SELECT content, created_at FROM deai_backups WHERE chapter_id=? ORDER BY created_at DESC LIMIT 1',
      [chapterId]
    )
    return r ? { content: r.content, createdAt: r.created_at } : null
  },

  /** 该章是否已处理过 */
  isDone(chapterId: string): boolean {
    const r = getRaw<{ d: number }>('SELECT deai_done_at AS d FROM chapters WHERE id=?', [chapterId])
    return Number(r?.d || 0) > 0
  },

  /** 列出本书里还没去AI味、且有正文的章节 */
  pendingChapters(bookId: string): { id: string; chapterNo: number; title: string }[] {
    return allRaw<{ id: string; chapter_no: number; title: string }>(
      "SELECT id, chapter_no, title FROM chapters WHERE book_id=? AND deai_done_at=0 AND content <> '' AND status <> 'planned' ORDER BY chapter_no ASC",
      [bookId]
    ).map((r) => ({ id: r.id, chapterNo: r.chapter_no, title: r.title }))
  }
}

/* ----------------------------- 设定库 ----------------------------- */

interface BibleRow {
  id: string
  book_id: string
  kind: string
  name: string
  content: string
  state: string
  importance: number
  locked: number
  updated_at: number
  last_chapter_no: number
}

function mapBible(r: BibleRow): BibleEntry {
  return {
    id: r.id,
    bookId: r.book_id,
    kind: r.kind as BibleKind,
    name: r.name,
    content: r.content,
    state: j<Record<string, unknown>>(r.state, {}),
    importance: r.importance,
    locked: r.locked === 1,
    updatedAt: r.updated_at,
    lastChapterNo: r.last_chapter_no
  }
}

export const bibleRepo = {
  list(bookId: string): BibleEntry[] {
    return allRaw<BibleRow>(
      'SELECT * FROM bible_entries WHERE book_id=? ORDER BY importance DESC, kind ASC, name ASC',
      [bookId]
    ).map(mapBible)
  },
  byKind(bookId: string, kind: BibleKind): BibleEntry[] {
    return allRaw<BibleRow>('SELECT * FROM bible_entries WHERE book_id=? AND kind=? ORDER BY importance DESC', [
      bookId,
      kind
    ]).map(mapBible)
  },
  getByName(bookId: string, name: string): BibleEntry | null {
    const r = getRaw<BibleRow>('SELECT * FROM bible_entries WHERE book_id=? AND name=? LIMIT 1', [bookId, name])
    return r ? mapBible(r) : null
  },
  upsert(input: {
    id?: string
    bookId: string
    kind: BibleKind
    name: string
    content: string
    state?: Record<string, unknown>
    importance?: number
    locked?: boolean
    lastChapterNo?: number
  }): string {
    const existed = input.id
      ? getRaw<BibleRow>('SELECT * FROM bible_entries WHERE id=?', [input.id])
      : getRaw<BibleRow>('SELECT * FROM bible_entries WHERE book_id=? AND name=? AND kind=? LIMIT 1', [
          input.bookId,
          input.name,
          input.kind
        ])
    const t = now()
    if (existed) {
      const mergedState = { ...j<Record<string, unknown>>(existed.state, {}), ...(input.state || {}) }
      runRaw(
        `UPDATE bible_entries SET kind=?, name=?, content=?, state=?, importance=?, locked=?, updated_at=?, last_chapter_no=? WHERE id=?`,
        [
          input.kind,
          input.name,
          input.content ?? existed.content,
          JSON.stringify(mergedState),
          input.importance ?? existed.importance,
          (input.locked ?? existed.locked === 1) ? 1 : 0,
          t,
          input.lastChapterNo ?? existed.last_chapter_no,
          existed.id
        ]
      )
      return existed.id
    }
    const id = input.id || newId('bb_')
    runRaw(
      `INSERT INTO bible_entries(id,book_id,kind,name,content,state,importance,locked,updated_at,last_chapter_no)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.bookId,
        input.kind,
        input.name,
        input.content,
        JSON.stringify(input.state || {}),
        input.importance ?? 3,
        input.locked ? 1 : 0,
        t,
        input.lastChapterNo ?? 0
      ]
    )
    return id
  },
  remove(id: string): void {
    runRaw('DELETE FROM bible_entries WHERE id=?', [id])
  },
  clear(bookId: string): void {
    runRaw('DELETE FROM bible_entries WHERE book_id=?', [bookId])
  }
}

/* ----------------------------- 大纲 ----------------------------- */

interface OutlineRow {
  id: string
  book_id: string
  level: string
  seq: number
  parent_seq: number
  title: string
  goal: string
  beats: string
  status: string
}

function mapOutline(r: OutlineRow): OutlineNode {
  return {
    id: r.id,
    bookId: r.book_id,
    level: r.level as OutlineNode['level'],
    seq: r.seq,
    parentSeq: r.parent_seq,
    title: r.title,
    goal: r.goal,
    beats: j<string[]>(r.beats, []),
    status: r.status as OutlineNode['status']
  }
}

export const outlineRepo = {
  list(bookId: string): OutlineNode[] {
    return allRaw<OutlineRow>('SELECT * FROM outline_nodes WHERE book_id=? ORDER BY level DESC, seq ASC', [
      bookId
    ]).map(mapOutline)
  },
  volumes(bookId: string): OutlineNode[] {
    return allRaw<OutlineRow>("SELECT * FROM outline_nodes WHERE book_id=? AND level='volume' ORDER BY seq ASC", [
      bookId
    ]).map(mapOutline)
  },
  chapters(bookId: string): OutlineNode[] {
    return allRaw<OutlineRow>("SELECT * FROM outline_nodes WHERE book_id=? AND level='chapter' ORDER BY seq ASC", [
      bookId
    ]).map(mapOutline)
  },
  replaceLevel(bookId: string, level: OutlineNode['level'], nodes: Omit<OutlineNode, 'id' | 'bookId' | 'level'>[]): void {
    runRaw('DELETE FROM outline_nodes WHERE book_id=? AND level=?', [bookId, level])
    for (const n of nodes) {
      runRaw(
        'INSERT INTO outline_nodes(id,book_id,level,seq,parent_seq,title,goal,beats,status) VALUES(?,?,?,?,?,?,?,?,?)',
        [newId('ol_'), bookId, level, n.seq, n.parentSeq ?? 0, n.title, n.goal, JSON.stringify(n.beats || []), n.status || 'pending']
      )
    }
  },
  upsertChapter(n: Omit<OutlineNode, 'id' | 'bookId' | 'level'> & { bookId: string }): void {
    const existed = getRaw<OutlineRow>(
      "SELECT * FROM outline_nodes WHERE book_id=? AND level='chapter' AND seq=?",
      [n.bookId, n.seq]
    )
    if (existed) {
      runRaw('UPDATE outline_nodes SET parent_seq=?, title=?, goal=?, beats=?, status=? WHERE id=?', [
        n.parentSeq ?? existed.parent_seq,
        n.title,
        n.goal,
        JSON.stringify(n.beats || []),
        n.status || existed.status,
        existed.id
      ])
    } else {
      runRaw(
        'INSERT INTO outline_nodes(id,book_id,level,seq,parent_seq,title,goal,beats,status) VALUES(?,?,?,?,?,?,?,?,?)',
        [newId('ol_'), n.bookId, 'chapter', n.seq, n.parentSeq ?? 0, n.title, n.goal, JSON.stringify(n.beats || []), n.status || 'pending']
      )
    }
  },
  setStatus(bookId: string, level: OutlineNode['level'], seq: number, status: OutlineNode['status']): void {
    runRaw('UPDATE outline_nodes SET status=? WHERE book_id=? AND level=? AND seq=?', [status, bookId, level, seq])
  }
}

/* ----------------------------- 伏笔台账 ----------------------------- */

interface FsRow {
  id: string
  book_id: string
  name: string
  note: string
  planted_chapter_no: number
  resolve_by_chapter_no: number
  status: string
  updated_at: number
}

function mapFs(r: FsRow): Foreshadowing {
  return {
    id: r.id,
    bookId: r.book_id,
    name: r.name,
    note: r.note,
    plantedChapterNo: r.planted_chapter_no,
    resolveByChapterNo: r.resolve_by_chapter_no,
    status: r.status as Foreshadowing['status'],
    updatedAt: r.updated_at
  }
}

export const foreshadowRepo = {
  list(bookId: string): Foreshadowing[] {
    return allRaw<FsRow>('SELECT * FROM foreshadowing WHERE book_id=? ORDER BY planted_chapter_no ASC', [bookId]).map(mapFs)
  },
  open(bookId: string): Foreshadowing[] {
    return allRaw<FsRow>("SELECT * FROM foreshadowing WHERE book_id=? AND status='open' ORDER BY resolve_by_chapter_no ASC", [
      bookId
    ]).map(mapFs)
  },
  upsert(input: {
    id?: string
    bookId: string
    name: string
    note?: string
    plantedChapterNo?: number
    resolveByChapterNo?: number
    status?: Foreshadowing['status']
  }): string {
    const existed = input.id
      ? getRaw<FsRow>('SELECT * FROM foreshadowing WHERE id=?', [input.id])
      : getRaw<FsRow>('SELECT * FROM foreshadowing WHERE book_id=? AND name=? LIMIT 1', [input.bookId, input.name])
    if (existed) {
      runRaw(
        'UPDATE foreshadowing SET name=?, note=?, planted_chapter_no=?, resolve_by_chapter_no=?, status=?, updated_at=? WHERE id=?',
        [
          input.name,
          input.note ?? existed.note,
          input.plantedChapterNo ?? existed.planted_chapter_no,
          input.resolveByChapterNo ?? existed.resolve_by_chapter_no,
          input.status ?? existed.status,
          now(),
          existed.id
        ]
      )
      return existed.id
    }
    const id = input.id || newId('fs_')
    runRaw(
      'INSERT INTO foreshadowing(id,book_id,name,note,planted_chapter_no,resolve_by_chapter_no,status,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      [
        id,
        input.bookId,
        input.name,
        input.note || '',
        input.plantedChapterNo ?? 0,
        input.resolveByChapterNo ?? 0,
        input.status || 'open',
        now()
      ]
    )
    return id
  },
  resolve(bookId: string, name: string): void {
    runRaw("UPDATE foreshadowing SET status='resolved', updated_at=? WHERE book_id=? AND name=?", [now(), bookId, name])
  },
  remove(id: string): void {
    runRaw('DELETE FROM foreshadowing WHERE id=?', [id])
  }
}

/* ----------------------------- 卷摘要 ----------------------------- */

export const volumeSummaryRepo = {
  list(bookId: string): VolumeSummary[] {
    return allRaw<{ volume_no: number; content: string; updated_at: number }>(
      'SELECT * FROM volume_summaries WHERE book_id=? ORDER BY volume_no ASC',
      [bookId]
    ).map((r) => ({ volumeNo: r.volume_no, content: r.content, updatedAt: r.updated_at }))
  },
  put(bookId: string, volumeNo: number, content: string): void {
    runRaw(
      'INSERT INTO volume_summaries(book_id,volume_no,content,updated_at) VALUES(?,?,?,?) ON CONFLICT(book_id,volume_no) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at',
      [bookId, volumeNo, content, now()]
    )
  }
}

/* ----------------------------- 向量 ----------------------------- */

export interface EmbeddingRow {
  id: string
  refType: string
  refId: string
  chunkIndex: number
  text: string
  vec: Float32Array
  dim: number
}

export const embeddingRepo = {
  insertMany(
    bookId: string,
    items: { refType: string; refId: string; chunkIndex: number; text: string; vec: Float32Array }[]
  ): void {
    for (const it of items) {
      const buf = Buffer.from(it.vec.buffer, it.vec.byteOffset, it.vec.byteLength)
      runRaw(
        'INSERT INTO embeddings(id,book_id,ref_type,ref_id,chunk_index,text,vec,dim,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        [newId('em_'), bookId, it.refType, it.refId, it.chunkIndex, it.text, new Uint8Array(buf), it.vec.length, now()]
      )
    }
  },
  list(bookId: string): EmbeddingRow[] {
    return allRaw<{
      id: string
      ref_type: string
      ref_id: string
      chunk_index: number
      text: string
      vec: Uint8Array
      dim: number
    }>('SELECT * FROM embeddings WHERE book_id=?', [bookId]).map((r) => ({
      id: r.id,
      refType: r.ref_type,
      refId: r.ref_id,
      chunkIndex: r.chunk_index,
      text: r.text,
      vec: new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength)),
      dim: r.dim
    }))
  },
  count(bookId: string): number {
    return Number(getRaw<{ c: number }>('SELECT COUNT(*) AS c FROM embeddings WHERE book_id=?', [bookId])?.c || 0)
  },
  deleteByRef(bookId: string, refType: string, refId: string): void {
    runRaw('DELETE FROM embeddings WHERE book_id=? AND ref_type=? AND ref_id=?', [bookId, refType, refId])
  },
  clear(bookId: string): void {
    runRaw('DELETE FROM embeddings WHERE book_id=?', [bookId])
  }
}

/* ----------------------------- 长期记忆 ----------------------------- */

export const memoryRepo = {
  list(bookId: string): { id: string; kind: string; content: string; importance: number; createdAt: number }[] {
    return allRaw<{ id: string; kind: string; content: string; importance: number; created_at: number }>(
      'SELECT * FROM memories WHERE book_id=? ORDER BY importance DESC, created_at DESC',
      [bookId]
    ).map((r) => ({ id: r.id, kind: r.kind, content: r.content, importance: r.importance, createdAt: r.created_at }))
  },
  add(bookId: string, kind: string, content: string, importance = 3): void {
    runRaw('INSERT INTO memories(id,book_id,kind,content,importance,created_at) VALUES(?,?,?,?,?,?)', [
      newId('mm_'),
      bookId,
      kind,
      content,
      importance,
      now()
    ])
  },
  remove(id: string): void {
    runRaw('DELETE FROM memories WHERE id=?', [id])
  },

  /**
   * 取「既定事实」用于写作上下文。
   * 旧逻辑用 importance DESC 取前 24 条，但事实的 importance 都相同，
   * 等于只拿最新的 24 条 —— 第 50 章埋的关键事实会被第 200 章的新事实挤掉。
   * 这里改成「保留每条事实，但同一条内容不重复」，并按最近出现排序。
   */
  facts(bookId: string, limit = 40): { content: string; createdAt: number }[] {
    const rows = allRaw<{ content: string; created_at: number }>(
      "SELECT content, MAX(created_at) AS created_at FROM memories WHERE book_id=? AND kind='fact' GROUP BY content ORDER BY created_at DESC LIMIT ?",
      [bookId, limit]
    )
    return rows.map((r) => ({ content: r.content, createdAt: r.created_at }))
  },

  /**
   * 挑「既定事实」进上下文。
   * 长篇写久了会有上千条事实，只取最新会把早期的世界基石挤掉。
   * 策略：一半给「和本章相关」的，一半留给「最早出现」的（早期通常是世界观/身份设定）。
   */
  factsRelevant(bookId: string, query: string, limit = 40): { content: string; createdAt: number }[] {
    const rows = allRaw<{ content: string; created_at: number }>(
      "SELECT content, MIN(created_at) AS created_at FROM memories WHERE book_id=? AND kind='fact' GROUP BY content ORDER BY created_at ASC",
      [bookId]
    ).map((r) => ({ content: r.content, createdAt: r.created_at }))
    if (!rows.length) return []

    const terms = Array.from(new Set((query.match(/[\u4e00-\u9fff]{2,4}/g) || []).filter((w) => w.length >= 2)))
    const half = Math.max(4, Math.floor(limit / 2))

    // 一半：和本章相关的（命中查询关键词多的优先）
    const relevant = terms.length
      ? rows
          .map((r) => {
            let hits = 0
            for (const term of terms) if (r.content.includes(term)) hits++
            return { ...r, hits }
          })
          .filter((r) => r.hits > 0)
          .sort((a, b) => b.hits - a.hits)
          .slice(0, half)
          .map((r) => ({ content: r.content, createdAt: r.createdAt }))
      : []

    // 另一半：最早出现的事实（世界观、主角身份等基石）
    const foundational = rows.slice(0, half)

    const merged: { content: string; createdAt: number }[] = []
    const seen = new Set<string>()
    for (const r of [...foundational, ...relevant]) {
      if (seen.has(r.content)) continue
      seen.add(r.content)
      merged.push(r)
    }
    // 还空着就用最新的补满
    if (merged.length < limit) {
      const latest = [...rows].reverse()
      for (const r of latest) {
        if (merged.length >= limit) break
        if (seen.has(r.content)) continue
        seen.add(r.content)
        merged.push(r)
      }
    }
    return merged.slice(0, limit)
  },

  /** 事实总数（用于容量提示） */
  factCount(bookId: string): number {
    return Number(
      getRaw<{ c: number }>("SELECT COUNT(*) AS c FROM memories WHERE book_id=? AND kind='fact'", [bookId])?.c || 0
    )
  },

  /** 清理重复事实（同一内容只保留一条） */
  dedupeFacts(bookId: string): number {
    const before = memoryRepo.factCount(bookId)
    runRaw(
      "DELETE FROM memories WHERE book_id=? AND kind='fact' AND id NOT IN (SELECT MIN(id) FROM memories WHERE book_id=? AND kind='fact' GROUP BY content)",
      [bookId, bookId]
    )
    return before - memoryRepo.factCount(bookId)
  }
}

/* ----------------------------- 发布 ----------------------------- */

export const publishRepo = {
  get(id: string): PublishJob | null {
    const r = getRaw<{
      id: string
      book_id: string
      chapter_id: string
      platform: string
      status: string
      payload: string
      result: string | null
      error: string
      created_at: number
      updated_at: number
    }>('SELECT * FROM publish_jobs WHERE id=?', [id])
    if (!r) return null
    return {
      id: r.id,
      bookId: r.book_id,
      chapterId: r.chapter_id,
      platform: 'fanqie',
      status: r.status as PublishJob['status'],
      payload: j<Record<string, unknown>>(r.payload, {}),
      result: r.result ? j<Record<string, unknown>>(r.result, {}) : null,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
  },
  list(bookId: string): PublishJob[] {
    return allRaw<{
      id: string
      book_id: string
      chapter_id: string
      platform: string
      status: string
      payload: string
      result: string | null
      error: string
      created_at: number
      updated_at: number
    }>('SELECT * FROM publish_jobs WHERE book_id=? ORDER BY created_at DESC', [bookId]).map((r) => ({
      id: r.id,
      bookId: r.book_id,
      chapterId: r.chapter_id,
      platform: 'fanqie',
      status: r.status as PublishJob['status'],
      payload: j<Record<string, unknown>>(r.payload, {}),
      result: r.result ? j<Record<string, unknown>>(r.result, {}) : null,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  },
  create(bookId: string, chapterId: string, payload: Record<string, unknown>): string {
    const id = newId('pj_')
    runRaw(
      'INSERT INTO publish_jobs(id,book_id,chapter_id,platform,status,payload,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [id, bookId, chapterId, 'fanqie', 'pending', JSON.stringify(payload), '', now(), now()]
    )
    return id
  },
  update(id: string, status: PublishJob['status'], result: Record<string, unknown> | null, error = ''): void {
    runRaw('UPDATE publish_jobs SET status=?, result=?, error=?, updated_at=? WHERE id=?', [
      status,
      result ? JSON.stringify(result) : null,
      error,
      now(),
      id
    ])
  }
}

/* ----------------------------- 抓包模板 ----------------------------- */

export const captureRepo = {
  list(): CapturedRequest[] {
    return allRaw<{
      id: string
      name: string
      method: string
      url: string
      headers: string
      body: string
      content_type: string
      role: string
      created_at: number
    }>('SELECT * FROM captured_requests ORDER BY created_at DESC').map((r) => ({
      id: r.id,
      name: r.name,
      method: r.method,
      url: r.url,
      headers: j<Record<string, string>>(r.headers, {}),
      body: r.body,
      contentType: r.content_type,
      role: r.role as CapturedRequest['role'],
      createdAt: r.created_at
    }))
  },
  add(input: Omit<CapturedRequest, 'id' | 'createdAt'>): string {
    const id = newId('cr_')
    runRaw(
      'INSERT INTO captured_requests(id,name,method,url,headers,body,content_type,role,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [id, input.name, input.method, input.url, JSON.stringify(input.headers), input.body, input.contentType, input.role, now()]
    )
    return id
  },
  setRole(id: string, role: CapturedRequest['role']): void {
    runRaw('UPDATE captured_requests SET role=? WHERE id=?', [role, id])
  },
  rename(id: string, name: string): void {
    runRaw('UPDATE captured_requests SET name=? WHERE id=?', [name, id])
  },
  updateBody(id: string, body: string): void {
    runRaw('UPDATE captured_requests SET body=? WHERE id=?', [body, id])
  },
  remove(id: string): void {
    runRaw('DELETE FROM captured_requests WHERE id=?', [id])
  },
  clear(): void {
    runRaw('DELETE FROM captured_requests')
  }
}

/* ----------------------------- 供应商配置 ----------------------------- */

const EMPTY_MODELS: ModelSettings['models'] = {
  default: '',
  planner: '',
  writer: '',
  summarizer: '',
  judge: '',
  embedding: '',
  image: ''
}

interface ProviderRow {
  id: string
  name: string
  base_url: string
  api_key: string
  models: string
  temperature: number
  max_tokens: number
  extra_headers: string
  preset: string
  created_at: number
  updated_at: number
}

function mapProvider(r: ProviderRow): ProviderProfile {
  return {
    id: r.id,
    name: r.name,
    baseUrl: r.base_url,
    apiKey: decryptSecret(r.api_key),
    models: { ...EMPTY_MODELS, ...j<Partial<ModelSettings['models']>>(r.models, {}) },
    temperature: r.temperature,
    maxTokens: r.max_tokens,
    extraHeaders: r.extra_headers,
    preset: r.preset,
    active: false,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export const providerRepo = {
  list(): ProviderProfile[] {
    return allRaw<ProviderRow>('SELECT * FROM providers ORDER BY updated_at DESC, name ASC').map(mapProvider)
  },
  get(id: string): ProviderProfile | null {
    const r = getRaw<ProviderRow>('SELECT * FROM providers WHERE id=?', [id])
    return r ? mapProvider(r) : null
  },
  count(): number {
    return Number(getRaw<{ c: number }>('SELECT COUNT(*) AS c FROM providers')?.c || 0)
  },
  create(input: ProviderInput): string {
    const id = newId('pr_')
    const t = now()
    runRaw(
      `INSERT INTO providers(id,name,base_url,api_key,models,temperature,max_tokens,extra_headers,preset,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.name,
        input.baseUrl,
        encryptSecret(input.apiKey),
        JSON.stringify({ ...EMPTY_MODELS, ...input.models }),
        input.temperature,
        input.maxTokens,
        input.extraHeaders || '',
        input.preset || 'custom',
        t,
        t
      ]
    )
    return id
  },
  update(id: string, patch: Partial<ProviderInput>): void {
    const cur = getRaw<ProviderRow>('SELECT * FROM providers WHERE id=?', [id])
    if (!cur) throw new Error('供应商配置不存在')
    const models = patch.models
      ? JSON.stringify({ ...EMPTY_MODELS, ...j<Partial<ModelSettings['models']>>(cur.models, {}), ...patch.models })
      : cur.models
    runRaw(
      `UPDATE providers SET name=?, base_url=?, api_key=?, models=?, temperature=?, max_tokens=?, extra_headers=?, preset=?, updated_at=? WHERE id=?`,
      [
        patch.name ?? cur.name,
        patch.baseUrl ?? cur.base_url,
        patch.apiKey !== undefined ? encryptSecret(patch.apiKey) : cur.api_key,
        models,
        patch.temperature ?? cur.temperature,
        patch.maxTokens ?? cur.max_tokens,
        patch.extraHeaders ?? cur.extra_headers,
        patch.preset ?? cur.preset,
        now(),
        id
      ]
    )
  },
  remove(id: string): void {
    runRaw('DELETE FROM providers WHERE id=?', [id])
  }
}

/* ----------------------------- 设置 ----------------------------- */

export const settingsRepo = {
  get<T>(key: string, fallback: T): T {
    const r = getRaw<{ value: string }>('SELECT value FROM settings WHERE key=?', [key])
    if (!r) return fallback
    return j<T>(r.value, fallback)
  },
  set(key: string, value: unknown): void {
    runRaw('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [
      key,
      JSON.stringify(value)
    ])
  }
}
