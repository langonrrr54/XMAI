import { useEffect, useRef, useState } from 'react'
import { BookOpen, Feather, Loader2, MoreHorizontal, Plus, Sparkles, Trash2, TrendingUp } from 'lucide-react'
import type { Book, WorkType } from '@shared/types'
import { useApp } from '../store/useApp'
import NewBookWizard from '../components/NewBookWizard'
import CoverThumb from '../components/CoverThumb'
import { EmptyState, Modal } from '../components/ui'

interface Stats {
  chapters: number
  words: number
}

export default function LibraryPage(): React.ReactNode {
  const books = useApp((s) => s.books)
  const dataVersion = useApp((s) => s.dataVersion)
  const navigate = useApp((s) => s.navigate)
  const refreshBooks = useApp((s) => s.refreshBooks)
  const toast = useApp((s) => s.toast)

  const [wizard, setWizard] = useState<WorkType | null>(null)
  const [tab, setTab] = useState<WorkType>('novel')
  const [stats, setStats] = useState<Record<string, Stats>>({})
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Book | null>(null)
  const [loading, setLoading] = useState(true)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void Promise.all(
      books.map(async (b) => {
        try {
          const o = await window.api.memory.overview(b.id)
          return [b.id, { chapters: o.chapterCount, words: o.wordCount }] as const
        } catch {
          return [b.id, { chapters: 0, words: 0 }] as const
        }
      })
    ).then((pairs) => {
      if (alive) {
        setStats(Object.fromEntries(pairs))
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [books, dataVersion])

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])

  const remove = async (): Promise<void> => {
    if (!confirmDelete) return
    try {
      await window.api.books.remove(confirmDelete.id)
      toast('success', `已删除《${confirmDelete.title}》`)
      setConfirmDelete(null)
      await refreshBooks()
    } catch (err) {
      toast('error', `删除失败：${(err as Error).message}`)
    }
  }

  const novels = books.filter((b) => b.workType !== 'short')
  const shorts = books.filter((b) => b.workType === 'short')
  const list = tab === 'novel' ? novels : shorts
  const isShortTab = tab === 'short'

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-7">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif-cn text-[24px] font-semibold tracking-wide text-fg">书库</h1>
          <p className="mt-1.5 text-[12.5px] text-mist-400">
            {books.length
              ? `长篇小说 ${novels.length} 部 · 短故事 ${shorts.length} 篇 · 两类作品分开管理`
              : '长篇小说与短故事分开创作、分开管理'}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setWizard('short')}>
            <Feather size={15} /> 写短故事
          </button>
          <button className="btn-primary" onClick={() => setWizard('novel')}>
            <Plus size={15} /> 写小说
          </button>
        </div>
      </div>

      <div className="mt-5 flex gap-1 border-b border-line/6">
        {[
          { key: 'novel' as WorkType, label: '长篇小说', count: novels.length, icon: BookOpen },
          { key: 'short' as WorkType, label: '短故事', count: shorts.length, icon: Feather }
        ].map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13px] transition ${
                tab === t.key ? 'border-accent text-accent' : 'border-transparent text-fg/40 hover:text-fg/75'
              }`}
              onClick={() => setTab(t.key)}
            >
              <Icon size={14} /> {t.label}
              <span className={`rounded px-1.5 text-[10px] ${tab === t.key ? 'bg-accent/15' : 'bg-fg/6'}`}>{t.count}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-6">
        {list.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon={isShortTab ? <Feather size={44} /> : <Sparkles size={44} />}
              title={isShortTab ? '还没有短故事' : '还没有长篇小说'}
              desc={
                isShortTab
                  ? '点开后可直接选「一键全自动」：题材、文风、书名、简介、7 拍结构全部交给 AI，最后一次性写完整篇。'
                  : '点开后可直接选「一键全自动」：题材、文风、书名、简介、设定库与分卷大纲全部交给 AI，然后自动连载。'
              }
              action={
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={() => setWizard(tab)}>
                    {isShortTab ? <Feather size={15} /> : <Sparkles size={15} />} {isShortTab ? '一键写短故事' : '一键开书'}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() =>
                      void window.api
                        .books.createBlank({
                          title: isShortTab ? '未命名短故事' : '未命名作品',
                          workType: tab,
                          genre: isShortTab ? '情感' : '都市'
                        })
                        .then(async (b) => {
                          await refreshBooks()
                          navigate('book', { bookId: b.id })
                        })
                    }
                  >
                    从空白创建
                  </button>
                </div>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
            {list.map((b) => {
              const s = stats[b.id]
              const short = b.workType === 'short'
              return (
                <div key={b.id} className="group relative">
                  <button
                    className="block w-full overflow-hidden rounded-2xl border border-line/8 bg-panel text-left transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-xl hover:shadow-black/40"
                    onClick={() => navigate('book', { bookId: b.id })}
                  >
                    <div className="relative aspect-[3/4] w-full overflow-hidden bg-black/40">
                      <CoverThumb book={b} />
                      {/* 只在底部压一条窄渐变，避免整块封面被压暗、标题被裁 */}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/85 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-2">
                        <div className="cover-text-safe line-clamp-2 font-serif-cn text-[12.5px] font-semibold leading-snug text-white drop-shadow">
                          {b.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-white/50">
                          <span>{b.genre || '未分类'}</span>
                          {s && (
                            <>
                              <span>·</span>
                              <span>{short ? (s.words > 0 ? `${s.words} 字` : '未成篇') : `${s.chapters} 章`}</span>
                              {!short && (
                                <>
                                  <span>·</span>
                                  <span>{(s.words / 10000).toFixed(1)} 万字</span>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
                        <span
                          className={`rounded px-1 py-0.5 text-[9px] backdrop-blur ${
                            b.status === 'writing'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : b.status === 'completed'
                                ? 'bg-black/40 text-white/80'
                                : 'bg-black/40 text-white/60'
                          }`}
                        >
                          {short ? '短故事' : b.status === 'writing' ? '连载中' : b.status === 'completed' ? '已完结' : b.status === 'paused' ? '已暂停' : '筹备中'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(b.tags || []).slice(0, short ? 2 : 2).map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                      <span className="flex items-center gap-1 text-[10.5px] text-fg/30">
                        <TrendingUp size={11} /> {short ? '打开' : '继续写'}
                      </span>
                    </div>
                  </button>
                  <button
                    className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white/60 opacity-0 backdrop-blur transition hover:text-white group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuFor(menuFor === b.id ? null : b.id)
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                  {menuFor === b.id && (
                    <div
                      ref={menuRef}
                      className="absolute right-2 top-10 z-20 w-36 overflow-hidden rounded-xl border border-line/10 bg-panel2 py-1 shadow-2xl"
                    >
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-fg/70 hover:bg-fg/5"
                        onClick={() => navigate('book', { bookId: b.id })}
                      >
                        <BookOpen size={13} /> 打开创作台
                      </button>
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-red-300 hover:bg-red-500/10"
                        onClick={() => {
                          setMenuFor(null)
                          setConfirmDelete(b)
                        }}
                      >
                        <Trash2 size={13} /> 删除作品
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {loading && books.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-[11px] text-fg/25">
          <Loader2 size={12} className="animate-spin" /> 统计中…
        </div>
      )}

      <NewBookWizard open={!!wizard} workType={wizard || 'novel'} onClose={() => setWizard(null)} />

      <Modal
        open={!!confirmDelete}
        title="删除作品"
        subtitle="连同章节、设定、记忆、发布记录一起删除，不可恢复"
        onClose={() => setConfirmDelete(null)}
        width="max-w-md"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>
              取消
            </button>
            <button className="btn-danger" onClick={() => void remove()}>
              <Trash2 size={14} /> 确认删除
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-fg/70">
          确定删除《{confirmDelete?.title}》吗？该操作会移除本地全部数据。
        </p>
      </Modal>
    </div>
  )
}
