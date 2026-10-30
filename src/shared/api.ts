/**
 * 渲染进程可调用的 API 契约（preload 注入 window.api）
 */
import type {
  AppSettings,
  AppTask,
  BibleEntry,
  BibleKind,
  Book,
  BookCreateInput,
  CapturedRequest,
  Chapter,
  ConceptOption,
  ConceptRequest,
  ConsistencyIssue,
  FanqieTagPick,
  Foreshadowing,
  MemoryOverview,
  ModelSettings,
  OutlineNode,
  PipelineEvent,
  PipelineStatus,
  ProviderInput,
  ProviderProfile,
  PublishJob,
  StyleProfile,
  TestModelResult,
  VolumeSummary,
  WorkType
} from './types'

export interface ConceptResult {
  options: ConceptOption[]
}

export interface CreateResult {
  book: Book
  warning?: string
}

export interface WriteResult {
  chapter: Chapter
  issues: ConsistencyIssue[]
}

export interface PublishResult {
  job: PublishJob
  message: string
  detail?: unknown
}

export interface MemorySearchHit {
  refType: string
  refId: string
  chapterNo: number
  title: string
  text: string
  score: number
  sources: string[]
}

export interface ExportResult {
  path: string
  format: 'txt' | 'epub'
  bytes: number
  chapters: number
}

export interface ContextPreview {
  chapterNo: number
  estimatedTokens: number
  blocks: { label: string; tokens: number; preview: string }[]
  hits: MemorySearchHit[]
}

export interface XmApi {
  app: {
    info(): Promise<{
      version: string
      dataDir: string
      dbPath: string
      platform: string
      arch: string
      platformLabel: string
      electron: string
    }>
    openDataDir(): Promise<void>
    openPath(p: string): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    save(patch: Partial<AppSettings>): Promise<AppSettings>
    test(model?: ModelSettings): Promise<TestModelResult>
    models(model?: ModelSettings): Promise<string[]>
    /** 测试向量模型是否可用；不可用时检索会回退本地哈希 */
    testEmbedding(model?: ModelSettings): Promise<{
      ok: boolean
      mode: 'remote' | 'local'
      dim?: number
      message: string
      latencyMs?: number
    }>
  }
  providers: {
    list(): Promise<ProviderProfile[]>
    create(input: ProviderInput, activate?: boolean): Promise<{ providers: ProviderProfile[]; settings: AppSettings }>
    update(id: string, patch: Partial<ProviderInput>): Promise<{ providers: ProviderProfile[]; settings: AppSettings }>
    remove(id: string): Promise<{ providers: ProviderProfile[]; settings: AppSettings }>
    activate(id: string): Promise<{ providers: ProviderProfile[]; settings: AppSettings }>
  }
  books: {
    list(): Promise<Book[]>
    get(id: string): Promise<Book | null>
    concept(req: ConceptRequest): Promise<ConceptOption[]>
    create(input: BookCreateInput): Promise<CreateResult>
    createBlank(input: {
      title: string
      workType?: WorkType
      genre?: string
      synopsis?: string
      tags?: string[]
      targetChapters?: number
      wordsPerChapter?: number
    }): Promise<Book>
    update(id: string, patch: Partial<Book>): Promise<Book | null>
    remove(id: string): Promise<void>
    generateBible(id: string): Promise<number>
    generateVolumes(id: string): Promise<number>
    /** 短故事：生成/重建 7 拍故事结构 */
    generateStructure(id: string): Promise<OutlineNode | null>
  }
  chapters: {
    list(bookId: string, withContent?: boolean): Promise<Chapter[]>
    get(id: string): Promise<Chapter | null>
    save(id: string, patch: Partial<Chapter>): Promise<Chapter | null>
    remove(id: string): Promise<void>
    write(bookId: string, chapterNo?: number): Promise<WriteResult>
    rewrite(bookId: string, chapterNo: number): Promise<WriteResult>
    generateOutlines(bookId: string, from: number, count: number): Promise<OutlineNode[]>
    summarize(id: string): Promise<Chapter | null>
    /** 本书去AI味进度：待处理 / 已处理 / 总数 */
    deAiPending(bookId: string): Promise<{
      pending: number
      done: number
      total: number
      chapters: { id: string; chapterNo: number; title: string }[]
    }>
    /** 采纳某章的去AI味结果（备份原稿 + 打标记 + 重建记忆） */
    deAiAdopt(chapterId: string, text: string): Promise<{ chapter: Chapter | null; hasBackup: boolean }>
    /** 回滚到去AI味之前的原稿 */
    deAiRollback(chapterId: string): Promise<{ chapter: Chapter | null; restoredAt: number }>
    /** 批量去AI味；force=true 才重跑已处理过的章节 */
    deAiBatch(
      bookId: string,
      opts?: { force?: boolean; limit?: number }
    ): Promise<{ processed: number; failed: number; skipped: number; message: string; errors?: { chapterNo: number; error: string }[] }>
    /** 去 AI 味：只返回改写预览，不写库 */
    deAi(
      id: string,
      hint?: string
    ): Promise<{ text: string; changed: boolean; beforeLength: number; afterLength: number }>
    check(id: string): Promise<ConsistencyIssue[]>
    /** 审校并按级别自动修稿（high = 只修严重；medium = 严重+中等） */
    reviewFix(
      id: string,
      level?: 'high' | 'medium'
    ): Promise<{ chapter: Chapter | null; issues: ConsistencyIssue[]; fixed: boolean; fixedCount: number; warning?: string }>
  }
  bible: {
    list(bookId: string): Promise<BibleEntry[]>
    save(entry: Partial<BibleEntry> & { bookId: string; kind: BibleKind; name: string }): Promise<BibleEntry[]>
    remove(id: string): Promise<void>
  }
  outline: {
    list(bookId: string): Promise<OutlineNode[]>
  }
  memory: {
    /** 索引因配置变更被自动重建时触发 */
    onAutoRebuilt(cb: (list: { bookId: string; title: string; reason: string }[]) => void): () => void
    overview(bookId: string): Promise<MemoryOverview>
    search(bookId: string, query: string): Promise<MemorySearchHit[]>
    rebuild(bookId: string): Promise<number>
    volumes(bookId: string): Promise<VolumeSummary[]>
    foreshadowing(bookId: string): Promise<Foreshadowing[]>
    addForeshadowing(input: { bookId: string; name: string; note?: string; plantedChapterNo?: number; resolveByChapterNo?: number }): Promise<Foreshadowing[]>
    resolveForeshadowing(bookId: string, name: string): Promise<Foreshadowing[]>
    extractStyle(sample: string): Promise<StyleProfile | null>
    contextPreview(bookId: string, chapterNo?: number): Promise<ContextPreview>
  }
  exporter: {
    book(bookId: string, format: 'txt' | 'epub', saveAs?: boolean): Promise<ExportResult | null>
  }
  cover: {
    generate(bookId: string, useAi?: boolean, variant?: number): Promise<{ path: string; dataUrl: string; mode: string }>
    read(bookId: string): Promise<string | null>
    pick(bookId: string): Promise<{ path: string; dataUrl: string } | null>
  }
  /** 后台任务中心：去AI味 / 审校 / 修稿 / 写记忆 / 封面 / 标签 / 发布等慢操作 */
  /** 自动更新（GitHub Releases） */
  update: {
    state(): Promise<{
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
      version?: string
      releaseNotes?: string
      releaseDate?: string
      progress: number
      downloading: boolean
      downloaded: boolean
      error?: string
      currentVersion: string
    }>
    check(): Promise<unknown>
    download(): Promise<unknown>
    install(): Promise<boolean>
    onState(cb: (s: unknown) => void): () => void
  }
  tasks: {
    list(): Promise<AppTask[]>
    get(id: string): Promise<AppTask | null>
    cancel(id: string): Promise<AppTask | null>
    onEvent(cb: (t: AppTask) => void): () => void
  }
  pipeline: {
    start(
      bookId: string,
      from: number,
      count: number,
      opts?: { autoReview?: boolean; consistencyCheck?: boolean; untilComplete?: boolean }
    ): Promise<PipelineStatus>
    pause(): Promise<PipelineStatus>
    stop(): Promise<PipelineStatus>
    status(): Promise<PipelineStatus>
    onEvent(cb: (e: PipelineEvent) => void): () => void
  }
  /** 番茄阅读标签（主分类 / 主题 / 角色 / 情节） */
  tags: {
    vocabulary(bookId?: string): Promise<{
      snapshot: string
      mode: 'novel' | 'short'
      groups: Record<string, string[]>
      limits: Record<string, number>
    }>
    suggest(bookId: string): Promise<{ pick: FanqieTagPick; book: Book }>
    save(bookId: string, pick: FanqieTagPick): Promise<{ pick: FanqieTagPick; book: Book }>
  }
  publish: {
    status(): Promise<{ loggedIn: boolean; url: string; userName?: string; cookieCount: number; capturedTemplates: number }>
    open(): Promise<void>
    close(): Promise<void>
    probe(): Promise<unknown>
    captures(): Promise<unknown[]>
    clearCaptures(): Promise<void>
    saveCapture(capture: unknown, role: CapturedRequest['role'], name: string): Promise<CapturedRequest[]>
    templates(): Promise<CapturedRequest[]>
    setRole(id: string, role: CapturedRequest['role']): Promise<CapturedRequest[]>
    removeTemplate(id: string): Promise<CapturedRequest[]>
    updateTemplate(id: string, patch: { name?: string; body?: string }): Promise<CapturedRequest[]>
    replay(id: string, vars: Record<string, string | number>): Promise<{ ok: boolean; status: number; body: string; error?: string }>
    fill(title: string, content: string): Promise<{ titleFound: boolean; editorFound: boolean; method: string }>
    publishChapter(bookId: string, chapterId: string, mode: 'api' | 'dom' | 'manual'): Promise<PublishResult>
    jobs(bookId: string): Promise<PublishJob[]>
    applyTags(bookId: string, pick?: FanqieTagPick): Promise<unknown>
    readTags(): Promise<unknown>
  }
}

declare global {
  interface Window {
    api: XmApi
  }
}
