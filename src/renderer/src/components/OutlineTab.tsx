import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ListPlus, Loader2, RefreshCw, ScrollText } from 'lucide-react'
import type { Book, OutlineNode } from '@shared/types'
import { useApp } from '../store/useApp'
import { EmptyState } from './ui'

export default function OutlineTab({ book, onChanged }: { book: Book; onChanged: () => void }): React.ReactNode {
  const toast = useApp((s) => s.toast)
  const dataVersion = useApp((s) => s.dataVersion)
  const [nodes, setNodes] = useState<OutlineNode[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [expanded, setExpanded] = useState<Record<number, boolean>>({ 1: true })
  const [showChapters, setShowChapters] = useState(false)

  const load = useCallback(async () => {
    const list = await window.api.outline.list(book.id)
    setNodes(list)
    setLoading(false)
  }, [book.id])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const volumes = useMemo(() => nodes.filter((n) => n.level === 'volume').sort((a, b) => a.seq - b.seq), [nodes])
  const chapters = useMemo(() => nodes.filter((n) => n.level === 'chapter').sort((a, b) => a.seq - b.seq), [nodes])

  const regenVolumes = async (): Promise<void> => {
    if (!window.confirm('重新生成分卷大纲？现有卷纲会被覆盖（章节与正文不受影响）。')) return
    setBusy('volumes')
    try {
      const n = await window.api.books.generateVolumes(book.id)
      toast('success', `已生成 ${n} 卷大纲`)
      await load()
      onChanged()
    } catch (err) {
      toast('error', `生成失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const genChapters = async (): Promise<void> => {
    const last = chapters.length ? chapters[chapters.length - 1].seq : 0
    setBusy('chapters')
    try {
      const list = await window.api.chapters.generateOutlines(book.id, last + 1, 20)
      toast('success', `已生成 ${list.length} 章细纲`)
      await load()
      onChanged()
    } catch (err) {
      toast('error', `生成失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-mist-400">
        <Loader2 size={15} className="animate-spin" /> 加载大纲…
      </div>
    )
  }

  /* ---------------- 短故事：7 拍结构 ---------------- */
  if (book.workType === 'short') {
    const node = chapters.find((c) => c.seq === 1)
    const regen = async (): Promise<void> => {
      if (node && !window.confirm('重新生成故事结构？现有结构会被覆盖，正文不受影响。')) return
      setBusy('structure')
      try {
        await window.api.books.generateStructure(book.id)
        toast('success', '故事结构已更新')
        await load()
        onChanged()
      } catch (err) {
        toast('error', `生成失败：${(err as Error).message}`)
      } finally {
        setBusy('')
      }
    }
    return (
      <div className="mx-auto max-w-[900px] px-6 py-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="text-[12px] text-fg/35">{node ? `7 拍结构 · ${node.beats.length} 个节拍` : '尚未生成结构'}</div>
          <div className="flex-1" />
          <button className="btn-ghost btn-sm" onClick={() => void load()}>
            <RefreshCw size={13} /> 刷新
          </button>
          <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => void regen()}>
            {busy === 'structure' ? <Loader2 size={13} className="animate-spin" /> : <ScrollText size={13} />}
            {node ? '重新生成结构' : '生成故事结构'}
          </button>
        </div>

        {!node ? (
          <div className="panel">
            <EmptyState
              icon={<ScrollText size={40} />}
              title="还没有故事结构"
              desc="短故事采用 7 拍：常态 → 激励事件 → 第一次升级 → 中点反转 → 最低谷 → 高潮 → 结局。"
              action={
                <button className="btn-primary" disabled={!!busy} onClick={() => void regen()}>
                  <ScrollText size={14} /> 生成 7 拍结构
                </button>
              }
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="panel p-4">
              <div className="section-title mb-2">故事总览</div>
              <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-fg/55">{node.goal}</pre>
            </div>
            <div className="space-y-1.5">
              {node.beats.map((b, i) => {
                const idx = b.indexOf('：')
                const name = idx > 0 ? b.slice(0, idx) : `第 ${i + 1} 拍`
                const body = idx > 0 ? b.slice(idx + 1) : b
                return (
                  <div key={i} className="flex gap-3 rounded-xl border border-line/6 bg-fg/[0.02] px-3.5 py-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/12 text-[11px] text-accent">
                      {i + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12.5px] text-fg/80">{name}</div>
                      <div className="mt-0.5 text-[11.5px] leading-relaxed text-fg/40">{body}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div className="mt-4 text-center text-[11px] text-fg/20">
          短故事不分卷、不设章节钩子；结尾必须收束核心冲突。
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="text-[12px] text-fg/35">
          {volumes.length} 卷 · {chapters.length} 章细纲
        </div>
        <div className="flex-1" />
        <button className="btn-ghost btn-sm" onClick={() => void load()}>
          <RefreshCw size={13} /> 刷新
        </button>
        <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => void genChapters()}>
          {busy === 'chapters' ? <Loader2 size={13} className="animate-spin" /> : <ListPlus size={13} />} 续写细纲
        </button>
        <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => void regenVolumes()}>
          {busy === 'volumes' ? <Loader2 size={13} className="animate-spin" /> : <ScrollText size={13} />} 重新生成卷纲
        </button>
      </div>

      {volumes.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<ScrollText size={40} />}
            title="还没有分卷大纲"
            desc="AI 会按目标章节数拆卷，每卷给出核心矛盾、对手、卷末高潮与状态变化。"
            action={
              <button className="btn-primary" disabled={!!busy} onClick={() => void regenVolumes()}>
                <ScrollText size={14} /> 生成分卷大纲
              </button>
            }
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          {volumes.map((v) => {
            const range = `${v.beats[0] || '?'}-${v.beats[1] || '?'}`
            const inVol = chapters.filter((c) => c.seq >= Number(v.beats[0] || 0) && c.seq <= Number(v.beats[1] || 0))
            const open = expanded[v.seq]
            return (
              <div key={v.id || v.seq} className="overflow-hidden rounded-xl border border-line/7 bg-fg/[0.02]">
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-fg/[0.025]"
                  onClick={() => setExpanded({ ...expanded, [v.seq]: !open })}
                >
                  {open ? <ChevronDown size={14} className="text-fg/30" /> : <ChevronRight size={14} className="text-fg/30" />}
                  <div className="font-serif-cn text-[14px] text-fg/85">
                    第 {v.seq} 卷 · {v.title}
                  </div>
                  <div className="text-[10.5px] text-fg/25">
                    第 {range} 章 · {inVol.length} 章已有细纲
                  </div>
                </button>
                {open && (
                  <div className="border-t border-line/5 px-4 py-3">
                    <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-fg/50">{v.goal}</pre>
                    {inVol.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {inVol.slice(0, showChapters === false && inVol.length > 8 ? 8 : undefined).map((c) => (
                          <div key={c.seq} className="rounded-lg bg-fg/[0.035] px-3 py-2">
                            <div className="flex items-center gap-2 text-[12px] text-fg/70">
                              <span className="text-fg/30">第{c.seq}章</span> {c.title}
                              {c.status === 'done' && <span className="text-[10px] text-emerald-300/60">已写</span>}
                            </div>
                            {c.beats.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {c.beats.map((b, i) => (
                                  <li key={i} className="text-[11px] leading-relaxed text-fg/30">
                                    {i + 1}. {b}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {chapters.length > 0 && (
        <div className="mt-4 flex justify-center">
          <button className="btn-ghost btn-sm" onClick={() => setShowChapters(!showChapters)}>
            {showChapters ? '收起' : '展开'}全部章节细纲（{chapters.length}）
          </button>
        </div>
      )}
      {showChapters && (
        <div className="mt-3 space-y-1">
          {chapters.map((c) => (
            <div key={c.seq} className="rounded-lg border border-line/5 bg-fg/[0.015] px-3 py-2">
              <div className="text-[12px] text-fg/70">
                第{c.seq}章 {c.title}
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-fg/30">{c.beats.join(' / ')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
