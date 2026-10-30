/**
 * 全应用共享类型定义（主进程 / 渲染进程共用）
 * 所有时间戳均为毫秒时间戳；所有 id 为字符串。
 */

export type BookStatus = 'planning' | 'writing' | 'paused' | 'completed'
export type WorkType = 'novel' | 'short'
export type ThemeMode = 'dark' | 'light'
export type AccentColor = 'amber' | 'blue' | 'green' | 'violet' | 'rose' | 'cyan' | 'red'
export type ChapterStatus = 'planned' | 'drafted' | 'reviewed' | 'published'
export type BibleKind =
  | 'world'      // 世界观 / 时代 / 地理
  | 'power'      // 力量体系 / 等级
  | 'character'  // 人物
  | 'location'   // 地点
  | 'item'       // 道具 / 功法 / 装备
  | 'faction'    // 势力 / 组织
  | 'rule'       // 硬性设定（不可违背）
  | 'timeline'   // 大事记

/**
 * 番茄后台分类标签。
 * 长篇「阅读标签」：主分类 1 个，主题/角色/情节各最多 2 个。
 * 短故事「短故事分类」：主分类必选，合计最多 8 个；分组是 情节/角色/情绪/背景。
 */
export interface FanqieTagPick {
  main: string
  theme: string[]
  character: string[]
  plot: string[]
  /** 短故事专用：情绪 */
  emotion?: string[]
  /** 短故事专用：背景 */
  background?: string[]
  /** 词表形态，用于区分长短篇分类体系 */
  mode?: 'novel' | 'short'
  /** 生成时间（毫秒），用于提示词表可能过期 */
  analyzedAt?: number
}

export interface Book {
  id: string
  title: string
  subtitle: string
  synopsis: string
  tags: string[]
  genre: string
  coverPath: string
  status: BookStatus
  workType: WorkType
  targetChapters: number
  wordsPerChapter: number
  styleProfile: StyleProfile | null
  concept: ConceptOption | null
  /** 番茄阅读标签（自动选形结果，可手改） */
  fanqieTags?: FanqieTagPick | null
  createdAt: number
  updatedAt: number
}

export interface StyleProfile {
  tone: string            // 叙事基调
  pov: string             // 人称与视角
  sentence: string        // 句式特征
  dialogue: string        // 对白风格
  pacing: string          // 节奏
  taboos: string[]        // 禁忌 / 避免项
  sample: string          // 文风样例
}

export interface ConceptOption {
  title: string
  synopsis: string
  tags: string[]
  genre: string
  hook: string
  protagonist: string
  goldenFinger: string
  sellingPoints: string[]
  openingScene: string
  /** 短故事专用：故事结构预览 */
  structure?: string
}

export interface Chapter {
  id: string
  bookId: string
  volumeNo: number
  chapterNo: number
  title: string
  outline: string
  content: string
  status: ChapterStatus
  wordCount: number
  summary: string
  keyEvents: string[]
  /** 检索关键词（摘要时生成），没有 embedding 模型时靠它提升召回 */
  searchTerms?: string[]
  /** 最后一次去AI味完成时间戳；0 = 没做过 */
  deaiDoneAt?: number
  createdAt: number
  updatedAt: number
}

export interface BibleEntry {
  id: string
  bookId: string
  kind: BibleKind
  name: string
  content: string
  state: Record<string, unknown>
  importance: number
  locked: boolean
  updatedAt: number
  lastChapterNo: number
}

export interface OutlineNode {
  id: string
  bookId: string
  level: 'volume' | 'chapter'
  seq: number
  parentSeq: number
  title: string
  goal: string
  beats: string[]
  status: 'pending' | 'done'
}

export interface Foreshadowing {
  id: string
  bookId: string
  name: string
  note: string
  plantedChapterNo: number
  resolveByChapterNo: number
  status: 'open' | 'resolved' | 'abandoned'
  updatedAt: number
}

export interface VolumeSummary {
  volumeNo: number
  content: string
  updatedAt: number
}

export interface ConsistencyIssue {
  type: 'setting' | 'timeline' | 'character' | 'power' | 'logic' | 'repetition' | 'style'
  severity: 'low' | 'medium' | 'high'
  description: string
  evidence: string
  suggestion: string
}

export interface MemoryOverview {
  bookId: string
  chapterCount: number
  wordCount: number
  bibleCount: number
  openForeshadowing: number
  totalForeshadowing: number
  lastSummaryChapter: number
  volumes: VolumeSummary[]
  recentChapters: { chapterNo: number; title: string; summary: string }[]
  entityCount: number
  vectorCount: number
}

export interface ConceptRequest {
  idea: string
  /** 全自动：用户不提供灵感/风格，由 AI 自主决定题材、受众与写法 */
  auto?: boolean
  workType?: WorkType
  genre?: string
  audience?: string
  lengthHint?: number
  styleHint?: string
  count?: number
}

export interface BookCreateInput {
  concept: ConceptOption
  workType: WorkType
  targetChapters: number
  wordsPerChapter: number
  styleProfile?: StyleProfile | null
  autoOutline?: boolean
}

export interface ModelSettings {
  baseUrl: string
  apiKey: string
  /** 各用途模型分工，留空则回退到 defaultModel */
  models: {
    default: string
    planner: string
    writer: string
    summarizer: string
    judge: string
    embedding: string
    image: string
  }
  temperature: number
  maxTokens: number
  concurrency: number
  /** 服务商附加请求头，JSON 字符串 */
  extraHeaders: string
}

/** 一套已保存的供应商配置（可多套并存，切换即生效） */
export interface ProviderProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: ModelSettings['models']
  temperature: number
  maxTokens: number
  extraHeaders: string
  /** 来源预设 id（custom / deepseek / openai ...） */
  preset: string
  active: boolean
  createdAt: number
  updatedAt: number
}

export type ProviderInput = Omit<ProviderProfile, 'id' | 'active' | 'createdAt' | 'updatedAt'>

export interface AppSettings {
  model: ModelSettings
  fanqie: {
    writerUrl: string
    autoPublish: boolean
    useApiReplay: boolean
    publishDelayMs: number
  }
  writing: {
    autoReview: boolean
    consistencyCheck: boolean
    contextBudget: number
  }
  ui: { theme: ThemeMode; accent: AccentColor }
}

export interface PublishJob {
  id: string
  bookId: string
  chapterId: string
  platform: 'fanqie'
  status: 'pending' | 'running' | 'success' | 'failed' | 'need_manual'
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string
  createdAt: number
  updatedAt: number
}

export interface FanqieSession {
  loggedIn: boolean
  url: string
  userName?: string
  cookieCount: number
  capturedTemplates: number
}

export interface CapturedRequest {
  id: string
  name: string
  method: string
  url: string
  headers: Record<string, string>
  body: string
  contentType: string
  createdAt: number
  /** 用户标注用途 */
  role: 'publish' | 'create_draft' | 'save_content' | 'query' | 'unknown'
}

export interface EndingJudgement {
  complete: boolean
  reason: string
  missing: string[]
  suggestChapters: number
}

export interface PipelineStatus {
  running: boolean
  bookId: string | null
  mode: 'chapters' | 'outline' | 'full' | null
  current: number
  done: number
  total: number
  phase: string
  message: string
  error: string
  startedAt: number
}

/** 后台任务类型：慢操作都走任务中心，便于跨页面显示进度 */
export type TaskKind =
  | 'deai'
  | 'review'
  | 'reviewFix'
  | 'summary'
  | 'rewrite'
  | 'chapters'
  | 'concept'
  | 'bookInit'
  | 'bible'
  | 'volumes'
  | 'structure'
  | 'outlines'
  | 'index'
  | 'style'
  | 'cover'
  | 'test'
  | 'models'
  | 'tags'
  | 'publish'
  | 'publishTags'
  | 'replay'

export interface AppTask {
  id: string
  kind: TaskKind
  title: string
  bookId?: string
  /** 关联对象：章节 id 或书籍 id */
  refId?: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  /** 0~100 */
  progress: number
  phase: string
  message: string
  /** 例如 "3/8" */
  detail: string
  total?: number
  error?: string
  /** 任务产物：例如去AI味改写稿 */
  result?: unknown
  startedAt: number
  updatedAt: number
  finishedAt?: number
}
export interface PipelineEvent {
  type: 'start' | 'progress' | 'chapter_done' | 'log' | 'done' | 'error' | 'paused'
  bookId?: string
  chapterNo?: number
  phase?: string
  message: string
  progress?: { current: number; total: number }
  data?: unknown
  at?: number
}

export interface GenerationResult {
  content: string
  model: string
  promptTokens: number
  completionTokens: number
  elapsedMs: number
}

export interface TestModelResult {
  ok: boolean
  message: string
  models?: string[]
  latencyMs?: number
}

export interface WritingProgressRow {
  chapterNo: number
  title: string
  status: ChapterStatus
  wordCount: number
}
