import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Copy, FileText, ListPlus, Loader2, PenLine, RefreshCw, Sparkles, Wand2 } from 'lucide-react'
import type { Book, Chapter, OutlineNode } from '@shared/types'
import { useApp } from '../store/useApp'
import { EmptyState, Modal, StatusDot } from './ui'
import DeAiBatchPanel from './DeAiBatchPanel'
import { cnStatus, fmtTime } from '../lib/format'

export default function ChaptersTab({ book, onChanged }: { book: Book; onChanged: () => void }): React.ReactNode {
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  const dataVersion = useApp((s) => s.dataVersion)

  const [chapters, setChapters] = useState<Chapter[]>([])
  const [outlines, setOutlines] = useState<OutlineNode[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  // 主进程里本书有写作任务时（含跨页、含重写），这些按钮保持忙碌态而不是回到可点击
  const pipelineStatus = useApp((s) => s.status)
  const runningHere = !!pipelineStatus?.running && pipelineStatus.bookId === book.id
  const locked = !!busy || runningHere
  const [reader, setReader] = useState<Chapter | null>(null)
  const [readerBusy, setReaderBusy] = useState(false)

  const load = useCallback(async () => {
    const [cs, os] = await Promise.all([window.api.chapters.list(book.id), window.api.outline.list(book.id)])
    setChapters(cs)
    setOutlines(os.filter((o) => o.level === 'chapter'))
    setLoading(false)
  }, [book.id])

  const openReader = async (id: string): Promise<void> => {
    setReaderBusy(true)
    try {
      const full = await window.api.chapters.get(id)
      if (full) setReader(full)
    } catch (err) {
      toast('error', `读取失败：${(err as Error).message}`)
    } finally {
      setReaderBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  // 已完成章号（跳过流式中断留下的草稿），用于续写与细纲起点
  const lastNo = chapters.reduce((m, c) => (c.status !== 'planned' ? Math.max(m, c.chapterNo) : m), 0)
  const lastAnyNo = chapters.length ? chapters[chapters.length - 1].chapterNo : 0
  const pending = useMemo(() => outlines.filter((o) => o.seq > lastAnyNo).sort((a, b) => a.seq - b.seq), [outlines, lastAnyNo])

  const genOutlines = async (): Promise<void> => {
    setBusy('outline')
    try {
      const list = await window.api.chapters.generateOutlines(book.id, lastNo + 1, 20)
      toast('success', `已生成 ${list.length} 章细纲`)
      await load()
    } catch (err) {
      toast('error', `细纲生成失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const write = async (chapterNo?: number): Promise<void> => {
    setBusy(chapterNo ? `w${chapterNo}` : 'write')
    try {
      const res = await window.api.chapters.write(book.id, chapterNo)
      toast('success', `第 ${res.chapter.chapterNo} 章完成，${res.chapter.wordCount} 字`)
      await load()
      onChanged()
      navigate('editor', { bookId: book.id, chapterId: res.chapter.id })
    } catch (err) {
      toast('error', `生成失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-mist-400">
        <Loader2 size={15} className="animate-spin" /> 加载章节…
      </div>
    )
  }

  const readerModal = (
    <Modal
      open={!!reader}
      title={reader ? (book.workType === 'short' ? reader.title : `第 ${reader.chapterNo} 章 · ${reader.title}`) : ''}
      subtitle={reader ? `${reader.wordCount} 字 · ${cnStatus(reader.status)} · ${fmtTime(reader.updatedAt)}` : ''}
      onClose={() => setReader(null)}
      width="max-w-3xl"
      footer={
        <>
          <button className="btn-ghost" onClick={() => setReader(null)}>
            关闭
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              if (!reader) return
              void navigator.clipboard.writeText(reader.content).then(() => toast('success', '已复制正文'))
            }}
          >
            <Copy size={14} /> 复制
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              if (!reader) return
              const id = reader.id
              setReader(null)
              navigate('editor', { bookId: book.id, chapterId: id })
            }}
          >
            <PenLine size={14} /> 修改
          </button>
        </>
      }
    >
      {reader && (
        <div className="select-text whitespace-pre-wrap font-serif-cn text-[15px] leading-[2.05] text-fg/90">
          {reader.content || '（本章还没有正文）'}
        </div>
      )}
    </Modal>
  )

  /* ---------------- 短故事：单篇视图 ---------------- */
  if (book.workType === 'short') {
    const ch = chapters.find((c) => c.chapterNo === 1)
    const written = (ch?.wordCount || 0) > 0
    return (
      <div className="mx-auto max-w-[880px] px-6 py-6">
        <div className="panel p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-serif-cn text-[19px] font-semibold text-fg">{book.title}</div>
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-fg/30">
                <span>短故事</span>
                <span>·</span>
                <span>{written ? `${ch!.wordCount} 字` : '未成篇'}</span>
                {ch?.summary && (
                  <>
                    <span>·</span>
                    <span className="text-emerald-300/50">已入记忆库</span>
                  </>
                )}
                {ch && (
                  <>
                    <span>·</span>
                    <span>{new Date(ch.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {written && (
                <button className="btn-ghost btn-sm" disabled={readerBusy} onClick={() => void openReader(ch!.id)}>
                  <BookOpen size={13} /> 阅读全文
                </button>
              )}
              {written && (
                <button className="btn-ghost btn-sm" onClick={() => navigate('editor', { bookId: book.id, chapterId: ch!.id })}>
                  <PenLine size={13} /> 编辑全文
                </button>
              )}
              <button
                className="btn-primary btn-sm"
                disabled={locked}
                onClick={() => {
                  if (written && !window.confirm('重写会覆盖当前全文，确定继续？')) return
                  void write(1)
                }}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : written ? <RefreshCw size={13} /> : <Sparkles size={13} />}
                {written ? '重写全文' : '写完整篇'}
              </button>
            </div>
          </div>

          {written ? (
            <p className="mt-4 line-clamp-6 font-serif-cn text-[13px] leading-[1.9] text-fg/55">
              {ch?.summary || '（暂无摘要）'}
            </p>
          ) : (
            <p className="mt-4 text-[12px] leading-relaxed text-fg/30">
              短故事不分章：AI 会按 7 拍结构一次性写完整篇，开头即冲突，结尾必须闭合。生成后可在这里直接编辑。
            </p>
          )}
        </div>
        <div className="mt-3 text-center text-[11px] text-fg/20">
          想调整结构？到「结构」页重新生成 7 拍，再回这里重写全文。
        </div>
        {readerModal}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="text-[12px] text-fg/35">
          共 {chapters.length} 章 · 待写细纲 {pending.length} 章
        </div>
        <div className="flex-1" />
        <button className="btn-ghost btn-sm" onClick={() => void load()}>
          <RefreshCw size={13} /> 刷新
        </button>
        <button className="btn-ghost btn-sm" disabled={locked} onClick={() => void genOutlines()}>
          {busy === 'outline' ? <Loader2 size={13} className="animate-spin" /> : <ListPlus size={13} />} 生成 20 章细纲
        </button>
        <button className="btn-primary btn-sm" disabled={locked} onClick={() => void write()}>
          {locked && !busy ? <Loader2 size={13} className="animate-spin" /> : busy === 'write' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} 写下一章
        </button>
      </div>

      <div className="mb-3">
        <DeAiBatchPanel book={book} onChanged={onChanged} />
      </div>

      {chapters.length === 0 && pending.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<FileText size={40} />}
            title="还没有章节"
            desc="先生成细纲，或直接让 AI 写第一章。写作前会自动检索设定库与伏笔。"
            action={
              <button className="btn-primary" disabled={locked} onClick={() => void write()}>
                <Sparkles size={14} /> 生成第一章
              </button>
            }
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          {chapters.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-line/6 bg-fg/[0.02] px-4 py-3 text-left transition hover:border-accent/25 hover:bg-fg/[0.04]"
              onClick={() => void openReader(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void openReader(c.id)
                }
              }}
            >
              <div className="w-14 shrink-0 font-serif-cn text-[13px] text-fg/35">第 {c.chapterNo} 章</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-fg/85">{c.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-fg/25">
                  <StatusDot status={c.status} />
                  <span>{c.status === 'planned' && c.wordCount > 0 ? '中断草稿' : cnStatus(c.status)}</span>
                  <span>·</span>
                  <span>{c.wordCount} 字</span>
                  <span>·</span>
                  <span>{fmtTime(c.updatedAt)}</span>
                  {c.summary && (
                    <>
                      <span>·</span>
                      <span className="text-emerald-300/40">已入记忆库</span>
                    </>
                  )}
                  {(c.deaiDoneAt || 0) > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-sky-300/50">已去AI味</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="flex items-center gap-1 text-[11px] text-fg/25 transition group-hover:text-accent/80">
                  <BookOpen size={13} /> 阅读
                </span>
                <button
                  className="btn-ghost btn-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate('editor', { bookId: book.id, chapterId: c.id })
                  }}
                >
                  <PenLine size={12} /> 修改
                </button>
              </div>
            </div>
          ))}

          {pending.slice(0, 12).map((o) => (
            <div
              key={o.seq}
              className="flex items-center gap-3 rounded-xl border border-dashed border-line/8 px-4 py-3"
            >
              <div className="w-14 shrink-0 font-serif-cn text-[13px] text-fg/20">第 {o.seq} 章</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-fg/45">{o.title}（未写）</div>
                <div className="mt-0.5 line-clamp-1 text-[10.5px] text-fg/25">{o.beats.join(' / ') || o.goal}</div>
              </div>
              <button className="btn-ghost btn-sm" disabled={locked} onClick={() => void write(o.seq)}>
                {busy === `w${o.seq}` ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} 写这章
              </button>
            </div>
          ))}
          {pending.length > 12 && (
            <div className="py-2 text-center text-[11px] text-fg/25">还有 {pending.length - 12} 章细纲未展开…</div>
          )}
        </div>
      )}
      {readerModal}
    </div>
  )
}
