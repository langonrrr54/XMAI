import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Loader2, Sparkles, Wand2 } from 'lucide-react'
import type { ConceptOption, WorkType } from '@shared/types'
import { Field, Modal } from './ui'
import { useApp } from '../store/useApp'

const AUTO = '自动'
const NOVEL_GENRES = ['都市', '玄幻', '仙侠', '科幻', '悬疑', '历史', '游戏', '奇幻', '现实']
const SHORT_GENRES = ['情感', '悬疑', '脑洞', '爽文', '惊悚', '治愈', '现实', '奇幻']
const NOVEL_STYLES = ['快节奏爽文', '细腻情感', '冷硬悬疑', '轻松搞笑', '热血燃动', '治愈温情', '暗黑反转']
const SHORT_STYLES = ['一次读完的反转', '细腻情感', '冷硬悬疑', '轻松幽默', '治愈温情', '暗黑反转']

export default function NewBookWizard({
  open,
  workType,
  onClose
}: {
  open: boolean
  workType: WorkType
  onClose: () => void
}): React.ReactNode {
  const isShort = workType === 'short'
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [idea, setIdea] = useState('')
  const [genre, setGenre] = useState(AUTO)
  const [audience, setAudience] = useState(AUTO)
  const [styleHint, setStyleHint] = useState(AUTO)
  const [count, setCount] = useState(3)
  const [options, setOptions] = useState<ConceptOption[]>([])
  const [selected, setSelected] = useState(0)
  const [targetChapters, setTargetChapters] = useState(600)
  const [wordsPerChapter, setWordsPerChapter] = useState(isShort ? 5000 : 2200)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ConceptOption | null>(null)

  const toast = useApp((s) => s.toast)
  const events = useApp((s) => s.events)
  const refreshBooks = useApp((s) => s.refreshBooks)
  const navigate = useApp((s) => s.navigate)

  const genres = [AUTO, ...(isShort ? SHORT_GENRES : NOVEL_GENRES)]
  const styles = [AUTO, ...(isShort ? SHORT_STYLES : NOVEL_STYLES)]

  const lastMessage = useMemo(() => {
    const last = [...events].reverse().find((e) => e.type === 'log' || e.type === 'start')
    return last?.message || ''
  }, [events])

  useEffect(() => {
    if (!open) {
      setStep(1)
      setOptions([])
      setSelected(0)
      setLoading(false)
      setEditing(false)
      setDraft(null)
    }
  }, [open])

  // 打开时按作品类型重置默认值
  useEffect(() => {
    if (!open) return
    setIdea('')
    setGenre(AUTO)
    setAudience(AUTO)
    setStyleHint(AUTO)
    setTargetChapters(isShort ? 1 : 600)
    setWordsPerChapter(isShort ? 5000 : 2200)
  }, [open, isShort])

  const requestOptions = async (instant: boolean): Promise<void> => {
    const auto = instant || !idea.trim()
    setLoading(true)
    try {
      const list = await window.api.books.concept({
        idea: auto ? '' : idea.trim(),
        auto,
        workType,
        genre: genre === AUTO ? '' : genre,
        audience: audience === AUTO ? '' : audience,
        styleHint: styleHint === AUTO ? '' : styleHint,
        lengthHint: isShort ? wordsPerChapter : targetChapters,
        count: instant ? 1 : count
      })
      if (!list.length) throw new Error('没有生成有效方案，请重试')
      setOptions(list)
      setSelected(0)
      setLoading(false)
      if (instant) {
        await createWith(list[0])
      } else {
        setStep(2)
      }
    } catch (err) {
      setLoading(false)
      toast('error', `生成失败：${(err as Error).message}`)
    }
  }

  const createWith = async (concept: ConceptOption): Promise<void> => {
    setStep(3)
    try {
      const res = await window.api.books.create({
        concept,
        workType,
        targetChapters: isShort ? 1 : targetChapters,
        wordsPerChapter,
        autoOutline: true
      })
      await refreshBooks()
      if (res.warning) toast('info', res.warning)
      toast('success', `${isShort ? '短故事' : '作品'}《${res.book.title}》已创建`)
      navigate('book', { bookId: res.book.id })
      onClose()
    } catch (err) {
      toast('error', `创建失败：${(err as Error).message}`)
      setStep(2)
    }
  }

  const current = draft || options[selected]

  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      width="max-w-3xl"
      title={
        step === 1
          ? isShort
            ? '写一篇短故事'
            : '写一本小说'
          : step === 2
            ? '选择并微调方案'
            : isShort
              ? '正在搭建这篇短故事'
              : '正在搭建这本书'
      }
      subtitle={
        step === 1
          ? '不需要任何写作经验：点「一键全自动」，剩下的全部交给 AI'
          : step === 2
            ? isShort
              ? '短故事只有一篇：确认后直接进入结构与成篇'
              : '选一个方向，可修改书名/简介/标签后再创建'
            : isShort
              ? '人物设定 → 7 拍结构 → 封面，随后可一键成篇'
              : '设定库 → 分卷大纲 → 首章细纲 → 封面，全自动完成'
      }
      footer={
        step === 1 ? (
          <>
            <button className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn-ghost" disabled={loading} onClick={() => void requestOptions(false)}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {idea.trim() ? '生成方案让我挑' : '生成几个方案让我挑'}
            </button>
          </>
        ) : step === 2 ? (
          <>
            <button className="btn-ghost" onClick={() => setStep(1)}>
              <ArrowLeft size={14} /> 返回
            </button>
            <button className="btn-primary" onClick={() => current && void createWith(current)}>
              <Sparkles size={14} /> {isShort ? '创建并拆结构' : '创建并自动搭建'}
            </button>
          </>
        ) : undefined
      }
    >
      {step === 1 && (
        <div className="space-y-4">
          {/* 零输入入口 */}
          <div className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/[0.10] via-transparent to-transparent p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-serif-cn text-[15px] text-fg">
                  <Sparkles size={16} className="text-accent" />
                  完全没想法？交给 AI 全自动
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-fg/45">
                  题材、受众、文风、书名、简介、标签、封面、设定与{isShort ? '故事结构' : '分卷大纲'}全部由 AI 决定，
                  你只需要等它把骨架搭好。
                </p>
                <div className="mt-1.5 text-[10.5px] text-fg/25">
                  默认篇幅：{isShort ? `${wordsPerChapter} 字短篇` : `${targetChapters} 章 × ${wordsPerChapter} 字`}
                </div>
              </div>
              <button className="btn-primary shrink-0" disabled={loading} onClick={() => void requestOptions(true)}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                一键全自动
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-fg/25">
            <div className="hairline flex-1" />
            或者，给我一点方向（全部可留空）
            <div className="hairline flex-1" />
          </div>

          <Field label="灵感（可留空）" hint="留空即由 AI 自主选题；写一句也可以，比如一个画面、一个职业、一个反转。">
            <textarea
              className="textarea min-h-[92px]"
              placeholder={
                isShort
                  ? '可留空。想给方向时：例——搬家时发现一封写给十年后自己的信。'
                  : '可留空。想给方向时：例——外卖员每次死亡都会回到三分钟前。'
              }
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="题材">
              <select className="input" value={genre} onChange={(e) => setGenre(e.target.value)}>
                {genres.map((g) => (
                  <option key={g} value={g}>
                    {g === AUTO ? '自动（AI 决定）' : g}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="受众">
              <select className="input" value={audience} onChange={(e) => setAudience(e.target.value)}>
                <option value={AUTO}>自动（AI 决定）</option>
                <option>男频</option>
                <option>女频</option>
                <option>通用</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-[1fr_140px] gap-3">
            <Field label="风格偏好">
              <select className="input" value={styleHint} onChange={(e) => setStyleHint(e.target.value)}>
                {styles.map((s) => (
                  <option key={s} value={s}>
                    {s === AUTO ? '自动（AI 决定）' : s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="方案数量">
              <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                <option value={1}>1 个</option>
                <option value={3}>3 个</option>
                <option value={5}>5 个</option>
              </select>
            </Field>
          </div>

          {isShort ? (
            <Field label="目标字数" hint="短故事建议 3000~8000 字，一次成篇">
              <div className="flex flex-wrap gap-2">
                {[3000, 5000, 8000, 12000].map((n) => (
                  <button
                    key={n}
                    className={`rounded-lg border px-3 py-2 text-[12px] transition ${
                      wordsPerChapter === n
                        ? 'border-accent/60 bg-accent/10 text-accent'
                        : 'border-line/10 bg-fg/[0.03] text-fg/50 hover:text-fg'
                    }`}
                    onClick={() => setWordsPerChapter(n)}
                  >
                    {n} 字
                  </button>
                ))}
                <input
                  type="number"
                  className="input w-28"
                  min={1500}
                  max={20000}
                  step={500}
                  value={wordsPerChapter}
                  onChange={(e) => setWordsPerChapter(Number(e.target.value))}
                />
              </div>
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="目标章节数" hint="番茄长篇通常 300~2000 章">
                <input
                  type="number"
                  className="input"
                  value={targetChapters}
                  min={10}
                  max={5000}
                  onChange={(e) => setTargetChapters(Number(e.target.value))}
                />
              </Field>
              <Field label="单章字数">
                <input
                  type="number"
                  className="input"
                  value={wordsPerChapter}
                  min={800}
                  max={8000}
                  step={100}
                  onChange={(e) => setWordsPerChapter(Number(e.target.value))}
                />
              </Field>
            </div>
          )}
        </div>
      )}

      {step === 2 && current && (
        <div className="space-y-3">
          {options.map((o, i) => (
            <button
              key={i}
              className={`w-full rounded-xl border p-4 text-left transition ${
                selected === i && !editing
                  ? 'border-accent/50 bg-accent/[0.06]'
                  : 'border-line/8 bg-fg/[0.02] hover:border-line/20'
              }`}
              onClick={() => {
                setSelected(i)
                setDraft(null)
                setEditing(false)
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-serif-cn text-[17px] font-semibold text-fg">{o.title}</div>
                  <div className="mt-0.5 text-[11px] text-accent/80">
                    {o.genre} · {o.hook || (isShort ? '强悬念开篇' : '强钩子开篇')}
                  </div>
                </div>
                {selected === i && !editing && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
                    <Check size={12} />
                  </span>
                )}
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-fg/60">{o.synopsis}</p>
              {isShort && o.structure && (
                <p className="mt-2 rounded-lg bg-fg/[0.04] px-2.5 py-2 text-[11.5px] leading-relaxed text-fg/45">
                  结构：{o.structure}
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {o.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
              <div className="mt-2.5 grid gap-1 text-[11.5px] leading-relaxed text-fg/35">
                <div>主角：{o.protagonist}</div>
                {!isShort && <div>金手指：{o.goldenFinger}</div>}
                <div>看点：{o.sellingPoints.join(' / ')}</div>
              </div>
            </button>
          ))}

          <div className="flex items-center justify-between rounded-xl border border-line/8 bg-fg/[0.02] px-4 py-3">
            <div className="text-[12px] text-mist-400">
              当前：<span className="text-fg/85">{current.title}</span>
            </div>
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setDraft({ ...current })
                setEditing(true)
              }}
            >
              手动微调
            </button>
          </div>

          {isShort ? (
            <Field label="目标字数">
              <input
                type="number"
                className="input"
                min={1500}
                max={20000}
                step={500}
                value={wordsPerChapter}
                onChange={(e) => setWordsPerChapter(Number(e.target.value))}
              />
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Field label="目标章节数">
                <input type="number" className="input" value={targetChapters} onChange={(e) => setTargetChapters(Number(e.target.value))} />
              </Field>
              <Field label="单章字数">
                <input type="number" className="input" value={wordsPerChapter} onChange={(e) => setWordsPerChapter(Number(e.target.value))} />
              </Field>
            </div>
          )}
        </div>
      )}

      {step === 2 && editing && draft && (
        <div className="mt-4 space-y-3 rounded-xl border border-accent/25 bg-accent/[0.04] p-4">
          <Field label="书名">
            <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="简介">
            <textarea className="textarea min-h-[100px]" value={draft.synopsis} onChange={(e) => setDraft({ ...draft, synopsis: e.target.value })} />
          </Field>
          <Field label="标签（逗号分隔）">
            <input
              className="input"
              value={draft.tags.join(',')}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
            <Loader2 size={26} className="animate-spin text-accent" />
          </div>
          <div className="text-center">
            <div className="font-serif-cn text-[15px] text-fg/85">
              {isShort ? 'AI 正在拆这篇短故事' : 'AI 正在写这本书的骨架'}
            </div>
            <div className="mt-1.5 max-w-md text-[12px] leading-relaxed text-mist-400">
              {lastMessage || (isShort ? '正在生成人物与故事结构…' : '正在生成设定库…')}
            </div>
          </div>
          <div className="h-1 w-64 overflow-hidden rounded-full bg-fg/10">
            <div className="shimmer h-full w-full" />
          </div>
          <div className="text-[11px] text-fg/25">通常需要 20~90 秒，取决于模型速度</div>
        </div>
      )}
    </Modal>
  )
}
