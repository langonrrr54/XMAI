import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  BookMarked,
  Brain,
  Download,
  FileText,
  Image as ImageIcon,
  ListTree,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Wand2
} from 'lucide-react'
import type { Book, MemoryOverview } from '@shared/types'
import { useApp } from '../store/useApp'
import { EmptyState, Field, Modal, Stat, StatusDot } from '../components/ui'
import ChaptersTab from '../components/ChaptersTab'
import OutlineTab from '../components/OutlineTab'
import BibleTab from '../components/BibleTab'
import MemoryTab from '../components/MemoryTab'
import PublishPanel from '../components/PublishPanel'
import CoverEditor from '../components/CoverEditor'
import { cnStatus, fmtWords } from '../lib/format'

type Tab = 'overview' | 'chapters' | 'outline' | 'bible' | 'memory' | 'publish'

const TABS: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'overview', label: '概览', icon: BookMarked },
  { key: 'chapters', label: '章节', icon: FileText },
  { key: 'outline', label: '大纲', icon: ListTree },
  { key: 'bible', label: '设定库', icon: Brain },
  { key: 'memory', label: '记忆', icon: Sparkles },
  { key: 'publish', label: '发布', icon: Send }
]

export default function BookPage(): React.ReactNode {
  const bookId = useApp((s) => s.bookId)
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  const dataVersion = useApp((s) => s.dataVersion)
  const refreshBooks = useApp((s) => s.refreshBooks)
  const pipelineRunning = useApp((s) => s.status?.running)
  const pipelineBookId = useApp((s) => s.status?.bookId)

  const [book, setBook] = useState<Book | null>(null)
  const [overview, setOverview] = useState<MemoryOverview | null>(null)
  const [tab, setTab] = useState<Tab>('chapters')
  const [writing, setWriting] = useState(false)
  const [autoOpen, setAutoOpen] = useState(false)
  const [autoCount, setAutoCount] = useState(5)
  const [autoUntilDone, setAutoUntilDone] = useState(false)
  const [autoUntilComplete, setAutoUntilComplete] = useState(true)
  const [autoReview, setAutoReview] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState<'' | 'txt' | 'epub'>('')
  const [coverSrc, setCoverSrc] = useState<string | null>(null)
  const [coverOpen, setCoverOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editSynopsis, setEditSynopsis] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editTarget, setEditTarget] = useState(0)
  const [editWords, setEditWords] = useState(0)
  // doneCount 必须在提前 return 之前声明：
  // 否则 book 未加载时 hook 数量变化，React 会报 #310 并让整页崩溃。
  const [doneCount, setDoneCount] = useState(0)
  useEffect(() => {
    if (!bookId) return
    void window.api.chapters
      .list(bookId)
      .then((list) => setDoneCount(list.filter((c) => c.status !== 'planned').length))
      .catch(() => undefined)
  }, [bookId, dataVersion])
  // 任何来源（连续写作 / 写一章 / 重写）在本书上运行时，按钮都进入忙碌态
  const runningHere = !!pipelineRunning && pipelineBookId === bookId
  const busyHere = writing || runningHere

  const load = useCallback(async () => {
    if (!bookId) return
    const [b, o] = await Promise.all([window.api.books.get(bookId), window.api.memory.overview(bookId)])
    setBook(b)
    setOverview(o)
    if (b) {
      setEditTitle(b.title)
      setEditSynopsis(b.synopsis)
      setEditTags((b.tags || []).join(','))
      setEditTarget(b.targetChapters)
      setEditWords(b.wordsPerChapter)
      if (b.coverPath) {
        const d = await window.api.cover.read(b.id)
        setCoverSrc(d)
      }
    }
  }, [bookId])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  if (!bookId) {
    return <EmptyState title="还没有打开任何作品" desc="回到书库选择一本，或新建一本。" />
  }
  if (!book) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-mist-400">
        <Loader2 size={15} className="animate-spin" /> 加载作品…
      </div>
    )
  }

  const isShort = book.workType === 'short'
  const tabs = TABS.map((t) =>
    t.key === 'chapters'
      ? { ...t, label: isShort ? '全文' : '章节' }
      : t.key === 'outline'
        ? { ...t, label: isShort ? '结构' : '大纲' }
        : t
  )
  const hasShortText = (overview?.wordCount || 0) > 0

  // 写作状态以主进程为准：切页回来、组件重新挂载后按钮与进度不会"看起来停了"
  const writeOne = async (): Promise<void> => {
    setWriting(true)
    try {
      const res = await window.api.chapters.write(book.id)
      toast('success', `第 ${res.chapter.chapterNo} 章已生成，${res.chapter.wordCount} 字`)
      await load()
      navigate('editor', { bookId: book.id, chapterId: res.chapter.id })
    } catch (err) {
      toast('error', `生成失败：${(err as Error).message}`)
    } finally {
      setWriting(false)
      void window.api.pipeline.status().then((s) => useApp.setState({ status: s }))
    }
  }

  const startAuto = async (): Promise<void> => {
    setAutoOpen(false)
    const status = useApp.getState().status
    if (status?.running) {
      toast('error', '已有写作任务在运行，请先等待或停止')
      return
    }
    // 用已完成章数（不含中断草稿）计算剩余，避免停在目标前一章
    const doneChapters = (await window.api.chapters.list(book.id)).filter((c) => c.status !== 'planned').length
    const remaining = Math.max(1, book.targetChapters - doneChapters)
    const count = autoUntilDone || autoUntilComplete ? remaining : Math.max(1, autoCount)
    try {
      await window.api.pipeline.start(book.id, 0, count, {
        autoReview,
        consistencyCheck: true,
        untilComplete: autoUntilComplete
      })
      toast('info', `已开始连续写作 ${count} 章${autoUntilComplete ? '（达到目标后判断完结）' : ''}`)
    } catch (err) {
      toast('error', `启动失败：${(err as Error).message}`)
    }
  }

  const doExport = async (format: 'txt' | 'epub'): Promise<void> => {
    setExporting(format)
    try {
      const r = await window.api.exporter.book(book.id, format, true)
      if (!r) return
      setExportOpen(false)
      toast('success', `已导出 ${r.chapters} 章到：${r.path}`)
    } catch (err) {
      toast('error', `导出失败：${(err as Error).message}`)
    } finally {
      setExporting('')
    }
  }

  const saveMeta = async (): Promise<void> => {
    await window.api.books.update(book.id, {
      title: editTitle,
      synopsis: editSynopsis,
      tags: editTags.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      targetChapters: isShort ? 1 : Math.max(1, editTarget),
      wordsPerChapter: Math.max(300, editWords)
    })
    setEditOpen(false)
    toast('success', '作品信息已更新')
    await load()
    await refreshBooks()
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line/6 bg-app/70 px-6 pb-0 pt-5 backdrop-blur">
        <div className="flex items-start gap-4">
          <button className="mt-1 rounded-lg p-1.5 text-fg/40 hover:bg-fg/10 hover:text-fg" onClick={() => navigate('library')}>
            <ArrowLeft size={16} />
          </button>
          <div className="relative h-[104px] w-[78px] shrink-0 overflow-hidden rounded-lg border border-line/10 bg-black/40">
            {coverSrc ? (
              <img src={coverSrc} alt={book.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-fg/20">
                <ImageIcon size={20} />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-serif-cn text-[22px] font-semibold tracking-wide text-fg">{book.title}</h1>
              <span className="rounded-md bg-fg/6 px-1.5 py-0.5 text-[10px] text-fg/45">
                {isShort
                  ? '短故事'
                  : book.status === 'writing'
                    ? '连载中'
                    : book.status === 'completed'
                      ? '已完结'
                      : book.status === 'paused'
                        ? '已暂停'
                        : '筹备中'}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 max-w-3xl text-[12px] leading-relaxed text-fg/45">{book.synopsis || '还没有简介'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-fg/30">
              <span>{book.genre}</span>
              {(book.tags || [])
                .filter((t) => t !== book.genre)
                .slice(0, 5)
                .map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              <span>· {isShort ? `目标 ${book.wordsPerChapter} 字 · 单篇` : `目标 ${book.targetChapters} 章 / 单章 ${book.wordsPerChapter} 字`}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button className="btn-ghost btn-sm" onClick={() => setEditOpen(true)}>
              <Pencil size={13} /> 编辑
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setCoverOpen(true)}>
              <ImageIcon size={13} /> 封面
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setExportOpen(true)}>
              <Download size={13} /> 导出
            </button>
            {isShort ? (
              <button className="btn-primary btn-sm" disabled={busyHere} onClick={() => void writeOne()}>
                {busyHere ? <Loader2 size={13} className="animate-spin" /> : hasShortText ? <RefreshCw size={13} /> : <Wand2 size={13} />}
                {hasShortText ? '重写全文' : '写完整篇'}
              </button>
            ) : (
              <>
                <button className="btn-ghost btn-sm" disabled={busyHere} onClick={() => void writeOne()}>
                  {busyHere ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} 写一章
                </button>
                <button className="btn-primary btn-sm" onClick={() => setAutoOpen(true)}>
                  <Play size={13} /> 连续写作
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1">
          {tabs.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12.5px] transition ${
                  tab === t.key ? 'border-accent text-accent' : 'border-transparent text-fg/40 hover:text-fg/75'
                }`}
                onClick={() => setTab(t.key)}
              >
                <Icon size={13} /> {t.label}
              </button>
            )
          })}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && overview && (
          <div className="mx-auto max-w-[1100px] px-6 py-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {isShort ? (
                <>
                  <Stat value={`${overview.wordCount}`} label="全文字数" />
                  <Stat value={overview.bibleCount} label="人物与设定" />
                  <Stat value={overview.totalForeshadowing} label="伏笔" />
                  <Stat value={hasShortText ? '已完成' : '未成篇'} label="状态" />
                </>
              ) : (
                <>
                  <Stat value={overview.chapterCount} label="已写章节" />
                  <Stat value={fmtWords(overview.wordCount)} label="总字数" />
                  <Stat value={overview.bibleCount} label="设定条目" />
                  <Stat value={`${overview.openForeshadowing}/${overview.totalForeshadowing}`} label="未回收伏笔" />
                </>
              )}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="panel p-4">
                <div className="section-title mb-2.5">核心概念</div>
                {book.concept ? (
                  <div className="space-y-1.5 text-[12.5px] leading-relaxed text-fg/60">
                    <div>开篇钩子：{book.concept.hook || '—'}</div>
                    <div>主角：{book.concept.protagonist || '—'}</div>
                    {!isShort && <div>金手指：{book.concept.goldenFinger || '—'}</div>}
                    <div>看点：{(book.concept.sellingPoints || []).join(' / ') || '—'}</div>
                    {isShort && book.concept.structure && <div>结构：{book.concept.structure}</div>}
                  </div>
                ) : (
                  <p className="text-[12px] text-fg/25">无（空白创建）</p>
                )}
              </div>
              <div className="panel p-4">
                <div className="section-title mb-2.5">文风卡</div>
                {book.styleProfile ? (
                  <div className="space-y-1 text-[12px] leading-relaxed text-fg/55">
                    <div>基调：{book.styleProfile.tone}</div>
                    <div>视角：{book.styleProfile.pov}</div>
                    <div>句式：{book.styleProfile.sentence}</div>
                    <div>对白：{book.styleProfile.dialogue}</div>
                    <div>节奏：{book.styleProfile.pacing}</div>
                  </div>
                ) : (
                  <p className="text-[12px] leading-relaxed text-fg/25">
                    使用默认番茄爽文风格。可在「记忆」页用样章提取专属文风卡。
                  </p>
                )}
              </div>
            </div>

            <div className="panel mt-4 p-4">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="section-title">最近记忆</div>
                <button className="text-[11px] text-accent/80 hover:text-accent" onClick={() => setTab('memory')}>
                  查看记忆面板 →
                </button>
              </div>
              {overview.recentChapters.length === 0 ? (
                <p className="text-[12px] text-fg/25">还没有章节摘要。写完第一章后会自动建立记忆索引。</p>
              ) : (
                <div className="space-y-2">
                  {overview.recentChapters.map((c) => (
                    <div key={c.chapterNo} className="rounded-lg border border-line/6 bg-fg/[0.02] px-3 py-2">
                      <div className="flex items-center gap-2 text-[12px] text-fg/75">
                        <StatusDot status="drafted" /> 第 {c.chapterNo} 章 · {c.title}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-fg/40">{c.summary}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'chapters' && <ChaptersTab book={book} onChanged={load} />}
        {tab === 'outline' && <OutlineTab book={book} onChanged={load} />}
        {tab === 'bible' && <BibleTab book={book} onChanged={load} />}
        {tab === 'memory' && <MemoryTab book={book} onChanged={load} overview={overview} />}
        {tab === 'publish' && <PublishPanel book={book} onChanged={load} />}
      </div>

      <Modal
        open={autoOpen}
        title="连续写作"
        subtitle="从下一章开始，按章推进记忆，可随时暂停"
        onClose={() => setAutoOpen(false)}
        width="max-w-md"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setAutoOpen(false)}>
              取消
            </button>
            <button className="btn-primary" onClick={() => void startAuto()} disabled={pipelineRunning}>
              <Play size={14} /> {pipelineRunning ? '运行中…' : '开始'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="生成章数" hint="建议 1~10 章一批，便于人工抽查质量">
            <input
              type="number"
              className="input"
              min={1}
              max={5000}
              disabled={autoUntilDone}
              value={autoUntilDone ? Math.max(1, book.targetChapters - doneCount) : autoCount}
              onChange={(e) => setAutoCount(Number(e.target.value))}
            />
          </Field>
          <label className="flex items-center gap-2 text-[12.5px] text-fg/65">
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={autoUntilDone} onChange={(e) => setAutoUntilDone(e.target.checked)} />
            一直写到目标章节数（{book.targetChapters} 章），可随时暂停
          </label>
          <label className="flex items-start gap-2 text-[12.5px] text-fg/65">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--color-accent)]"
              checked={autoUntilComplete}
              onChange={(e) => setAutoUntilComplete(e.target.checked)}
            />
            <span>
              达到目标章数后按剧情判断结局
              <span className="block text-[10.5px] leading-relaxed text-fg/25">
                主线与伏笔未收束则继续写（最多超出 10%），已收束则自动标记完结，不会机械停在目标数字。
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-fg/65">
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={autoReview} onChange={(e) => setAutoReview(e.target.checked)} />
            自动审校（发现严重冲突时自动修稿）
          </label>
          <div className="rounded-lg border border-line/8 bg-fg/[0.02] p-3 text-[11.5px] leading-relaxed text-fg/35">
            第 {overview ? overview.chapterCount + 1 : 1} 章起。当前记忆：{overview?.bibleCount || 0} 条设定、
            {overview?.totalForeshadowing || 0} 条伏笔、{overview?.chapterCount || 0} 章摘要。
          </div>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        title="编辑作品信息"
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEditOpen(false)}>
              取消
            </button>
            <button className="btn-primary" onClick={() => void saveMeta()}>
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="书名">
            <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </Field>
          <Field label="简介">
            <textarea className="textarea min-h-[120px]" value={editSynopsis} onChange={(e) => setEditSynopsis(e.target.value)} />
          </Field>
          <Field label="标签（逗号分隔）">
            <input className="input" value={editTags} onChange={(e) => setEditTags(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={isShort ? "目标字数" : "目标章数"} hint="决定连续写作的终点与完结判断">
              <input
                type="number"
                className="input"
                min={isShort ? 1000 : 1}
                max={isShort ? 30000 : 5000}
                value={isShort ? editWords : editTarget}
                onChange={(e) =>
                  isShort ? setEditWords(Number(e.target.value)) : setEditTarget(Number(e.target.value))
                }
              />
            </Field>
            <Field label="单章字数" hint={isShort ? "短故事不分章，此项即全文目标" : "每章正文目标字数"}>
              <input
                type="number"
                className="input"
                min={300}
                max={20000}
                value={editWords}
                onChange={(e) => setEditWords(Number(e.target.value))}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={exportOpen}
        title="导出作品"
        subtitle={overview ? `当前 ${overview.chapterCount} 章 · ${overview.wordCount} 字` : ''}
        onClose={() => setExportOpen(false)}
        width="max-w-lg"
      >
        <div className="space-y-2.5">
          <button
            className="w-full rounded-xl border border-line/8 bg-fg/[0.02] p-3.5 text-left transition hover:border-accent/40"
            disabled={!!exporting}
            onClick={() => void doExport('txt')}
          >
            <div className="flex items-center gap-2 text-[13px] text-fg">
              {exporting === 'txt' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} TXT 文本
            </div>
            <div className="mt-1 text-[11.5px] leading-relaxed text-fg/40">
              UTF-8 带 BOM，Windows 记事本可直接打开；按章节顺序输出标题与正文。
            </div>
          </button>
          <button
            className="w-full rounded-xl border border-line/8 bg-fg/[0.02] p-3.5 text-left transition hover:border-accent/40"
            disabled={!!exporting}
            onClick={() => void doExport('epub')}
          >
            <div className="flex items-center gap-2 text-[13px] text-fg">
              {exporting === 'epub' ? <Loader2 size={14} className="animate-spin" /> : <BookMarked size={14} />} EPUB 电子书
            </div>
            <div className="mt-1 text-[11.5px] leading-relaxed text-fg/40">
              带目录与章节结构，可用 Apple Books / 多看 / Calibre 打开；短故事导出为单篇。
            </div>
          </button>
          <p className="pt-1 text-[10.5px] leading-relaxed text-fg/25">
            导出会弹出保存位置；若桌面环境无法弹窗，可在此直接导出到数据目录下的 exports 文件夹。
          </p>
        </div>
      </Modal>

      <CoverEditor
        book={book}
        open={coverOpen}
        onClose={() => setCoverOpen(false)}
        onChanged={async () => {
          await load()
          await refreshBooks()
        }}
      />
    </div>
  )
}
