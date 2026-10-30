import { useEffect, useState } from 'react'
import { ExternalLink, FolderOpen, Loader2, Moon, Palette, Save, Sun, Wand2 } from 'lucide-react'
import type { AccentColor, AppSettings, ThemeMode } from '@shared/types'
import { useApp } from '../store/useApp'
import { Field, Spinner } from '../components/ui'
import ProviderManager from '../components/ProviderManager'
import UpdatePanel from '../components/UpdatePanel'

const THEMES: { key: ThemeMode; label: string; desc: string; icon: typeof Moon }[] = [
  { key: 'dark', label: '深色', desc: '默认，长时间写作更护眼', icon: Moon },
  { key: 'light', label: '浅色', desc: '明亮环境或白天使用', icon: Sun }
]

const ACCENTS: { key: AccentColor; label: string; color: string }[] = [
  { key: 'amber', label: '琥珀', color: '#f0b45c' },
  { key: 'blue', label: '海蓝', color: '#6ea8ff' },
  { key: 'green', label: '青绿', color: '#5fce9a' },
  { key: 'violet', label: '紫罗兰', color: '#b18cff' },
  { key: 'rose', label: '玫瑰', color: '#ff8fb3' },
  { key: 'cyan', label: '青蓝', color: '#5fd3e8' },
  { key: 'red', label: '赤红', color: '#ff7d6e' }
]

export default function SettingsPage(): React.ReactNode {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const toast = useApp((s) => s.toast)

  const [draft, setDraft] = useState<AppSettings | null>(settings)
  const [saving, setSaving] = useState(false)
  const [info, setInfo] = useState<{
    version: string
    dataDir: string
    dbPath: string
    platform: string
    arch: string
    platformLabel: string
    electron: string
  } | null>(null)

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

  useEffect(() => {
    void window.api.app.info().then(setInfo)
  }, [])

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-mist-400">
        <Spinner /> 加载设置…
      </div>
    )
  }

  /** 只保存写作策略 / 番茄 / 界面；供应商配置由 ProviderManager 独立保存 */
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const next = await window.api.settings.save({ writing: draft.writing, fanqie: draft.fanqie, ui: draft.ui })
      setSettings(next)
      setDraft(next)
      toast('success', '设置已保存')
    } catch (err) {
      toast('error', `保存失败：${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  /** 外观切换：立即生效 + 自动保存 */
  const applyUi = async (patch: Partial<AppSettings['ui']>): Promise<void> => {
    const next = { ...draft.ui, ...patch }
    document.documentElement.dataset.theme = next.theme
    document.documentElement.dataset.accent = next.accent
    setDraft({ ...draft, ui: next })
    try {
      const saved = await window.api.settings.save({ ui: next })
      setSettings(saved)
    } catch (err) {
      toast('error', `保存外观失败：${(err as Error).message}`)
    }
  }

  return (
    <div className="mx-auto max-w-[960px] px-8 py-7">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif-cn text-[24px] font-semibold tracking-wide text-fg">设置</h1>
          <p className="mt-1.5 text-[12.5px] text-mist-400">供应商配置、写作策略、番茄后台与本地数据</p>
        </div>
        <button className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 保存本页设置
        </button>
      </div>

      {/* 供应商：多套配置，独立保存/切换 */}
      <ProviderManager onSettings={setSettings} />

      {/* 外观 */}
      <section className="panel mt-4 p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Palette size={15} className="text-accent/80" />
          <div className="section-title">外观</div>
          <span className="text-[10.5px] text-fg/25">切换后立即生效并自动保存</span>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <div className="label">主题</div>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => {
                const Icon = t.icon
                const active = draft.ui.theme === t.key
                return (
                  <button
                    key={t.key}
                    onClick={() => void applyUi({ theme: t.key })}
                    className={`rounded-xl border p-3 text-left transition ${
                      active ? 'border-accent/60 bg-accent/[0.07]' : 'border-line/8 bg-fg/[0.02] hover:border-line/20'
                    }`}
                  >
                    <div
                      className={`mb-2 h-12 rounded-lg border ${
                        t.key === 'dark' ? 'border-white/10 bg-[#0f131b]' : 'border-black/10 bg-[#f3f5f9]'
                      }`}
                    >
                      <div className="flex h-full items-center gap-1 px-2">
                        <span className={`h-2 w-2 rounded-full ${t.key === 'dark' ? 'bg-white/30' : 'bg-black/25'}`} />
                        <span className={`h-1.5 flex-1 rounded-full ${t.key === 'dark' ? 'bg-white/10' : 'bg-black/10'}`} />
                        <span className="h-2 w-2 rounded-full bg-accent" />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[12.5px] text-fg/85">
                      <Icon size={13} /> {t.label}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-fg/30">{t.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <div className="label">主题色</div>
            <div className="grid grid-cols-4 gap-2">
              {ACCENTS.map((a) => {
                const active = draft.ui.accent === a.key
                return (
                  <button
                    key={a.key}
                    onClick={() => void applyUi({ accent: a.key })}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition ${
                      active ? 'border-accent/60 bg-accent/[0.07]' : 'border-line/8 bg-fg/[0.02] hover:border-line/20'
                    }`}
                  >
                    <span className="h-6 w-6 rounded-full" style={{ backgroundColor: a.color }} />
                    <span className={`text-[10.5px] ${active ? 'text-accent' : 'text-fg/40'}`}>{a.label}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-fg/25">主题色会应用到按钮、选中态、进度条与高亮。</p>
          </div>
        </div>
      </section>

      {/* 写作策略 */}
      <section className="panel mt-4 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Wand2 size={15} className="text-accent/80" />
          <div className="section-title">写作策略</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="上下文预算（tokens）" hint="越大越连贯，但成本更高。长篇建议 24000~64000">
            <input
              type="number"
              step={1000}
              className="input"
              value={draft.writing.contextBudget}
              onChange={(e) => setDraft({ ...draft, writing: { ...draft.writing, contextBudget: Number(e.target.value) } })}
            />
          </Field>
          <div className="flex flex-col justify-center gap-2 pt-5">
            <label className="flex items-center gap-2 text-[12.5px] text-fg/65">
              <input
                type="checkbox"
                className="accent-[var(--color-accent)]"
                checked={draft.writing.autoReview}
                onChange={(e) => setDraft({ ...draft, writing: { ...draft.writing, autoReview: e.target.checked } })}
              />
              每章自动审校（严重冲突时自动修稿）
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-fg/65">
              <input
                type="checkbox"
                className="accent-[var(--color-accent)]"
                checked={draft.writing.consistencyCheck}
                onChange={(e) => setDraft({ ...draft, writing: { ...draft.writing, consistencyCheck: e.target.checked } })}
              />
              每章写入记忆库（摘要 / 状态 / 伏笔）
            </label>
          </div>
        </div>
      </section>

      {/* 番茄后台 */}
      <section className="panel mt-4 p-5">
        <div className="mb-4 flex items-center gap-2">
          <ExternalLink size={15} className="text-accent/80" />
          <div className="section-title">番茄后台</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="作家后台地址">
            <input
              className="input font-mono text-[12px]"
              value={draft.fanqie.writerUrl}
              onChange={(e) => setDraft({ ...draft, fanqie: { ...draft.fanqie, writerUrl: e.target.value } })}
            />
          </Field>
          <Field label="发布间隔（毫秒）" hint="太频繁可能触发风控">
            <input
              type="number"
              className="input"
              value={draft.fanqie.publishDelayMs}
              onChange={(e) => setDraft({ ...draft, fanqie: { ...draft.fanqie, publishDelayMs: Number(e.target.value) } })}
            />
          </Field>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-fg/65">
            <input
              type="checkbox"
              className="accent-[var(--color-accent)]"
              checked={draft.fanqie.useApiReplay}
              onChange={(e) => setDraft({ ...draft, fanqie: { ...draft.fanqie, useApiReplay: e.target.checked } })}
            />
            优先使用接口回放直发
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-fg/65">
            <input
              type="checkbox"
              className="accent-[var(--color-accent)]"
              checked={draft.fanqie.autoPublish}
              onChange={(e) => setDraft({ ...draft, fanqie: { ...draft.fanqie, autoPublish: e.target.checked } })}
            />
            页面自动化模式下自动点击「发布」按钮
          </label>
        </div>
      </section>

      {/* 本地数据 */}
      <section className="panel mt-4 p-5">
        <div className="mb-3 flex items-center gap-2">
          <FolderOpen size={15} className="text-accent/80" />
          <div className="section-title">本地数据与运行环境</div>
        </div>
        <div className="space-y-1.5 text-[11.5px] leading-relaxed text-fg/40">
          <div>
            系统：<span className="text-fg/65">{info?.platformLabel || '—'}</span>
            {info?.electron ? <span className="text-fg/30"> · Electron {info.electron}</span> : null}
            <span className="text-fg/30"> · 版本 {info?.version}</span>
          </div>
          <div>
            数据目录：<span className="font-mono text-fg/60">{info?.dataDir || '—'}</span>
          </div>
          <div>
            数据库：<span className="font-mono text-fg/60">{info?.dbPath || '—'}</span>
          </div>
          {info?.platform === 'win32' && (
            <p className="pt-0.5 text-[10.5px] text-fg/25">
              提示：系统内部标识「win32」是 Windows 平台代号（Win32 API），不代表 32 位；当前为 64 位（x64）构建。
            </p>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button className="btn-ghost btn-sm" onClick={() => void window.api.app.openDataDir()}>
            <FolderOpen size={12} /> 打开数据目录
          </button>
        </div>
      </section>

      <UpdatePanel />

      <div className="h-8" />
    </div>
  )
}
