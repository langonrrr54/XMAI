import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Search,
  ServerCog,
  Trash2,
  XCircle,
  Zap
} from 'lucide-react'
import type { AppSettings, ModelSettings, ProviderInput, ProviderProfile } from '@shared/types'
import { Field, Modal, Spinner } from './ui'
import { useApp } from '../store/useApp'
import {
  PROVIDER_CATALOG,
  PROVIDER_CATEGORIES,
  hostOf,
  type ProviderCatalogItem,
  type ProviderCategory
} from '../lib/providerCatalog'

const EMPTY_MODELS: ModelSettings['models'] = {
  default: '',
  planner: '',
  writer: '',
  summarizer: '',
  judge: '',
  embedding: '',
  image: ''
}

const emptyForm = (): ProviderInput => ({
  name: '',
  baseUrl: '',
  apiKey: '',
  models: { ...EMPTY_MODELS },
  temperature: 0.85,
  maxTokens: 8192,
  extraHeaders: '',
  preset: 'custom'
})

const toForm = (p: ProviderProfile): ProviderInput => ({
  name: p.name,
  baseUrl: p.baseUrl,
  apiKey: p.apiKey,
  models: { ...EMPTY_MODELS, ...p.models },
  temperature: p.temperature,
  maxTokens: p.maxTokens,
  extraHeaders: p.extraHeaders,
  preset: p.preset
})

const toModel = (f: ProviderInput): ModelSettings => ({
  baseUrl: f.baseUrl,
  apiKey: f.apiKey,
  models: f.models,
  temperature: f.temperature,
  maxTokens: f.maxTokens,
  concurrency: 1,
  extraHeaders: f.extraHeaders
})

function maskKey(k: string): string {
  if (!k) return '未填写'
  if (k.length <= 8) return '••••••'
  return `${k.slice(0, 4)}••••${k.slice(-4)}`
}

/** 模型输入 + 已拉取模型的下拉选择（原生 select，避免 datalist 在 Electron 里不弹出） */
function ModelField({
  label,
  hint,
  value,
  placeholder,
  models,
  onChange
}: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  models: string[]
  onChange: (v: string) => void
}): React.ReactNode {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-1.5">
        <input
          className="input min-w-0 font-mono text-[12px]"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <select
          className="input w-[124px] shrink-0 text-[11px]"
          value=""
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value)
          }}
          disabled={models.length === 0}
          title={models.length ? '从已拉取的模型中选择' : '先点「拉取模型列表」'}
        >
          <option value="">{models.length ? '选择模型' : '无列表'}</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </Field>
  )
}

export default function ProviderManager({ onSettings }: { onSettings: (s: AppSettings) => void }): React.ReactNode {
  const toast = useApp((s) => s.toast)

  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')

  // 目录选择
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'全部' | '自定义' | ProviderCategory>('全部')

  // 表单
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProviderInput>(emptyForm())
  const [presetNote, setPresetNote] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.api.providers.list()
    setProviders(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const active = useMemo(() => providers.find((p) => p.active), [providers])

  const applyResult = (r: { providers: ProviderProfile[]; settings: AppSettings }): void => {
    setProviders(r.providers)
    onSettings(r.settings)
  }

  const activate = async (id: string): Promise<void> => {
    setBusyId(id)
    try {
      applyResult(await window.api.providers.activate(id))
      toast('success', '已切换供应商')
    } catch (err) {
      toast('error', `切换失败：${(err as Error).message}`)
    } finally {
      setBusyId('')
    }
  }

  const remove = async (p: ProviderProfile): Promise<void> => {
    if (!window.confirm(`删除供应商「${p.name}」？`)) return
    setBusyId(p.id)
    try {
      applyResult(await window.api.providers.remove(p.id))
      toast('success', '已删除')
    } catch (err) {
      toast('error', `删除失败：${(err as Error).message}`)
    } finally {
      setBusyId('')
    }
  }

  const testSaved = async (p: ProviderProfile): Promise<void> => {
    setBusyId(p.id)
    try {
      const r = await window.api.settings.test(toModel(toForm(p)))
      toast(r.ok ? 'success' : 'error', `${p.name}：${r.message}`)
    } catch (err) {
      toast('error', `测试失败：${(err as Error).message}`)
    } finally {
      setBusyId('')
    }
  }

  const openCatalog = (): void => {
    setSearch('')
    setCategory('全部')
    setCatalogOpen(true)
  }

  const startForm = (item?: ProviderCatalogItem): void => {
    const base = emptyForm()
    if (item) {
      base.name = item.name
      base.baseUrl = item.baseUrl
      base.models = { ...EMPTY_MODELS, ...item.models }
      base.preset = item.id
      setPresetNote(item.note)
    } else {
      base.name = '我的配置'
      setPresetNote('填写任意 OpenAI 兼容服务地址，必须包含 /v1（例如 https://your-host/v1）；模型名按服务商文档填写。')
    }
    setForm(base)
    setEditingId(null)
    setModels([])
    setTestResult(null)
    setShowKey(false)
    setCatalogOpen(false)
    setFormOpen(true)
  }

  const startEdit = (p: ProviderProfile): void => {
    setForm(toForm(p))
    setEditingId(p.id)
    setPresetNote('')
    setModels([])
    setTestResult(null)
    setShowKey(false)
    setFormOpen(true)
  }

  const patchForm = (patch: Partial<ProviderInput>): void => setForm({ ...form, ...patch })
  const [embedTestBusy, setEmbedTestBusy] = useState(false)
  const [embedResult, setEmbedResult] = useState<{ ok: boolean; message: string } | null>(null)

  const testEmbedding = async (): Promise<void> => {
    setEmbedTestBusy(true)
    try {
      const r = await window.api.settings.testEmbedding({
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        models: form.models,
        temperature: form.temperature,
        maxTokens: form.maxTokens,
        concurrency: 1,
        extraHeaders: form.extraHeaders
      })
      setEmbedResult({ ok: r.ok, message: r.message })
    } catch (err) {
      setEmbedResult({ ok: false, message: `测试失败：${(err as Error).message}` })
    } finally {
      setEmbedTestBusy(false)
    }
  }

  const patchModelRole = (key: keyof ModelSettings['models'], value: string): void =>
    setForm({ ...form, models: { ...form.models, [key]: value } })

  const validate = (): string | null => {
    if (!form.name.trim()) return '请填写配置名称'
    if (!form.baseUrl.trim()) return '请填写 API 地址'
    if (!form.models.default.trim()) return '请填写默认模型名'
    return null
  }

  const save = async (activateAfter: boolean): Promise<void> => {
    const err = validate()
    if (err) {
      toast('error', err)
      return
    }
    setSaving(true)
    try {
      const r = editingId
        ? await window.api.providers.update(editingId, form)
        : await window.api.providers.create(form, activateAfter)
      applyResult(r)
      setFormOpen(false)
      toast('success', editingId ? '供应商配置已保存' : activateAfter ? '已保存并启用' : '已保存')
    } catch (e) {
      toast('error', `保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const testDraft = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.api.settings.test(toModel(form))
      setTestResult(r)
      if (r.ok && r.models) setModels(r.models)
      toast(r.ok ? 'success' : 'error', r.message)
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const fetchModels = async (): Promise<void> => {
    try {
      const list = await window.api.settings.models(toModel(form))
      setModels(list)
      toast('success', `获取到 ${list.length} 个模型`)
    } catch (err) {
      toast('error', `获取模型失败：${(err as Error).message}`)
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = PROVIDER_CATALOG.filter((i) => {
    const catOk = category === '全部' || category === i.category
    const qOk = !q || i.name.toLowerCase().includes(q) || i.baseUrl.toLowerCase().includes(q) || i.note.toLowerCase().includes(q)
    return catOk && qOk
  })
  const showCustom = (category === '全部' || category === '自定义') && (!q || '自定义'.includes(q) || 'custom'.includes(q))

  return (
    <section className="panel mt-5 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ServerCog size={15} className="text-accent/80" />
        <div className="section-title">模型接入</div>
        <span className="text-[10.5px] text-fg/25">
          {providers.length ? `${providers.length} 套配置 · 切换即生效` : '保存多套配置，随时切换'}
        </span>
        <div className="flex-1" />
        <button className="btn-primary btn-sm" onClick={openCatalog}>
          <Plus size={13} /> 添加供应商
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-fg/30">
          <Spinner /> 加载供应商配置…
        </div>
      ) : providers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line/10 px-4 py-8 text-center">
          <ServerCog size={28} className="mx-auto text-fg/15" />
          <div className="mt-3 text-[13px] text-fg/60">还没有供应商配置</div>
          <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-fg/30">
            添加一套供应商（DeepSeek、通义千问、Kimi、智谱、OpenAI 等），填好 Key 后即可开始写作。
          </p>
          <button className="btn-primary btn-sm mt-4" onClick={openCatalog}>
            <Plus size={13} /> 添加供应商
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition ${
                p.active
                  ? 'border-emerald-500/25 bg-emerald-500/[0.05]'
                  : 'border-line/7 bg-fg/[0.02] hover:border-line/15'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] ${
                  p.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-fg/6 text-accent/80'
                }`}
              >
                {p.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] text-fg/90">{p.name}</span>
                  {p.active && (
                    <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/12 px-1.5 py-0.5 text-[9.5px] text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> 使用中
                    </span>
                  )}
                  <span className="shrink-0 text-[9.5px] text-fg/20">{p.models.default}</span>
                </div>
                <div className="mt-0.5 truncate text-[10.5px] text-fg/30">
                  {p.baseUrl} · Key {maskKey(p.apiKey)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!p.active && (
                  <button className="btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => void activate(p.id)}>
                    {busyId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} 切换
                  </button>
                )}
                <button className="btn-ghost btn-sm" disabled={busyId === p.id} onClick={() => void testSaved(p)}>
                  测试
                </button>
                <button className="btn-ghost btn-sm" onClick={() => startEdit(p)}>
                  <Pencil size={12} /> 编辑
                </button>
                <button
                  className="rounded p-1.5 text-fg/30 hover:bg-red-500/15 hover:text-red-300"
                  disabled={busyId === p.id}
                  onClick={() => void remove(p)}
                  title="删除"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {active && (
        <div className="mt-3 grid gap-2 rounded-xl border border-line/6 bg-fg/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-fg/40 sm:grid-cols-2 lg:grid-cols-4">
          <div>默认模型：<span className="text-fg/70">{active.models.default}</span></div>
          <div>写作：<span className="text-fg/70">{active.models.writer || active.models.default}</span></div>
          <div>摘要：<span className="text-fg/70">{active.models.summarizer || active.models.default}</span></div>
          <div>温度：<span className="text-fg/70">{active.temperature}</span></div>
        </div>
      )}

      {/* ---------------- 目录选择 ---------------- */}
      <Modal
        open={catalogOpen}
        title="添加供应商"
        subtitle="选择主流厂商预设，或使用自定义配置"
        onClose={() => setCatalogOpen(false)}
        width="max-w-4xl"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/25" />
            <input
              className="input pl-9"
              placeholder="搜索名称或网址，例如 deepseek、kimi、智谱、openrouter"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PROVIDER_CATEGORIES.map((c) => {
              const count = c === '全部' ? PROVIDER_CATALOG.length + 1 : c === '自定义' ? 1 : PROVIDER_CATALOG.filter((i) => i.category === c).length
              return (
                <button
                  key={c}
                  className={`rounded-lg px-2.5 py-1.5 text-[11.5px] transition ${
                    category === c ? 'bg-accent/15 text-accent' : 'text-fg/40 hover:bg-fg/5 hover:text-fg/75'
                  }`}
                  onClick={() => setCategory(c)}
                >
                  {c} <span className="text-[9.5px] opacity-50">{count}</span>
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {showCustom && (
              <button
                className="rounded-xl border border-dashed border-line/15 bg-fg/[0.02] px-3 py-3 text-left transition hover:border-accent/40 hover:bg-fg/[0.04]"
                onClick={() => startForm()}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg/6 text-accent/80">
                    <Pencil size={14} />
                  </div>
                  <div>
                    <div className="text-[12.5px] text-fg/85">自定义配置</div>
                    <div className="text-[10px] text-fg/25">手动填写地址与 Key</div>
                  </div>
                </div>
              </button>
            )}
            {filtered.map((item) => (
              <button
                key={item.id}
                className="rounded-xl border border-line/8 bg-fg/[0.02] px-3 py-3 text-left transition hover:border-accent/40 hover:bg-fg/[0.04]"
                onClick={() => startForm(item)}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fg/6 text-[12px] text-accent/80">
                    {item.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] text-fg/85">{item.name}</div>
                    <div className="truncate text-[10px] text-fg/25">{hostOf(item.baseUrl)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {filtered.length === 0 && !showCustom && (
            <div className="py-8 text-center text-[12px] text-fg/25">没有匹配的供应商，换个关键词试试。</div>
          )}
        </div>
      </Modal>

      {/* ---------------- 配置表单 ---------------- */}
      <Modal
        open={formOpen}
        title={editingId ? '编辑供应商' : '添加供应商'}
        subtitle={editingId ? '修改后保存，使用中的配置会立即同步' : '填好地址与 Key，保存后即可使用'}
        onClose={() => setFormOpen(false)}
        width="max-w-3xl"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setFormOpen(false)}>
              取消
            </button>
            <button className="btn-ghost" disabled={testing} onClick={() => void testDraft()}>
              {testing ? <Loader2 size={14} className="animate-spin" /> : <ServerCog size={14} />} 测试连接
            </button>
            <button className="btn-ghost" disabled={saving} onClick={() => void save(false)}>
              <Save size={14} /> 仅保存
            </button>
            <button className="btn-primary" disabled={saving} onClick={() => void save(true)}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {editingId ? '保存并启用' : '保存并启用'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {presetNote && (
            <p className="rounded-lg border border-line/6 bg-fg/[0.02] px-3 py-2 text-[11.5px] leading-relaxed text-fg/40">
              {presetNote}
            </p>
          )}

          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] ${
                testResult.ok
                  ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300'
                  : 'border-red-500/25 bg-red-500/[0.06] text-red-300'
              }`}
            >
              {testResult.ok ? <CheckCircle2 size={14} className="mt-0.5" /> : <XCircle size={14} className="mt-0.5" />}
              <span className="leading-relaxed">
                {testResult.message}
                {testResult.latencyMs ? ` · ${testResult.latencyMs}ms` : ''}
              </span>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="配置名称">
              <input className="input" value={form.name} onChange={(e) => patchForm({ name: e.target.value })} placeholder="例如 DeepSeek 主号" />
            </Field>
            <Field label="API 地址" hint="任意 OpenAI 兼容服务，需包含 /v1">
              <input
                className="input font-mono text-[12px]"
                value={form.baseUrl}
                onChange={(e) => patchForm({ baseUrl: e.target.value })}
                placeholder="https://your-host/v1"
              />
            </Field>
          </div>

          <Field label="API Key" hint="使用系统安全存储加密后落盘">
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                className="input pr-10 font-mono text-[12px]"
                value={form.apiKey}
                onChange={(e) => patchForm({ apiKey: e.target.value })}
                placeholder="sk-..."
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg/30 hover:text-fg/70"
                onClick={() => setShowKey(!showKey)}
                tabIndex={-1}
                title={showKey ? '隐藏' : '显示'}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[12px] font-medium text-fg/70">模型</div>
            <span className="text-[10.5px] text-fg/25">除默认模型外均可留空，留空则跟随默认</span>
            <div className="flex-1" />
            {models.length > 0 && (
              <span className="text-[10.5px] text-emerald-300/70">
                已获取 {models.length} 个，可在每个字段右侧下拉选择
              </span>
            )}
            <button className="btn-ghost btn-sm" onClick={() => void fetchModels()}>
              <RefreshCw size={12} /> 拉取模型列表
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <ModelField
              label="默认模型"
              value={form.models.default}
              placeholder="必填，例如 deepseek-chat"
              models={models}
              onChange={(v) => patchModelRole('default', v)}
            />
            <ModelField
              label="策划模型（选题/设定/大纲）"
              value={form.models.planner}
              placeholder="留空则用默认模型"
              models={models}
              onChange={(v) => patchModelRole('planner', v)}
            />
            <ModelField
              label="写作模型（正文）"
              value={form.models.writer}
              placeholder="留空则用默认模型"
              models={models}
              onChange={(v) => patchModelRole('writer', v)}
            />
            <ModelField
              label="摘要模型"
              value={form.models.summarizer}
              placeholder="留空则用默认模型"
              models={models}
              onChange={(v) => patchModelRole('summarizer', v)}
            />
            <ModelField
              label="审校模型"
              value={form.models.judge}
              placeholder="留空则用默认模型"
              models={models}
              onChange={(v) => patchModelRole('judge', v)}
            />
            <ModelField
              label="向量模型"
              hint="留空则使用本地哈希向量（中文召回较弱）；填了会走语义检索"
              value={form.models.embedding}
              placeholder="可选，例如 text-embedding-3-small"
              models={models}
              onChange={(v) => patchModelRole('embedding', v)}
            />
            <div className="-mt-2 flex items-center gap-2">
              <button
                className="btn-ghost btn-sm"
                disabled={!!embedTestBusy}
                onClick={() => void testEmbedding()}
              >
                {embedTestBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} 测试向量模型
              </button>
              {embedResult && (
                <span className={`text-[10.5px] ${embedResult.ok ? 'text-emerald-300/80' : 'text-amber-300/80'}`}>
                  {embedResult.message}
                </span>
              )}
            </div>
            <ModelField
              label="绘图模型"
              hint="留空则使用本地封面模板"
              value={form.models.image}
              placeholder="可选"
              models={models}
              onChange={(v) => patchModelRole('image', v)}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="温度" hint="0.7~0.95 更像网文">
              <input
                type="number"
                step={0.05}
                min={0}
                max={2}
                className="input"
                value={form.temperature}
                onChange={(e) => patchForm({ temperature: Number(e.target.value) })}
              />
            </Field>
            <Field label="单次最大输出 tokens">
              <input
                type="number"
                className="input"
                value={form.maxTokens}
                onChange={(e) => patchForm({ maxTokens: Number(e.target.value) })}
              />
            </Field>
            <Field label="额外请求头（JSON）">
              <input
                className="input font-mono text-[11px]"
                value={form.extraHeaders}
                onChange={(e) => patchForm({ extraHeaders: e.target.value })}
                placeholder='{"X-Trace":"1"}'
              />
            </Field>
          </div>
        </div>
      </Modal>
    </section>
  )
}
