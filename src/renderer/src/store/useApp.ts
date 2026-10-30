import { create } from 'zustand'
import type { AppSettings, AppTask, Book, PipelineEvent, PipelineStatus } from '@shared/types'

export type View = 'library' | 'book' | 'editor' | 'publish' | 'settings'

export interface ToastMsg {
  id: number
  type: 'info' | 'success' | 'error'
  message: string
}

interface AppStore {
  ready: boolean
  view: View
  bookId: string | null
  chapterId: string | null
  books: Book[]
  settings: AppSettings | null
  events: PipelineEvent[]
  status: PipelineStatus | null
  /** 后台任务（去AI味 / 审校 / 修稿 / 写记忆 / 封面 / 标签 / 发布…） */
  tasks: AppTask[]
  stream: string
  streamChapter: number | null
  dataVersion: number
  toasts: ToastMsg[]
  init: () => Promise<void>
  navigate: (view: View, payload?: { bookId?: string | null; chapterId?: string | null }) => void
  refreshBooks: () => Promise<void>
  pushEvent: (e: PipelineEvent) => void
  toast: (type: ToastMsg['type'], message: string) => void
  dismiss: (id: number) => void
  setSettings: (s: AppSettings) => void
}

let toastSeq = 1

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  view: 'library',
  bookId: null,
  chapterId: null,
  books: [],
  settings: null,
  events: [],
  status: null,
  tasks: [],
  stream: '',
  streamChapter: null,
  dataVersion: 0,
  toasts: [],

  init: async () => {
    try {
      const [settings, books, status] = await Promise.all([
        window.api.settings.get(),
        window.api.books.list(),
        window.api.pipeline.status()
      ])
      set({ settings, books, status, ready: true })
    } catch (err) {
      get().toast('error', `初始化失败：${(err as Error).message}`)
      set({ ready: true })
    }

    window.api.pipeline.onEvent((e) => get().pushEvent(e))

    // 后台任务：主进程是唯一事实来源，切页/重进都不丢状态
    const applyTask = (task: AppTask): void => {
      const list = get().tasks
      const idx = list.findIndex((x) => x.id === task.id)
      const next = idx >= 0 ? list.map((x, i) => (i === idx ? task : x)) : [task, ...list]
      set({ tasks: next.slice(0, 60) })
      if (task.status === 'done') {
        const msg = task.kind === 'deai' ? task.message : `${task.title}：${task.message}`
        get().toast('success', msg)
        set({ dataVersion: get().dataVersion + 1 })
      }
      if (task.status === 'error') get().toast('error', `${task.title}：${task.error || task.message}`)
    }
    window.api.tasks.onEvent(applyTask)
    void window.api.tasks.list().then((list) => set({ tasks: list }))

    // 索引被自动重建时告知用户（换了向量模型等情况）
    window.api.memory.onAutoRebuilt((list) => {
      if (!list.length) return
      const names = list.slice(0, 2).map((x) => x.title).join('、')
      const more = list.length > 2 ? ` 等 ${list.length} 本` : ''
      get().toast('info', `记忆索引已自动重建：${names}${more}`)
      set({ dataVersion: get().dataVersion + 1 })
    })
    setInterval(() => {
      void window.api.pipeline.status().then((s) => set({ status: s }))
    }, 2500)
  },

  navigate: (view, payload) =>
    set((s) => ({
      view,
      bookId: payload && 'bookId' in payload ? (payload.bookId ?? s.bookId) : s.bookId,
      chapterId: payload && 'chapterId' in payload ? (payload.chapterId ?? null) : view === 'editor' ? s.chapterId : null
    })),

  refreshBooks: async () => {
    const books = await window.api.books.list()
    set({ books, dataVersion: get().dataVersion + 1 })
  },

  pushEvent: (e) => {
    const s = get()
    if (e.type === 'log' && e.phase === 'streaming') {
      set({ stream: e.message, streamChapter: e.chapterNo ?? null })
      return
    }
    const events = [...s.events, e].slice(-300)
    if (e.type === 'chapter_done' || e.type === 'done' || e.type === 'error') {
      set({ events, stream: '', dataVersion: s.dataVersion + 1 })
      if (e.type === 'chapter_done') void get().refreshBooks()
      if (e.type === 'done') {
        get().toast('success', e.message)
        void get().refreshBooks()
      }
      if (e.type === 'error') get().toast('error', e.message)
    } else {
      set({ events })
    }
  },

  toast: (type, message) => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => get().dismiss(id), type === 'error' ? 6000 : 3200)
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setSettings: (settings) => set({ settings })
}))
