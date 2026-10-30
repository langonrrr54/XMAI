import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ClipboardCopy,
  Loader2,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Wand2
} from 'lucide-react'
import type { Chapter, ConsistencyIssue } from '@shared/types'
import { useApp } from '../store/useApp'
import { Modal, Spinner } from '../components/ui'
import { cnStatus, fmtTime } from '../lib/format'

export default function ChapterEditor(): React.ReactNode {
  const chapterId = useApp((s) => s.chapterId)
  const bookId = useApp((s) => s.bookId)
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  const stream = useApp((s) => s.stream)
  const dataVersion = useApp((s) => s.dataVersion)
  const books = useApp((s) => s.books)
  const tasks = useApp((s) => s.tasks)
  // 本章正在跑的任务（主进程状态，切页回来仍可见）
  const chapterTasks = tasks.filter((x) => x.refId === chapterId)
  const runningTask = chapterTasks.find((x) => x.status === 'running')
  const runningKind = runningTask ? runningTask.kind : ''

  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [outline, setOutline] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [busy, setBusy] = useState<'' | 'rewrite' | 'check' | 'summary' | 'fix' | 'deai'>('')
  const [deAiOpen, setDeAiOpen] = useState(false)
  const [deAiText, setDeAiText] = useState('')
  const [deAiMeta, setDeAiMeta] = useState<{ before: number; after: number; changed: boolean } | null>(null)
  const [issues, setIssues] = useState<ConsistencyIssue[]>([])
  const [showIssues, setShowIssues] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [sideOpen, setSideOpen] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)
  const isShort = books.find((b) => b.id === (bookId || chapter?.bookId))?.workType === 'short'

  const load = useCallback(async () => {
    if (!chapterId) return
    const c = await window.api.chapters.get(chapterId)
    if (!c) return
    setChapter(c)
    setTitle(c.title)
    setContent(c.content)
    setOutline(c.outline)
    setDirty(false)
    setSavedAt(c.updatedAt)
  }, [chapterId])

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    // 有未保存修改时不因外部事件覆盖编辑器内容
    if (!dirtyRef.current) void load()
  }, [load, dataVersion])

  const save = useCallback(
    async (silent = false): Promise<boolean> => {
      if (!chapter) return false
      setSaving(true)
      try {
        // 保留已审校 / 已发布状态：只改正文时不该把 reviewed 降级成 drafted
        const keepStatus =
          chapter.status === 'published' ? 'published' : chapter.status === 'reviewed' ? 'reviewed' : 'drafted'
        const updated = await window.api.chapters.save(chapter.id, { title, content, outline, status: keepStatus })
        if (updated) setChapter(updated)
        setDirty(false)
        setSavedAt(Date.now())
        if (!silent) toast('success', '已保存')
        return true
      } catch (err) {
        toast('error', `保存失败：${(err as Error).message}`)
        return false
      } finally {
        setSaving(false)
      }
    },
    [chapter, title, content, outline, toast]
  )

  /** 审校 / 写入记忆 / 发布前先把编辑器里的最新内容落库，避免读到旧正文 */
  const flush = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true
    if (timer.current) clearTimeout(timer.current)
    return save(true)
  }, [save])

  useEffect(() => {
    if (!dirty) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(true), 1500)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [dirty, title, content, outline, save])

  // 切页 / 最小化 / 关闭窗口时，把未保存的改动立即落库（防抖期内返回不再丢字）
  const snapshot = useRef({ chapterId: '', title: '', content: '', outline: '' })
  snapshot.current = { chapterId: chapter?.id || '', title, content, outline }

  useEffect(() => {
    const flushDraft = (): void => {
      if (!dirtyRef.current) return
      const s = snapshot.current
      if (!s.chapterId) return
      dirtyRef.current = false
      // 切页兜底保存：同样保留审校/发布状态
      const keep =
        chapter?.status === 'published' ? 'published' : chapter?.status === 'reviewed' ? 'reviewed' : 'drafted'
      void window.api.chapters.save(s.chapterId, {
        title: s.title,
        content: s.content,
        outline: s.outline,
        status: keep
      })
    }
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flushDraft()
    }
    window.addEventListener('pagehide', flushDraft)
    window.addEventListener('beforeunload', flushDraft)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flushDraft)
      window.removeEventListener('beforeunload', flushDraft)
      document.removeEventListener('visibilitychange', onHide)
      flushDraft()
    }
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [save])

  const words = useMemo(() => content.replace(/\s+/g, '').length, [content])

  const doRewrite = async (): Promise<void> => {
    if (!chapter) return
    const tip = isShort ? '重写整篇短故事？当前全文会被覆盖。' : `重新生成第 ${chapter.chapterNo} 章？当前正文会被覆盖。`
    if (!window.confirm(tip)) return
    setBusy('rewrite')
    try {
      const res = await window.api.chapters.rewrite(chapter.bookId, chapter.chapterNo)
      setChapter(res.chapter)
      setTitle(res.chapter.title)
      setContent(res.chapter.content)
      setDirty(false)
      toast('success', `重写完成：${res.chapter.wordCount} 字`)
    } catch (err) {
      toast('error', `重写失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const doCheck = async (): Promise<void> => {
    if (!chapter) return
    if (!(await flush())) return
    setBusy('check')
    try {
      const found = await window.api.chapters.check(chapter.id)
      setIssues(found)
      setShowIssues(true)
      if (!found.length) toast('success', '未发现明显冲突，与设定库一致')
    } catch (err) {
      toast('error', `审校失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  /** 审校后一键自动修稿：按级别修改正文并写回编辑器，同时重新固化记忆 */
  const doFix = async (level: 'high' | 'medium'): Promise<void> => {
    if (!chapter) return
    const tip =
      level === 'medium'
        ? '将按审校结果自动修改正文（严重 + 中等），原文会被替换。继续？'
        : '将只按审校结果修改严重问题，原文会被替换。继续？'
    if (!window.confirm(tip)) return
    setBusy('fix')
    try {
      const res = await window.api.chapters.reviewFix(chapter.id, level)
      if (res.chapter) {
        setChapter(res.chapter)
        setTitle(res.chapter.title)
        setContent(res.chapter.content)
        setDirty(false)
        setSavedAt(res.chapter.updatedAt)
      }
      setIssues(res.issues)
      if (res.fixed) {
        toast('success', `已自动修稿：处理 ${res.fixedCount} 个问题，正文已更新`)
        setShowIssues(false)
      } else {
        toast(res.warning ? 'error' : 'info', res.warning || '没有需要修改的问题')
      }
    } catch (err) {
      toast('error', `自动修稿失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  // 已经处理过的任务 id，避免重复弹窗
  const consumedTask = useRef<string>('')

  /** 切页回来后，把主进程里已完成/失败的任务结果接回来 */
  useEffect(() => {
    if (!chapterId) return
    const finished = tasks
      .filter((x) => x.refId === chapterId && x.status !== 'running')
      .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
    const latest = finished[0]
    if (!latest || consumedTask.current === latest.id) return

    if (latest.kind === 'deai') {
      const payload = latest.result as
        | { text: string; changed: boolean; beforeLength: number; afterLength: number }
        | undefined
      if (latest.status === 'done' && payload && payload.text) {
        consumedTask.current = latest.id
        setDeAiText(payload.text)
        setDeAiMeta({
          before: payload.beforeLength,
          after: payload.afterLength,
          changed: payload.changed
        })
        setDeAiOpen(true)
        toast('info', '去AI味已完成，这是刚才的结果')
      }
    }

    if (latest.kind === 'review' || latest.kind === 'reviewFix') {
      const payload = latest.result as { issues?: ConsistencyIssue[] } | undefined
      if (latest.status === 'done' && payload && Array.isArray(payload.issues)) {
        consumedTask.current = latest.id
        setIssues(payload.issues)
        setShowIssues(true)
      }
    }
  }, [tasks, chapterId])

  /** 去 AI 味：只生成预览，不覆盖正文；用户确认后才采纳 */
  const doDeAi = async (): Promise<void> => {
    if (!chapter) return
    if (!(await flush())) return
    setBusy('deai')
    try {
      const res = await window.api.chapters.deAi(chapter.id)
      setDeAiText(res.text)
      setDeAiMeta({ before: res.beforeLength, after: res.afterLength, changed: res.changed })
      setDeAiOpen(true)
      if (!res.changed) toast('info', '模型返回内容异常，已保留原文供你对比')
    } catch (err) {
      toast('error', `去AI味失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const adoptDeAi = async (): Promise<void> => {
    if (!chapter || !deAiText) return
    setContent(deAiText)
    setDirty(true)
    setDeAiOpen(false)
    try {
      // 走专用接口：备份原稿 + 打「已去AI味」标记 + 重建记忆，一步完成
      const adopted = await window.api.chapters.deAiAdopt(chapter.id, deAiText)
      if (adopted.chapter) {
        setChapter(adopted.chapter)
        setSavedAt(adopted.chapter.updatedAt)
        setDirty(false)
        toast('success', '已采纳去AI味版本，原稿已备份，可回滚')
      }
    } catch (err) {
      toast('error', `保存失败：${(err as Error).message}`)
    }
  }

  const doSummary = async (): Promise<void> => {
    if (!chapter) return
    if (!(await flush())) return
    setBusy('summary')
    try {
      const updated = await window.api.chapters.summarize(chapter.id)
      if (updated) setChapter(updated)
      toast('success', '摘要与状态更新已写入记忆库')
    } catch (err) {
      toast('error', `摘要失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const doPublish = async (mode: 'api' | 'dom' | 'manual'): Promise<void> => {
    if (!chapter) return
    if (!(await flush())) return
    setPublishOpen(false)
    try {
      const res = await window.api.publish.publishChapter(chapter.bookId, chapter.id, mode)
      toast(res.job.status === 'success' ? 'success' : 'info', res.message)
      if (res.job.status === 'success') {
        const c = await window.api.chapters.get(chapter.id)
        if (c) setChapter(c)
      }
    } catch (err) {
      toast('error', `发布失败：${(err as Error).message}`)
    }
  }

  if (!chapter) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-mist-400">
        <Spinner /> 正在加载章节…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line/6 bg-app/80 px-5 py-3 backdrop-blur">
        <button className="btn-ghost btn-sm" onClick={() => navigate('book', { bookId: bookId || chapter.bookId })}>
          <ArrowLeft size={14} /> 返回
        </button>
        <div className="min-w-0 flex-1">
          <input
            className="w-full max-w-2xl truncate border-0 bg-transparent font-serif-cn text-[17px] font-semibold text-fg outline-none placeholder:text-fg/20"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setDirty(true)
            }}
          />
          <div className="mt-0.5 flex items-center gap-2.5 text-[10.5px] text-fg/30">
            <span>{isShort ? '短故事 · 全文' : `第 ${chapter.chapterNo} 章`}</span>
            <span>·</span>
            <span>{words} 字</span>
            <span>·</span>
            <span>{cnStatus(chapter.status)}</span>
            <span>·</span>
            <span>{saving ? '保存中…' : dirty ? '有未保存修改' : `已保存 ${fmtTime(savedAt)}`}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className="btn-ghost btn-sm"
            disabled={!!busy || !!runningTask}
            onClick={() => void doDeAi()}
            title={runningKind === 'deai' ? '正在去AI味…' : '改写表达手法，不改情节'}
          >
            {runningKind === 'deai' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            {runningKind === 'deai' ? `去AI味 ${runningTask?.progress ?? 0}%` : '去AI味'}
          </button>
          <button className="btn-ghost btn-sm" disabled={!!busy || !!runningTask} onClick={() => void doCheck()}>
            {runningKind === 'review' || runningKind === 'reviewFix' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ShieldCheck size={13} />
            )}
            {runningKind === 'review' || runningKind === 'reviewFix' ? '审校中…' : '审校'}
          </button>
          <button className="btn-ghost btn-sm" disabled={!!busy || !!runningTask} onClick={() => void doSummary()}>
            {runningKind === 'summary' ? <Loader2 size={13} className="animate-spin" /> : <StickyNote size={13} />}
            {runningKind === 'summary' ? '写入中…' : '写入记忆'}
          </button>
          <button className="btn-ghost btn-sm" disabled={!!busy || !!runningTask} onClick={() => void doRewrite()}>
            {runningKind === 'rewrite' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {runningKind === 'rewrite' ? '重写中…' : '重写'}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => void save()}>
            <Save size={13} /> 保存
          </button>
          <button className="btn-primary btn-sm" onClick={() => setPublishOpen(true)}>
            <Send size={13} /> 发布
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-8 py-8">
            <textarea
              className="novel-editor min-h-[70vh] w-full resize-none border-0 bg-transparent text-fg/90 outline-none placeholder:text-fg/15"
              placeholder="正文为空。可以点右上角「重写」让 AI 生成，或直接手写。"
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                setDirty(true)
              }}
              spellCheck={false}
            />
            {stream && (
              <div className="mt-4 rounded-xl border border-accent/20 bg-accent/[0.04] p-3">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-accent/80">
                  <Sparkles size={12} /> AI 正在输出…
                </div>
                <div className="max-h-40 overflow-hidden font-serif-cn text-[12.5px] leading-relaxed text-fg/45">{stream.slice(-400)}</div>
              </div>
            )}
          </div>
        </div>

        <aside className={`shrink-0 border-l border-line/6 bg-app/60 transition-all ${sideOpen ? 'w-[320px]' : 'w-[46px]'}`}>
          <button
            className="flex w-full items-center justify-center gap-1 border-b border-line/6 py-2.5 text-[11px] text-fg/30 hover:text-fg/70"
            onClick={() => setSideOpen(!sideOpen)}
          >
            {sideOpen ? '收起' : '展开'}
          </button>
          {sideOpen && (
            <div className="scroll-area h-[calc(100%-40px)] space-y-4 p-4">
              <section>
                <div className="section-title mb-2 text-[13px]">{isShort ? '故事结构' : '本章细纲'}</div>
                <textarea
                  className="textarea min-h-[140px] text-[12px] leading-relaxed"
                  value={outline}
                  onChange={(e) => {
                    setOutline(e.target.value)
                    setDirty(true)
                  }}
                  placeholder="细纲为空。重新生成或手动补充。"
                />
              </section>

              <section>
                <div className="section-title mb-2 text-[13px]">记忆摘要</div>
                {chapter.summary ? (
                  <p className="rounded-lg border border-line/6 bg-fg/[0.02] p-2.5 text-[12px] leading-relaxed text-fg/55">
                    {chapter.summary}
                  </p>
                ) : (
                  <p className="text-[11.5px] text-fg/25">尚未生成。点顶部「写入记忆」让 AI 生成摘要、关键事件与状态更新。</p>
                )}
                {chapter.keyEvents.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {chapter.keyEvents.map((k, i) => (
                      <li key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed text-fg/45">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent/60" />
                        {k}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <div className="section-title mb-2 text-[13px]">操作</div>
                <div className="space-y-1.5">
                  <button
                    className="btn-ghost btn-sm w-full justify-start"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(`${isShort ? '' : `第${chapter.chapterNo}章 `}${title}\n\n${content}`)
                        .then(() => toast('success', '已复制到剪贴板'))
                    }
                  >
                    <ClipboardCopy size={13} /> 复制全文
                  </button>
                  <button className="btn-ghost btn-sm w-full justify-start" onClick={() => void doPublish('dom')}>
                    <Sparkles size={13} /> 填入番茄编辑器
                  </button>
                  <button className="btn-ghost btn-sm w-full justify-start" onClick={() => void doPublish('manual')}>
                    <ClipboardCopy size={13} /> 复制并打开后台
                  </button>
                </div>
              </section>

              <section className="text-[10.5px] leading-relaxed text-fg/20">
                创建 {fmtTime(chapter.createdAt)}
                <br />
                更新 {fmtTime(chapter.updatedAt)}
              </section>
            </div>
          )}
        </aside>
      </div>

      <Modal
        open={deAiOpen}
        title="去AI味 · 改写预览"
        subtitle={deAiMeta ? `原文 ${deAiMeta.before} 字 → 改写 ${deAiMeta.after} 字` : ''}
        onClose={() => setDeAiOpen(false)}
        width="max-w-3xl"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setDeAiOpen(false)}>
              取消
            </button>
            <button className="btn-ghost" onClick={() => void navigator.clipboard.writeText(deAiText).then(() => toast('success', '已复制改写稿'))}>
              <ClipboardCopy size={14} /> 复制改写稿
            </button>
            <button className="btn-primary" onClick={() => void adoptDeAi()}>
              <Check size={14} /> 采纳并保存
            </button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] text-fg/35">原文</div>
            <div className="max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line/8 bg-fg/[0.02] p-3 font-serif-cn text-[13px] leading-[1.9] text-fg/55">
              {content}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] text-accent/70">改写后</div>
            <div className="max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-accent/25 bg-accent/[0.04] p-3 font-serif-cn text-[13px] leading-[1.9] text-fg/85">
              {deAiText}
            </div>
          </div>
        </div>
        <p className="mt-3 text-[10.5px] leading-relaxed text-fg/25">
          只改表达手法，不动情节、人名与设定。采纳前原文不会被覆盖，取消即丢弃。
        </p>
      </Modal>

      <Modal
        open={showIssues}
        title="一致性审校结果"
        subtitle={`共 ${issues.length} 条`}
        onClose={() => setShowIssues(false)}
        width="max-w-2xl"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowIssues(false)}>
              <Check size={14} /> 知道了
            </button>
            {issues.length > 0 && (
              <>
                <button className="btn-ghost" disabled={!!busy} onClick={() => void doFix('high')}>
                  {busy === 'fix' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} 只修严重
                </button>
                <button className="btn-primary" disabled={!!busy} onClick={() => void doFix('medium')}>
                  {busy === 'fix' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} 一键自动修稿
                </button>
              </>
            )}
          </>
        }
      >
        {issues.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-emerald-300/80">未发现设定冲突、时间线错乱或人物崩坏。</p>
        ) : (
          <div className="space-y-2.5">
            {issues.map((i, idx) => (
              <div key={idx} className="rounded-xl border border-line/8 bg-fg/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      i.severity === 'high' ? 'bg-red-500/15 text-red-300' : i.severity === 'medium' ? 'bg-accent/15 text-accent' : 'bg-fg/8 text-fg/50'
                    }`}
                  >
                    {i.severity === 'high' ? '严重' : i.severity === 'medium' ? '中等' : '轻微'}
                  </span>
                  <span className="text-[11px] text-fg/35">{i.type}</span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg/80">{i.description}</p>
                {i.evidence && <p className="mt-1 text-[11.5px] leading-relaxed text-fg/35">证据：{i.evidence}</p>}
                {i.suggestion && <p className="mt-1 text-[11.5px] leading-relaxed text-emerald-300/60">建议：{i.suggestion}</p>}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={publishOpen}
        title="发布到番茄小说"
        subtitle="三种模式，任选其一"
        onClose={() => setPublishOpen(false)}
        width="max-w-lg"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setPublishOpen(false)}>
              取消
            </button>
            <button className="btn-primary" disabled={!!busy} onClick={() => void save()}>
              保存后再发布
            </button>
          </>
        }
      >
        <div className="space-y-2.5">
          <button className="w-full rounded-xl border border-line/8 bg-fg/[0.02] p-3.5 text-left hover:border-accent/40" onClick={() => void doPublish('api')}>
            <div className="text-[13px] font-medium text-fg">接口直发（推荐）</div>
            <div className="mt-1 text-[11.5px] leading-relaxed text-fg/40">复用你录制过的发布接口，自动建草稿→存正文→发布，全程无需点页面。</div>
          </button>
          <button className="w-full rounded-xl border border-line/8 bg-fg/[0.02] p-3.5 text-left hover:border-accent/40" onClick={() => void doPublish('dom')}>
            <div className="text-[13px] font-medium text-fg">页面自动化</div>
            <div className="mt-1 text-[11.5px] leading-relaxed text-fg/40">打开内置后台，自动定位标题框与正文编辑器写入内容，可自动点发布。</div>
          </button>
          <button className="w-full rounded-xl border border-line/8 bg-fg/[0.02] p-3.5 text-left hover:border-accent/40" onClick={() => void doPublish('manual')}>
            <div className="text-[13px] font-medium text-fg">复制 + 人工确认</div>
            <div className="mt-1 text-[11.5px] leading-relaxed text-fg/40">复制正文到剪贴板并打开后台，由你粘贴发布，最稳妥。</div>
          </button>
        </div>
      </Modal>
    </div>
  )
}
