import appIcon from './assets/app-icon.png'
import { useEffect, useState } from 'react'
import { BookOpen, FileText, Library, Loader2, Pause, Settings, Square, UploadCloud } from 'lucide-react'
import { useApp, type View } from './store/useApp'
import { Modal, Toasts } from './components/ui'
import TaskBar from './components/TaskBar'
import ErrorBoundary from './components/ErrorBoundary'
import LibraryPage from './pages/LibraryPage'
import BookPage from './pages/BookPage'
import ChapterEditor from './pages/ChapterEditor'
import PublishPage from './pages/PublishPage'
import SettingsPage from './pages/SettingsPage'

const NAV: { view: View; label: string; icon: typeof Library }[] = [
  { view: 'library', label: '书库', icon: Library },
  { view: 'book', label: '创作台', icon: BookOpen },
  { view: 'publish', label: '发布中心', icon: UploadCloud },
  { view: 'settings', label: '设置', icon: Settings }
]

function ProgressBar(): React.ReactNode {
  const status = useApp((s) => s.status)
  const stream = useApp((s) => s.stream)
  const events = useApp((s) => s.events)
  const [logOpen, setLogOpen] = useState(false)

  const pct = status?.total ? Math.min(100, Math.round(((status.done || 0) / status.total) * 100)) : 0

  return (
    <>
      {status?.running && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center p-4">
          <div className="pointer-events-auto w-[min(760px,92%)] rounded-2xl border border-accent/20 bg-panel2/95 px-4 py-3 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-3">
              <Loader2 size={15} className="animate-spin text-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[12.5px] text-fg/85">{status.message || status.phase}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-mist-400">
                    {status.done}/{status.total}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-fg/10">
                  <div className="h-full rounded-full accent-gradient transition-all" style={{ width: `${pct}%` }} />
                </div>
                {stream && <div className="mt-1.5 line-clamp-1 text-[11px] leading-relaxed text-fg/30">{stream.slice(-120)}</div>}
              </div>
              <button
                className="rounded-lg p-1.5 text-mist-400 hover:bg-fg/10 hover:text-fg"
                title="查看日志"
                onClick={() => setLogOpen(true)}
              >
                <FileText size={13} />
              </button>
              <button
                className="rounded-lg p-1.5 text-mist-400 hover:bg-fg/10 hover:text-fg"
                title="暂停（已生成部分会存为草稿）"
                onClick={() => void window.api.pipeline.pause()}
              >
                <Pause size={14} />
              </button>
              <button
                className="rounded-lg p-1.5 text-mist-400 hover:bg-fg/10 hover:text-fg"
                title="停止"
                onClick={() => void window.api.pipeline.stop()}
              >
                <Square size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={logOpen}
        title="写作日志"
        subtitle={`${events.length} 条记录 · 任务进行中可随时暂停或停止`}
        onClose={() => setLogOpen(false)}
        width="max-w-3xl"
      >
        <div className="space-y-0.5 font-mono text-[11px] leading-relaxed">
          {events.length === 0 ? (
            <p className="py-6 text-center text-fg/30">暂无日志</p>
          ) : (
            events.slice(-200).map((e, i) => (
              <div key={i} className="flex gap-2 border-b border-line/5 py-1 last:border-0">
                <span className="shrink-0 text-fg/25">
                  {e.at ? new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--'}
                </span>
                <span
                  className={`w-20 shrink-0 ${
                    e.type === 'error'
                      ? 'text-red-400'
                      : e.type === 'chapter_done'
                        ? 'text-emerald-400'
                        : e.type === 'done'
                          ? 'text-accent'
                          : 'text-fg/35'
                  }`}
                >
                  {e.type}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-fg/60">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  )
}

export default function App(): React.ReactNode {
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const bookId = useApp((s) => s.bookId)
  const chapterId = useApp((s) => s.chapterId)
  const books = useApp((s) => s.books)
  const navigate = useApp((s) => s.navigate)
  const init = useApp((s) => s.init)
  const ui = useApp((s) => s.settings?.ui)

  useEffect(() => {
    void init()
  }, [init])

  // 主题与主题色：跟随设置实时生效
  useEffect(() => {
    document.documentElement.dataset.theme = ui?.theme || 'dark'
    document.documentElement.dataset.accent = ui?.accent || 'amber'
  }, [ui?.theme, ui?.accent])

  const currentBook = books.find((b) => b.id === bookId)

  return (
    <div className="app-bg relative flex h-full w-full">
      <aside className="flex w-[224px] shrink-0 flex-col border-r border-line/6 bg-app/70 px-3 py-4 backdrop-blur">
        <div className="brand-logo mb-7 flex items-center gap-2.5 px-2">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-[10px] shadow-lg shadow-accent/25 ring-1 ring-line/12">
            <img src={appIcon} alt="熊喵AI写作" className="h-full w-full object-cover" draggable={false} />
          </div>
          <div className="font-serif-cn text-[15px] font-semibold tracking-wide text-fg">熊喵AI写作</div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = view === item.view || (item.view === 'book' && view === 'editor')
            // 没选作品时点创作台：不再禁用（禁用会让用户以为点击没反应），
            // 而是给出明确提示，并把用户带回书库选书。
            const needsBook = item.view === 'book' && !bookId
            return (
              <button
                key={item.view}
                className={`nav-item ${active ? 'nav-item-active' : ''} ${needsBook ? 'opacity-45' : ''}`}
                title={needsBook ? '先在书库选择或新建一本作品' : undefined}
                onClick={() => {
                  if (needsBook) {
                    useApp.getState().toast('info', '先在书库选择或新建一本作品')
                    navigate('library')
                    return
                  }
                  navigate(item.view)
                }}
              >
                <Icon size={16} />
                <span className="flex-1 text-left">{item.label}</span>
                {item.view === 'book' && currentBook && (
                  <span className="max-w-[70px] truncate text-[10px] text-fg/30">{currentBook.title}</span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="mt-auto space-y-2 px-2">
          <div className="hairline" />
          <div className="text-[10.5px] leading-relaxed text-fg/20">
            记忆引擎 · 分层上下文
            <br />
            长篇连贯性优先
          </div>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <ErrorBoundary key={`${view}:${bookId ?? ''}:${chapterId ?? ''}`}>
          {!ready ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-mist-400">
              <Loader2 size={16} className="animate-spin" /> 正在加载本地书库…
            </div>
          ) : view === 'library' ? (
            <LibraryPage />
          ) : view === 'book' ? (
            <BookPage />
          ) : view === 'editor' ? (
            <ChapterEditor />
          ) : view === 'publish' ? (
            <PublishPage />
          ) : (
            <SettingsPage />
          )}
          </ErrorBoundary>
        </div>
        <TaskBar />
        <ProgressBar />
      </main>

      <Toasts />
    </div>
  )
}
