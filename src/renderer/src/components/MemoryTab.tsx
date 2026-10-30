import { useCallback, useEffect, useState } from 'react'
import { BookmarkCheck, Database, Loader2, Plus, Search, Sparkles, Wand2 } from 'lucide-react'
import type { Book, Foreshadowing, MemoryOverview, StyleProfile, VolumeSummary } from '@shared/types'
import { useApp } from '../store/useApp'
import { EmptyState, Field, Modal, Spinner, Stat } from './ui'
import { cnStatus, fmtTime, fmtWords } from '../lib/format'

interface Hit {
  refType: string
  refId: string
  chapterNo: number
  title: string
  text: string
  score: number
  sources: string[]
}

export default function MemoryTab({
  book,
  onChanged,
  overview
}: {
  book: Book
  onChanged: () => void
  overview: MemoryOverview | null
}): React.ReactNode {
  const toast = useApp((s) => s.toast)
  const dataVersion = useApp((s) => s.dataVersion)
  const [fs, setFs] = useState<Foreshadowing[]>([])
  const [volumes, setVolumes] = useState<VolumeSummary[]>([])
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [fsDraft, setFsDraft] = useState<{ name: string; note: string; planted: number; resolve: number } | null>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const [sample, setSample] = useState('')
  const [styleBusy, setStyleBusy] = useState(false)
  const [style, setStyle] = useState<StyleProfile | null>(book.styleProfile)

  const load = useCallback(async () => {
    const [f, v] = await Promise.all([window.api.memory.foreshadowing(book.id), window.api.memory.volumes(book.id)])
    setFs(f)
    setVolumes(v)
  }, [book.id])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const search = async (): Promise<void> => {
    if (!q.trim()) return
    setSearching(true)
    try {
      setHits((await window.api.memory.search(book.id, q.trim())) as Hit[])
    } catch (err) {
      toast('error', `检索失败：${(err as Error).message}`)
    } finally {
      setSearching(false)
    }
  }

  const rebuild = async (): Promise<void> => {
    setRebuilding(true)
    try {
      const n = await window.api.memory.rebuild(book.id)
      toast('success', `已重建 ${n} 章的记忆索引`)
      onChanged()
    } catch (err) {
      toast('error', `重建失败：${(err as Error).message}`)
    } finally {
      setRebuilding(false)
    }
  }

  const addFs = async (): Promise<void> => {
    if (!fsDraft?.name.trim()) return
    try {
      const list = await window.api.memory.addForeshadowing({
        bookId: book.id,
        name: fsDraft.name.trim(),
        note: fsDraft.note,
        plantedChapterNo: fsDraft.planted,
        resolveByChapterNo: fsDraft.resolve
      })
      setFs(list)
      setFsDraft(null)
      toast('success', '伏笔已记录')
    } catch (err) {
      toast('error', `保存失败：${(err as Error).message}`)
    }
  }

  const resolveFs = async (name: string): Promise<void> => {
    const list = await window.api.memory.resolveForeshadowing(book.id, name)
    setFs(list)
    toast('success', `「${name}」已标记回收`)
  }

  const extract = async (): Promise<void> => {
    if (sample.trim().length < 100) {
      toast('error', '样章至少 100 字，建议 800~3000 字')
      return
    }
    setStyleBusy(true)
    try {
      const s = await window.api.memory.extractStyle(sample)
      if (!s) throw new Error('模型未返回有效结果')
      setStyle(s)
      await window.api.books.update(book.id, { styleProfile: s })
      toast('success', '文风卡已保存，后续章节将按此风格生成')
      onChanged()
    } catch (err) {
      toast('error', `提取失败：${(err as Error).message}`)
    } finally {
      setStyleBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={overview?.chapterCount ?? 0} label="已索引章节" />
        <Stat value={overview?.vectorCount ?? 0} label="记忆向量" />
        <Stat value={`${overview?.openForeshadowing ?? 0}`} label="待回收伏笔" />
        <Stat value={fmtWords(overview?.wordCount ?? 0)} label="总字数" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="panel p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="section-title">长程记忆检索</div>
            <button className="btn-ghost btn-sm" disabled={rebuilding} onClick={() => void rebuild()}>
              {rebuilding ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />} 重建索引
            </button>
          </div>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="比如：主角第一次见到师父时发生了什么？"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
            />
            <button className="btn-primary btn-sm shrink-0" disabled={searching} onClick={() => void search()}>
              {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} 检索
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {hits.length === 0 ? (
              <p className="py-6 text-center text-[11.5px] text-fg/25">
                混合检索会同时跑关键词（BM25）与向量相似度，命中的旧情节会按相关度排序。
              </p>
            ) : (
              hits.map((h) => (
                <div key={`${h.refType}-${h.refId}`} className="rounded-lg border border-line/6 bg-fg/[0.02] p-2.5">
                  <div className="flex items-center gap-2 text-[11.5px] text-fg/70">
                    <span className="text-accent/80">{h.refType === 'chapter' ? `第${h.chapterNo}章` : '设定'}</span>
                    <span className="truncate">{h.title}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-fg/25">{h.score.toFixed(3)}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-fg/40">{h.text}</p>
                  <div className="mt-1 text-[9.5px] text-fg/20">{h.sources.join(' · ')}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="section-title">伏笔台账</div>
              <button className="btn-ghost btn-sm" onClick={() => setFsDraft({ name: '', note: '', planted: 0, resolve: 0 })}>
                <Plus size={12} /> 记录伏笔
              </button>
            </div>
            {fs.length === 0 ? (
              <p className="py-4 text-center text-[11.5px] text-fg/25">AI 会在写作时自动登记新伏笔，也可以手动补录。</p>
            ) : (
              <div className="space-y-1.5">
                {fs.map((f) => (
                  <div key={f.id} className="flex items-start gap-2 rounded-lg border border-line/6 bg-fg/[0.02] px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[12px] text-fg/75">
                        {f.status === 'open' ? <Sparkles size={11} className="text-accent/70" /> : <BookmarkCheck size={11} className="text-emerald-400/70" />}
                        <span className="truncate">{f.name}</span>
                        <span className="text-[10px] text-fg/25">{cnStatus(f.status)}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-fg/25">
                        第{f.plantedChapterNo || '?'}章埋 · 计划第{f.resolveByChapterNo || '?'}章前回收
                        {f.note ? ` · ${f.note}` : ''}
                      </div>
                    </div>
                    {f.status === 'open' && (
                      <button className="shrink-0 text-[10px] text-emerald-300/60 hover:text-emerald-300" onClick={() => void resolveFs(f.name)}>
                        标记回收
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="section-title">文风卡</div>
              <button
                className="btn-ghost btn-sm"
                onClick={() => {
                  setSample('')
                  setStyleOpen(true)
                }}
              >
                <Wand2 size={12} /> 样章提取
              </button>
            </div>
            {style ? (
              <div className="space-y-1 text-[11.5px] leading-relaxed text-fg/55">
                <div>基调：{style.tone}</div>
                <div>视角：{style.pov}</div>
                <div>句式：{style.sentence}</div>
                <div>对白：{style.dialogue}</div>
                <div>节奏：{style.pacing}</div>
                {style.taboos.length > 0 && <div>禁忌：{style.taboos.join('、')}</div>}
              </div>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-fg/25">
                贴一段你满意的样章，AI 会提取基调、句式、对白与节奏，作为后续章节的写作约束。
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="panel mt-4 p-4">
        <div className="section-title mb-2.5">分卷摘要（全书压缩史）</div>
        {volumes.length === 0 ? (
          <p className="text-[11.5px] text-fg/25">每写完 10 章会自动汇总本卷摘要，用于跨越数百章后的上下文回忆。</p>
        ) : (
          <div className="space-y-2">
            {volumes.map((v) => (
              <div key={v.volumeNo} className="rounded-lg border border-line/6 bg-fg/[0.02] p-3">
                <div className="mb-1 flex items-center justify-between text-[11.5px] text-fg/60">
                  <span>第 {v.volumeNo} 卷</span>
                  <span className="text-[10px] text-fg/20">{fmtTime(v.updatedAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-fg/40">{v.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={!!fsDraft}
        title="记录伏笔"
        onClose={() => setFsDraft(null)}
        width="max-w-lg"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setFsDraft(null)}>
              取消
            </button>
            <button className="btn-primary" onClick={() => void addFs()}>
              保存
            </button>
          </>
        }
      >
        {fsDraft && (
          <div className="space-y-3">
            <Field label="伏笔名称">
              <input className="input" value={fsDraft.name} onChange={(e) => setFsDraft({ ...fsDraft, name: e.target.value })} />
            </Field>
            <Field label="说明">
              <textarea className="textarea min-h-[80px]" value={fsDraft.note} onChange={(e) => setFsDraft({ ...fsDraft, note: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="埋设章号">
                <input type="number" className="input" value={fsDraft.planted} onChange={(e) => setFsDraft({ ...fsDraft, planted: Number(e.target.value) })} />
              </Field>
              <Field label="计划回收章号">
                <input type="number" className="input" value={fsDraft.resolve} onChange={(e) => setFsDraft({ ...fsDraft, resolve: Number(e.target.value) })} />
              </Field>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={styleOpen}
        title="从样章提取文风"
        subtitle="建议粘贴 800~3000 字你认可的文风样本"
        onClose={() => setStyleOpen(false)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setStyleOpen(false)}>
              取消
            </button>
            <button className="btn-primary" disabled={styleBusy} onClick={() => void extract()}>
              {styleBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} 提取并保存
            </button>
          </>
        }
      >
        <textarea
          className="textarea min-h-[260px] font-serif-cn text-[13px]"
          placeholder="粘贴样章…"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
      </Modal>
    </div>
  )
}
