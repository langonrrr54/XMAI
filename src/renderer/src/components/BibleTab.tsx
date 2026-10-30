import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, Loader2, Lock, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { BibleEntry, BibleKind, Book } from '@shared/types'
import { useApp } from '../store/useApp'
import { EmptyState, Field, Modal, Spinner } from './ui'
import { cnKind, fmtTime } from '../lib/format'

const KINDS: BibleKind[] = ['world', 'power', 'rule', 'character', 'faction', 'location', 'item', 'timeline']

const emptyDraft = (bookId: string): BibleEntry => ({
  id: '',
  bookId,
  kind: 'character',
  name: '',
  content: '',
  state: {},
  importance: 3,
  locked: false,
  updatedAt: 0,
  lastChapterNo: 0
})

export default function BibleTab({ book, onChanged }: { book: Book; onChanged: () => void }): React.ReactNode {
  const toast = useApp((s) => s.toast)
  const dataVersion = useApp((s) => s.dataVersion)
  const [entries, setEntries] = useState<BibleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | BibleKind>('all')
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<BibleEntry | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setEntries(await window.api.bible.list(book.id))
    setLoading(false)
  }, [book.id])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (filter === 'all' || e.kind === filter) &&
          (!q.trim() || e.name.includes(q) || e.content.includes(q) || JSON.stringify(e.state).includes(q))
      ),
    [entries, filter, q]
  )

  const save = async (): Promise<void> => {
    if (!draft?.name.trim()) {
      toast('error', '名称不能为空')
      return
    }
    try {
      const list = await window.api.bible.save({
        id: draft.id || undefined,
        bookId: book.id,
        kind: draft.kind,
        name: draft.name.trim(),
        content: draft.content,
        state: draft.state,
        importance: draft.importance,
        locked: draft.locked
      })
      setEntries(list)
      setDraft(null)
      toast('success', '设定已保存')
      onChanged()
    } catch (err) {
      toast('error', `保存失败：${(err as Error).message}`)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('删除这条设定？')) return
    await window.api.bible.remove(id)
    await load()
    onChanged()
  }

  const regenerate = async (): Promise<void> => {
    if (!window.confirm('重新生成设定库会覆盖同名条目，确定继续？（建议先备份）')) return
    setBusy('regen')
    try {
      const n = await window.api.books.generateBible(book.id)
      toast('success', `设定库已重建：${n} 条`)
      await load()
      onChanged()
    } catch (err) {
      toast('error', `重建失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-mist-400">
        <Spinner /> 加载设定库…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/25" />
          <input className="input w-56 py-1.5 pl-8 text-[12px]" placeholder="搜索设定 / 状态" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-36 py-1.5 text-[12px]" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | BibleKind)}>
          <option value="all">全部类型</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {cnKind(k)}
            </option>
          ))}
        </select>
        <div className="text-[11.5px] text-fg/25">
          {filtered.length} / {entries.length} 条
        </div>
        <div className="flex-1" />
        <button className="btn-ghost btn-sm" onClick={() => void load()}>
          <RefreshCw size={13} /> 刷新
        </button>
        <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => void regenerate()}>
          {busy === 'regen' ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />} AI 重建
        </button>
        <button className="btn-primary btn-sm" onClick={() => setDraft(emptyDraft(book.id))}>
          <Plus size={13} /> 新增设定
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Brain size={40} />}
            title="设定库为空"
            desc="设定库是长篇不崩的基石：世界观、力量体系、人物状态、势力、道具都在这里，写作时会自动注入。"
            action={
              <button className="btn-primary" disabled={!!busy} onClick={() => void regenerate()}>
                <Brain size={14} /> 让 AI 生成设定库
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {filtered.map((e) => (
            <div key={e.id} className="group rounded-xl border border-line/7 bg-fg/[0.02] p-3.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-serif-cn text-[14px] text-fg/90">{e.name}</span>
                    <span className="tag">{cnKind(e.kind)}</span>
                    {e.locked && (
                      <span className="flex items-center gap-0.5 text-[10px] text-accent/70">
                        <Lock size={9} /> 锁定
                      </span>
                    )}
                    {e.importance >= 5 && <span className="text-[10px] text-red-300/60">核心</span>}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-fg/50">{e.content}</p>
                  {Object.keys(e.state || {}).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(e.state).map(([k, v]) => (
                        <span key={k} className="tag">
                          {k}: {String(v).slice(0, 24)}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-[10px] text-fg/20">
                    更新至第 {e.lastChapterNo || 0} 章 · {fmtTime(e.updatedAt)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button className="rounded p-1 text-fg/40 hover:bg-fg/10 hover:text-fg" onClick={() => setDraft({ ...e })}>
                    <Pencil size={12} />
                  </button>
                  <button className="rounded p-1 text-fg/40 hover:bg-red-500/15 hover:text-red-300" onClick={() => void remove(e.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!draft}
        title={draft?.id ? '编辑设定' : '新增设定'}
        onClose={() => setDraft(null)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setDraft(null)}>
              取消
            </button>
            <button className="btn-primary" onClick={() => void save()}>
              保存
            </button>
          </>
        }
      >
        {draft && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="类型">
                <select className="input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as BibleKind })}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {cnKind(k)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="名称">
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
            </div>
            <Field label="内容" hint="人物请写：身份、欲望、弱点、说话习惯、关系">
              <textarea className="textarea min-h-[140px]" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="重要度 1-5" hint="5 = 每章必注入">
                <input
                  type="number"
                  min={1}
                  max={5}
                  className="input"
                  value={draft.importance}
                  onChange={(e) => setDraft({ ...draft, importance: Number(e.target.value) })}
                />
              </Field>
              <Field label="状态（JSON，可选）" hint='例：{"等级":"炼气三层","位置":"青云城"}'>
                <input
                  className="input font-mono text-[11px]"
                  value={JSON.stringify(draft.state || {})}
                  onChange={(e) => {
                    try {
                      setDraft({ ...draft, state: JSON.parse(e.target.value || '{}') })
                    } catch {
                      /* 输入中忽略 */
                    }
                  }}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-fg/65">
              <input type="checkbox" className="accent-[var(--color-accent)]" checked={draft.locked} onChange={(e) => setDraft({ ...draft, locked: e.target.checked })} />
              锁定（视为不可违背的硬设定，每章强制注入）
            </label>
          </div>
        )}
      </Modal>
    </div>
  )
}
