import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import type { Book, Chapter } from '@shared/types'
import { useApp } from '../store/useApp'
import { Modal, StatusDot } from './ui'
import { fmtTime } from '../lib/format'

const TODAY_START = (): number => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

type Filter = 'today' | 'pending' | 'done' | 'all'

export default function DeAiBatchPanel({
  book,
  onChanged
}: {
  book: Book
  onChanged: () => void
}): React.ReactNode {
  const toast = useApp((s) => s.toast)
  const tasks = useApp((s) => s.tasks)
  const dataVersion = useApp((s) => s.dataVersion)

  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('today')
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState(false)

  const running = tasks.find((t) => t.kind === 'deai' && t.status === 'running' && t.refId === book.id)

  const load = useCallback(async () => {
    const list = await window.api.chapters.list(book.id, true)
    const written = list.filter((c) => c.content.trim() && c.status !== 'planned')
    setChapters(written)
  }, [book.id])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const todayStart = useMemo(() => TODAY_START(), [])

  const groups = useMemo(() => {
    const done = chapters.filter((c) => (c.deaiDoneAt || 0) > 0)
    const pending = chapters.filter((c) => (c.deaiDoneAt || 0) === 0)
    // 「今天写的」按最后修改时间算：今天续写的老章节也算今天
    const today = pending.filter((c) => c.updatedAt >= todayStart)
    const older = pending.filter((c) => c.updatedAt < todayStart)
    return { done, pending, today, older }
  }, [chapters, todayStart])

  const visible = useMemo(() => {
    if (filter === 'today') return groups.today
    if (filter === 'pending') return groups.pending
    if (filter === 'done') return groups.done
    return chapters
  }, [filter, groups, chapters])

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisible = (): void => {
    setSelected(new Set(visible.map((c) => c.id)))
  }

  const clearSelection = (): void => setSelected(new Set())

  const runBatch = async (ids: string[]): Promise<void> => {
    if (!ids.length) return
    setBusy('batch')
    try {
      const res = await window.api.chapters.deAiBatch(book.id, { limit: ids.length })
      if (res.processed) toast('success', `批量去AI味完成：${res.processed} 章${res.failed ? `，失败 ${res.failed} 章` : ''}`)
      else toast('info', res.message)
      setSelected(new Set())
      await load()
      onChanged()
    } catch (err) {
      toast('error', `批量失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const runOne = async (id: string): Promise<void> => {
    setBusy(id)
    try {
      const preview = await window.api.chapters.deAi(id)
      const adopted = await window.api.chapters.deAiAdopt(id, preview.text)
      if (adopted.chapter) toast('success', `第 ${adopted.chapter.chapterNo} 章已去AI味`)
      await load()
      onChanged()
    } catch (err) {
      toast('error', `处理失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const rollback = async (id: string): Promise<void> => {
    if (!window.confirm('恢复这一章去AI味之前的原稿？当前改写会被覆盖。')) return
    setBusy(id)
    try {
      const r = await window.api.chapters.deAiRollback(id)
      toast('success', `第 ${r.chapter?.chapterNo ?? ''} 章已回滚到原稿`)
      await load()
      onChanged()
    } catch (err) {
      toast('error', `回滚失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const FILTERS: { key: Filter; label: string; count: number }[] = [
    { key: 'today', label: '今天写的', count: groups.today.length },
    { key: 'pending', label: '全部未处理', count: groups.pending.length },
    { key: 'done', label: '已去AI味', count: groups.done.length },
    { key: 'all', label: '全部章节', count: chapters.length }
  ]

  return (
    <>
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="section-title flex items-center gap-1.5">
            <Sparkles size={14} /> 批量去AI味
          </div>
          <div className="text-[10.5px] text-fg/25">
            已处理 {groups.done.length} 章 · 未处理 {groups.pending.length} 章（今天写的 {groups.today.length} 章）
          </div>
          <div className="flex-1" />
          {running ? (
            <span className="flex items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 px-2.5 py-1 text-[11px] text-accent">
              <Loader2 size={12} className="animate-spin" />
              正在跑 {running.progress}% · {running.detail}
            </span>
          ) : (
            <>
              <button
                className="btn-ghost btn-sm"
                disabled={!!busy || !groups.today.length}
                onClick={() => void runBatch(groups.today.map((c) => c.id))}
              >
                处理今天的 {groups.today.length} 章
              </button>
              <button
                className="btn-primary btn-sm"
                disabled={!!busy || !groups.pending.length}
                onClick={() => void runBatch(groups.pending.map((c) => c.id))}
              >
                处理全部未处理 {groups.pending.length} 章
              </button>
            </>
          )}
          <button className="btn-ghost btn-sm" onClick={() => setOpen(true)}>
            选择章节
          </button>
        </div>

        <p className="mt-2 text-[10.5px] leading-relaxed text-fg/30">
          只会处理「未去AI味」的章节。已处理过的章节会打标记，下次批量自动跳过——所以今天 20 章、明天新增 10 章，
          点批量只会跑新的 10 章。需要重跑已处理章节时，在「选择章节」里手动勾选。
        </p>
      </div>

      <Modal
        open={open}
        title="选择要处理的章节"
        subtitle={`已选 ${selected.size} 章 · 未处理 ${groups.pending.length} 章 · 已处理 ${groups.done.length} 章`}
        onClose={() => setOpen(false)}
        width="max-w-3xl"
        footer={
          <>
            <button className="btn-ghost" onClick={clearSelection}>
              清空选择
            </button>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              <X size={14} /> 关闭
            </button>
            <button
              className="btn-primary"
              disabled={!!busy || !selected.size}
              onClick={() => {
                const ids = Array.from(selected)
                setOpen(false)
                void runBatch(ids)
              }}
            >
              <Check size={14} /> 处理选中的 {selected.size} 章
            </button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                filter === f.key
                  ? 'border-accent/50 bg-accent/12 text-accent'
                  : 'border-line/8 bg-fg/[0.03] text-fg/50 hover:text-fg'
              }`}
              onClick={() => setFilter(f.key)}
            >
              {f.label} ({f.count})
            </button>
          ))}
          <div className="flex-1" />
          <button className="btn-ghost btn-sm" onClick={selectAllVisible}>
            全选当前列表
          </button>
        </div>

        <div className="max-h-[52vh] space-y-1.5 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-fg/30">
              {filter === 'today' ? '今天还没有新写的章节' : '这个分类下没有章节'}
            </p>
          ) : (
            visible.map((c) => {
              const done = (c.deaiDoneAt || 0) > 0
              const isToday = c.updatedAt >= todayStart
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition ${
                    selected.has(c.id)
                      ? 'border-accent/40 bg-accent/[0.06]'
                      : 'border-line/6 bg-fg/[0.02] hover:border-line/12'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--color-accent)]"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span className="w-12 shrink-0 font-serif-cn text-[12px] text-fg/35">第 {c.chapterNo} 章</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-fg/80">{c.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-fg/25">
                      <StatusDot status={c.status} />
                      <span>{c.wordCount} 字</span>
                      <span>·</span>
                      <span>{fmtTime(c.updatedAt)}</span>
                      {isToday && <span className="rounded bg-accent/12 px-1 text-accent/80">今天</span>}
                    </div>
                  </div>
                  {done ? (
                    <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      <CheckCircle2 size={10} /> 已去AI味
                    </span>
                  ) : (
                    <span className="shrink-0 rounded bg-fg/8 px-1.5 py-0.5 text-[10px] text-fg/45">未处理</span>
                  )}
                  {done ? (
                    <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => void rollback(c.id)}>
                      <RotateCcw size={11} /> 回滚
                    </button>
                  ) : (
                    <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => void runOne(c.id)}>
                      {busy === c.id ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} 处理
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </Modal>
    </>
  )
}