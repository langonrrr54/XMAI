import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Download,
  ExternalLink,
  FileCode2,
  Globe,
  Loader2,
  LogIn,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud
} from 'lucide-react'
import type { Book, CapturedRequest, Chapter, FanqieTagPick, PublishJob } from '@shared/types'
import { useApp } from '../store/useApp'
import { EmptyState, Field, Modal, Spinner, StatusDot } from './ui'
import { cnRole, cnStatus, fmtTime } from '../lib/format'

interface RawCapture {
  id: string
  at: number
  url: string
  method: string
  status: number
  reqBody: string
  reqHeaders: Record<string, string>
  resBody: string
  duration: number
}

function guessRole(url: string): CapturedRequest['role'] {
  if (/publish|release|commit|submit/i.test(url)) return 'publish'
  if (/content|save|draft|article|chapter/i.test(url)) return 'save_content'
  if (/create|add|new/i.test(url)) return 'create_draft'
  return 'unknown'
}

function shortUrl(u: string): string {
  try {
    const x = new URL(u)
    return `${x.host}${x.pathname}`
  } catch {
    return u
  }
}

export default function PublishPanel({ book, onChanged }: { book: Book; onChanged: () => void }): React.ReactNode {
  const toast = useApp((s) => s.toast)
  const dataVersion = useApp((s) => s.dataVersion)

  const [status, setStatus] = useState<{ loggedIn: boolean; url: string; cookieCount: number; capturedTemplates: number } | null>(null)
  const [captures, setCaptures] = useState<RawCapture[]>([])
  const [templates, setTemplates] = useState<CapturedRequest[]>([])
  const [jobs, setJobs] = useState<PublishJob[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [busy, setBusy] = useState('')
  const [rolePick, setRolePick] = useState<Record<string, CapturedRequest['role']>>({})
  const [editing, setEditing] = useState<CapturedRequest | null>(null)
  const [editBody, setEditBody] = useState('')
  const [probe, setProbe] = useState<unknown>(null)
  const [vocab, setVocab] = useState<{ snapshot: string; groups: Record<string, string[]>; limits: Record<string, number> } | null>(null)
  const [tagPick, setTagPick] = useState<FanqieTagPick>({
    main: '',
    theme: [],
    character: [],
    plot: [],
    emotion: [],
    background: []
  })
  const [tagMode, setTagMode] = useState<'novel' | 'short'>(book.workType === 'short' ? 'short' : 'novel')
  const [tagBusy, setTagBusy] = useState('')
  const [tagReport, setTagReport] = useState<string>('')

  const refresh = useCallback(async () => {
    const [st, tpl, jb, cs] = await Promise.all([
      window.api.publish.status(),
      window.api.publish.templates(),
      window.api.publish.jobs(book.id),
      window.api.chapters.list(book.id)
    ])
    setStatus(st)
    setTemplates(tpl)
    setJobs(jb)
    // 列表接口不返回正文，用字数判断是否已写
    setChapters(cs.filter((c) => c.wordCount > 0))
  }, [book.id])

  useEffect(() => {
    void refresh()
  }, [refresh, dataVersion])

  useEffect(() => {
    void window.api.tags
      .vocabulary(book.id)
      .then((v) => {
        setVocab(v)
        setTagMode(v.mode)
      })
      .catch(() => undefined)
  }, [book.id])

  useEffect(() => {
    if (book.fanqieTags) {
      setTagPick({
        main: book.fanqieTags.main || '',
        theme: book.fanqieTags.theme || [],
        character: book.fanqieTags.character || [],
        plot: book.fanqieTags.plot || [],
        emotion: book.fanqieTags.emotion || [],
        background: book.fanqieTags.background || []
      })
    }
  }, [book.id, book.fanqieTags])

  const publishable = useMemo(() => chapters.slice().sort((a, b) => a.chapterNo - b.chapterNo), [chapters])

  const openBrowser = async (): Promise<void> => {
    setBusy('open')
    try {
      await window.api.publish.open()
      toast('info', '已打开内置番茄作家后台，请扫码/账号登录')
      await refresh()
    } catch (err) {
      toast('error', `打开失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const doProbe = async (): Promise<void> => {
    setBusy('probe')
    try {
      const p = await window.api.publish.probe()
      setProbe(p)
      toast('info', '已探测当前页面结构')
    } finally {
      setBusy('')
    }
  }

  const fetchCaptures = async (): Promise<void> => {
    setBusy('captures')
    try {
      const list = (await window.api.publish.captures()) as RawCapture[]
      setCaptures(list.reverse())
      if (!list.length) toast('info', '暂无捕获。请在内置后台手动发布一章，再回来刷新')
    } finally {
      setBusy('')
    }
  }

  const clearCaptures = async (): Promise<void> => {
    await window.api.publish.clearCaptures()
    setCaptures([])
    toast('success', '页面缓冲区已清空')
  }

  const saveTemplate = async (c: RawCapture): Promise<void> => {
    const role = rolePick[c.id] || guessRole(c.url)
    try {
      const list = await window.api.publish.saveCapture(c, role, `${cnRole(role)} · ${shortUrl(c.url).split('/').pop() || 'api'}`)
      setTemplates(list)
      toast('success', '已存为发布模板')
    } catch (err) {
      toast('error', `保存失败：${(err as Error).message}`)
    }
  }

  const publish = async (chapterId: string, mode: 'api' | 'dom' | 'manual'): Promise<void> => {
    setBusy(`publish-${chapterId}`)
    try {
      const res = await window.api.publish.publishChapter(book.id, chapterId, mode)
      toast(res.job.status === 'success' ? 'success' : 'info', res.message)
      await refresh()
      onChanged()
    } catch (err) {
      toast('error', `发布失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const isShort = tagMode === 'short'
  const tagGroups: { key: 'main' | 'theme' | 'character' | 'plot' | 'emotion' | 'background'; label: string; limit: number }[] = isShort
    ? [
        { key: 'main', label: '主分类', limit: 1 },
        { key: 'plot', label: '情节', limit: 8 },
        { key: 'character', label: '角色', limit: 8 },
        { key: 'emotion', label: '情绪', limit: 8 },
        { key: 'background', label: '背景', limit: 8 }
      ]
    : [
        { key: 'main', label: '主分类', limit: 1 },
        { key: 'theme', label: '主题', limit: 2 },
        { key: 'character', label: '角色', limit: 2 },
        { key: 'plot', label: '情节', limit: 2 }
      ]

  const tagTotal = (p: FanqieTagPick): number =>
    (p.main ? 1 : 0) +
    (p.theme || []).length +
    (p.character || []).length +
    (p.plot || []).length +
    (p.emotion || []).length +
    (p.background || []).length

  const tagSummary = (): string => {
    const parts: string[] = []
    if (tagPick.main) parts.push(tagPick.main)
    for (const g of tagGroups) {
      if (g.key === 'main') continue
      for (const name of tagPick[g.key] || []) parts.push(name)
    }
    return parts.join('、')
  }

  const autoTags = async (): Promise<void> => {
    setTagBusy('suggest')
    try {
      const r = await window.api.tags.suggest(book.id)
      setTagPick({
        main: r.pick.main,
        theme: r.pick.theme,
        character: r.pick.character,
        plot: r.pick.plot,
        emotion: r.pick.emotion || [],
        background: r.pick.background || []
      })
      toast('success', '已按番茄词表选好标签，可手动调整后保存')
    } catch (err) {
      toast('error', `选标签失败：${(err as Error).message}`)
    } finally {
      setTagBusy('')
    }
  }

  const saveTags = async (): Promise<void> => {
    setTagBusy('save')
    try {
      const r = await window.api.tags.save(book.id, tagPick)
      setTagPick({
        main: r.pick.main,
        theme: r.pick.theme,
        character: r.pick.character,
        plot: r.pick.plot,
        emotion: r.pick.emotion || [],
        background: r.pick.background || []
      })
      toast('success', '标签已保存到作品')
      onChanged()
    } catch (err) {
      toast('error', `保存失败：${(err as Error).message}`)
    } finally {
      setTagBusy('')
    }
  }

  const pushTags = async (): Promise<void> => {
    setTagBusy('apply')
    try {
      // 直接把界面当前选择传过去：不强迫用户先点保存
      const r = (await window.api.publish.applyTags(book.id, tagPick)) as { ok?: boolean; missing?: string[]; reason?: string; selection?: unknown }
      if (r?.ok) {
        setTagReport('已在后台勾选完成')
        toast('success', '已在番茄后台勾选阅读标签，请确认后点「确定」')
      } else {
        const miss = r?.missing?.length ? `未勾上：${r.missing.join('、')}` : r?.reason === 'dialog-not-found' ? '没找到「阅读标签」入口，请先进入作品设置页' : '部分标签未勾上'
        setTagReport(miss)
        toast('info', miss)
      }
    } catch (err) {
      toast('error', `勾选失败：${(err as Error).message}`)
    } finally {
      setTagBusy('')
    }
  }

  const replayTest = async (t: CapturedRequest): Promise<void> => {
    setBusy(`replay-${t.id}`)
    try {
      const r = await window.api.publish.replay(t.id, {
        title: '接口连通性测试',
        content: '这是一条测试内容',
        chapterNo: 1,
        wordCount: 4
      })
      toast(r.ok ? 'success' : 'error', `回放 ${t.role}：HTTP ${r.status} ${r.ok ? '成功' : r.error || r.body.slice(0, 80)}`)
    } catch (err) {
      toast('error', `回放失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 px-6 py-5">
      {/* 登录状态 */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${status?.loggedIn ? 'bg-emerald-500/12 text-emerald-300' : 'bg-fg/5 text-fg/40'}`}>
            {status?.loggedIn ? <ShieldCheck size={18} /> : <Globe size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13.5px] text-fg/90">
              番茄小说作家后台
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${status?.loggedIn ? 'bg-emerald-500/15 text-emerald-300' : 'bg-accent/12 text-accent'}`}>
                {status?.loggedIn ? '已登录（登录态本地保存）' : '未登录'}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[10.5px] text-fg/25">
              {status?.url || 'https://fanqienovel.com/main/writer/'} · Cookie {status?.cookieCount ?? 0} 项 · 模板 {templates.length} 个
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="btn-ghost btn-sm" disabled={busy === 'open'} onClick={() => void openBrowser()}>
              {busy === 'open' ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />} 打开内置后台
            </button>
            <button className="btn-ghost btn-sm" disabled={busy === 'probe'} onClick={() => void doProbe()}>
              {busy === 'probe' ? <Loader2 size={13} className="animate-spin" /> : <CircleDot size={13} />} 页面探测
            </button>
            <button className="btn-ghost btn-sm" onClick={() => void refresh()}>
              <RefreshCw size={13} /> 刷新
            </button>
          </div>
        </div>
        {probe != null && (
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-line/6 bg-fg/[0.04] p-2.5 text-[10.5px] leading-relaxed text-fg/40">
            {JSON.stringify(probe, null, 2)}
          </pre>
        )}
      </div>

      {/* 步骤说明 */}
      <div className="grid gap-2.5 md:grid-cols-3">
        {[
          { n: '01', t: '登录', d: '点「打开内置后台」，扫码或账号登录。登录态保存在本地独立分区。' },
          { n: '02', t: '录制一次', d: '手动发布一章（或点「存草稿」），回到这里点「抓取接口」，把请求存为模板。' },
          { n: '03', t: '一键直发', d: '之后每章点「接口直发」，自动建草稿、存正文、发布，无需再点页面。' }
        ].map((s) => (
          <div key={s.n} className="panel-soft p-3.5">
            <div className="font-serif-cn text-[11px] tracking-widest text-accent/70">{s.n}</div>
            <div className="mt-1 text-[13px] text-fg/85">{s.t}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-fg/35">{s.d}</p>
          </div>
        ))}
      </div>

      {/* 阅读标签 */}
      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="section-title flex items-center gap-1.5">
            <span className="text-[13px]">🏷</span> {isShort ? '短故事分类' : '阅读标签'}
          </div>
          <div className="text-[10.5px] text-fg/25">
            番茄词表 {vocab ? `(${vocab.snapshot} 快照)` : ''} ·{' '}
            {isShort ? '主分类必选，合计最多 8 个（情节/角色/情绪/背景）' : '主分类 1 个，主题/角色/情节各最多 2 个'}
          </div>
          <div className="flex-1" />
          <button className="btn-ghost btn-sm" disabled={!!tagBusy} onClick={() => void autoTags()}>
            {tagBusy === 'suggest' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} 自动选标签
          </button>
          <button className="btn-ghost btn-sm" disabled={!!tagBusy} onClick={() => void saveTags()}>
            保存
          </button>
          <button className="btn-primary btn-sm" disabled={!!tagBusy || !tagPick.main} onClick={() => void pushTags()}>
            {tagBusy === 'apply' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} 勾选到后台
          </button>
        </div>

        <div className="space-y-2.5">
          {tagGroups.map(({ key, label, limit }) => {
            const options = vocab?.groups?.[key] || []
            const chosen: string[] = key === 'main' ? (tagPick.main ? [tagPick.main] : []) : (tagPick[key] || [])
            return (
              <div key={key} className="flex flex-wrap items-start gap-2">
                <div className="w-14 shrink-0 pt-1 text-[11.5px] text-fg/45">{label}</div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {options.map((name) => {
                    const on = chosen.includes(name)
                    return (
                      <button
                        key={name}
                        className={`rounded-md border px-2 py-1 text-[11px] transition ${
                          on ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line/8 bg-fg/[0.03] text-fg/55 hover:border-accent/25'
                        }`}
                        onClick={() => {
                          if (key === 'main') {
                            setTagPick({ ...tagPick, main: on ? '' : name })
                            return
                          }
                          const cur = tagPick[key] || []
                          const total = tagTotal(tagPick)
                          let next: string[]
                          if (on) next = cur.filter((x) => x !== name)
                          else if (total >= 8) next = [...cur.slice(1), name]
                          else if (cur.length >= limit) next = [...cur.slice(1), name]
                          else next = [...cur, name]
                          setTagPick({ ...tagPick, [key]: next })
                        }}
                      >
                        {name}
                      </button>
                    )
                  })}
                  {!options.length && <span className="pt-1 text-[11px] text-fg/25">词表加载中…</span>}
                </div>
              </div>
            )
          })}
        </div>
        {tagReport && <p className="mt-2 text-[11px] text-emerald-300/70">{tagReport}</p>}
        <p className="mt-2 text-[10.5px] leading-relaxed text-fg/25">
          {isShort
            ? '平台规则：最多可选 8 个分类，主分类必选。点「勾选到后台」会按 主分类 → 情节 → 角色 → 情绪 → 背景 逐项点选，选完请人工确认再点右上角「确认」。'
            : '平台规则：主分类必选且只能 1 个，签约后不能修改。点「勾选到后台」会自动打开内置后台的标签弹窗逐项点选，选完请人工确认再点确定。'}
        </p>
        {tagSummary() && (
          <p className="mt-1 text-[10.5px] leading-relaxed text-fg/40">
            已选 {tagTotal(tagPick)}{isShort ? '/8' : ''} 个：{tagSummary()}
          </p>
        )}
      </div>

      {/* 抓包 */}
      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="section-title flex items-center gap-1.5">
            <Download size={14} /> 接口录制
          </div>
          <div className="text-[10.5px] text-fg/25">在内置后台操作时，本软件会记录页面发出的 POST 请求</div>
          <div className="flex-1" />
          <button className="btn-ghost btn-sm" onClick={() => void clearCaptures()}>
            清空
          </button>
          <button className="btn-primary btn-sm" disabled={busy === 'captures'} onClick={() => void fetchCaptures()}>
            {busy === 'captures' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} 抓取接口
          </button>
        </div>
        {captures.length === 0 ? (
          <p className="py-4 text-center text-[11.5px] text-fg/25">
            先打开内置后台并手动发布一章，然后点「抓取接口」。
          </p>
        ) : (
          <div className="space-y-1.5">
            {captures.slice(0, 40).map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line/6 bg-fg/[0.02] px-3 py-2">
                <span className={`rounded px-1.5 py-0.5 text-[9.5px] ${c.status < 400 ? 'bg-emerald-500/12 text-emerald-300/80' : 'bg-red-500/12 text-red-300/80'}`}>
                  {c.status}
                </span>
                <span className="rounded bg-fg/6 px-1.5 py-0.5 text-[9.5px] text-fg/50">{c.method}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg/60">{shortUrl(c.url)}</span>
                <span className="text-[9.5px] text-fg/20">{c.reqBody.length} B</span>
                <select
                  className="rounded border border-line/10 bg-field px-1.5 py-1 text-[10.5px] text-fg/70 outline-none"
                  value={rolePick[c.id] || guessRole(c.url)}
                  onChange={(e) => setRolePick({ ...rolePick, [c.id]: e.target.value as CapturedRequest['role'] })}
                >
                  <option value="create_draft">创建草稿</option>
                  <option value="save_content">保存正文</option>
                  <option value="publish">发布</option>
                  <option value="query">查询</option>
                  <option value="unknown">未标注</option>
                </select>
                <button className="btn-ghost btn-sm" onClick={() => void saveTemplate(c)}>
                  存为模板
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 模板 */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="section-title flex items-center gap-1.5">
            <FileCode2 size={14} /> 发布模板
          </div>
          <div className="text-[10.5px] text-fg/25">接口直发会按「创建草稿 → 保存正文 → 发布」顺序回放</div>
        </div>
        {templates.length === 0 ? (
          <p className="py-4 text-center text-[11.5px] text-fg/25">还没有模板。录制后保存即可。</p>
        ) : (
          <div className="space-y-1.5">
            {templates.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line/6 bg-fg/[0.02] px-3 py-2">
                <span className="rounded bg-accent/12 px-1.5 py-0.5 text-[9.5px] text-accent/90">{cnRole(t.role)}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg/65">
                  {t.name} · <span className="text-fg/30">{shortUrl(t.url)}</span>
                </span>
                <select
                  className="rounded border border-line/10 bg-field px-1.5 py-1 text-[10.5px] text-fg/70 outline-none"
                  value={t.role}
                  onChange={(e) => void window.api.publish.setRole(t.id, e.target.value as CapturedRequest['role']).then(setTemplates)}
                >
                  <option value="create_draft">创建草稿</option>
                  <option value="save_content">保存正文</option>
                  <option value="publish">发布</option>
                  <option value="query">查询</option>
                  <option value="unknown">未标注</option>
                </select>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(t)
                    setEditBody(t.body)
                  }}
                >
                  编辑请求体
                </button>
                <button className="btn-ghost btn-sm" disabled={busy === `replay-${t.id}`} onClick={() => void replayTest(t)}>
                  {busy === `replay-${t.id}` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} 试发
                </button>
                <button
                  className="rounded p-1 text-fg/30 hover:bg-red-500/15 hover:text-red-300"
                  onClick={() => void window.api.publish.removeTemplate(t.id).then(setTemplates)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 章节发布 */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="section-title flex items-center gap-1.5">
            <UploadCloud size={14} /> 章节发布
          </div>
          <div className="text-[10.5px] text-fg/25">
            {book.workType === 'short' ? `共 ${publishable.length} 篇可发布` : `共 ${publishable.length} 章可发布`}
          </div>
        </div>
        {publishable.length === 0 ? (
          <EmptyState icon={<UploadCloud size={34} />} title="还没有可发布的章节" desc="先让 AI 写几章再回来。" />
        ) : (
          <div className="space-y-1.5">
            {publishable
              .slice()
              .reverse()
              .slice(0, 20)
              .map((c) => {
                const job = jobs.find((j) => j.chapterId === c.id)
                return (
                  <div key={c.id} className="flex items-center gap-2 rounded-lg border border-line/6 bg-fg/[0.02] px-3 py-2">
                    <StatusDot status={c.status} />
                    <span className="w-14 shrink-0 text-[10.5px] text-fg/30">
                      {book.workType === 'short' ? '全文' : `第 ${c.chapterNo} 章`}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg/70">{c.title}</span>
                    <span className="shrink-0 text-[10px] text-fg/25">{c.wordCount} 字</span>
                    {job && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] ${
                          job.status === 'success' ? 'bg-emerald-500/12 text-emerald-300' : job.status === 'failed' ? 'bg-red-500/12 text-red-300' : 'bg-fg/6 text-fg/45'
                        }`}
                      >
                        {cnStatus(job.status)}
                      </span>
                    )}
                    <div className="flex shrink-0 gap-1">
                      <button className="btn-primary btn-sm" disabled={busy === `publish-${c.id}`} onClick={() => void publish(c.id, 'api')}>
                        {busy === `publish-${c.id}` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} 直发
                      </button>
                      <button className="btn-ghost btn-sm" disabled={busy === `publish-${c.id}`} onClick={() => void publish(c.id, 'dom')}>
                        填入页面
                      </button>
                      <button className="btn-ghost btn-sm" disabled={busy === `publish-${c.id}`} onClick={() => void publish(c.id, 'manual')}>
                        复制
                      </button>
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </div>

      {/* 记录 */}
      <div className="panel p-4">
        <div className="section-title mb-2.5">发布记录</div>
        {jobs.length === 0 ? (
          <p className="py-3 text-center text-[11.5px] text-fg/25">暂无记录</p>
        ) : (
          <div className="space-y-1">
            {jobs.slice(0, 15).map((j) => (
              <div key={j.id} className="flex items-center gap-2 text-[11px] text-fg/45">
                {j.status === 'success' ? (
                  <CheckCircle2 size={12} className="text-emerald-400/70" />
                ) : j.status === 'failed' ? (
                  <AlertTriangle size={12} className="text-red-400/70" />
                ) : (
                  <Spinner className="text-accent/60" />
                )}
                <span className="w-24 shrink-0">{cnStatus(j.status)}</span>
                <span className="min-w-0 flex-1 truncate">{String(j.payload?.title || '')} {j.error ? `· ${j.error}` : ''}</span>
                <span className="shrink-0 text-fg/20">{fmtTime(j.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={!!editing}
        title="编辑请求体"
        subtitle="可插入 {{title}} / {{content}} / {{chapterNo}} / {{chapterId}} 占位符，发布时自动替换"
        onClose={() => setEditing(null)}
        width="max-w-3xl"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              className="btn-primary"
              onClick={() =>
                void window.api.publish
                  .updateTemplate(editing!.id, { body: editBody })
                  .then((list) => {
                    setTemplates(list)
                    setEditing(null)
                    toast('success', '模板已更新')
                  })
              }
            >
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="请求地址">
            <input className="input font-mono text-[11px]" readOnly value={editing?.url || ''} />
          </Field>
          <Field label="请求体">
            <textarea className="textarea min-h-[300px] font-mono text-[11px]" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
