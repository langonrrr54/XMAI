/**
 * OpenAI 兼容协议客户端（适配各大兼容服务与厂商）
 * 支持：流式输出、JSON 模式、失败重试、用量统计、Embedding、模型列表
 */
import type { GenerationResult, ModelSettings } from '@shared/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model?: string
  /** 按用途自动选择模型（planner / writer / summarizer / judge） */
  purpose?: keyof ModelSettings['models']
  temperature?: number
  maxTokens?: number
  json?: boolean
  signal?: AbortSignal
  onDelta?: (delta: string, full: string) => void
  timeoutMs?: number
  retries?: number
}

export class LlmError extends Error {
  status: number
  detail: string
  constructor(message: string, status = 0, detail = '') {
    super(message)
    this.name = 'LlmError'
    this.status = status
    this.detail = detail
  }
}

export function normalizeBaseUrl(raw: string): string {
  let url = (raw || '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    const u = new URL(url)
    if (u.pathname === '' || u.pathname === '/') u.pathname = '/v1'
    return u.toString().replace(/\/+$/, '')
  } catch {
    return url
  }
}

/**
 * 输出上限保护：请求值不能超过供应商配置的上限。
 * 很多 OpenAI 兼容服务把单次输出卡在 4096，超了会直接 400。
 */
function clampMaxTokens(requested: number | undefined, configured: number | undefined): number {
  const cap = Math.max(512, Number(configured) || 4096)
  const want = Number(requested) || cap
  return Math.max(256, Math.min(want, cap))
}

function parseExtra(headers: string): Record<string, string> {
  if (!headers?.trim()) return {}
  try {
    const obj = JSON.parse(headers)
    if (obj && typeof obj === 'object') {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(obj)) out[k] = String(v)
      return out
    }
  } catch {
    /* 忽略非法 JSON */
  }
  return {}
}

function resolveModel(settings: ModelSettings, purpose?: keyof ModelSettings['models'], override?: string): string {
  if (override) return override
  if (purpose) {
    const m = settings.models?.[purpose]
    if (m) return m
  }
  return settings.models?.default || 'gpt-4o-mini'
}

function headers(settings: ModelSettings): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
    ...parseExtra(settings.extraHeaders)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 从任意文本中提取第一个 JSON 对象/数组（容错模型输出） */
export function extractJson<T = unknown>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  try {
    return JSON.parse(cleaned) as T
  } catch {
    /* 继续尝试括号匹配 */
  }
  const startObj = cleaned.indexOf('{')
  const startArr = cleaned.indexOf('[')
  const start = startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr)
  if (start === -1) throw new LlmError('模型未返回合法 JSON', 0, text.slice(0, 500))
  const open = cleaned[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1)
        try {
          return JSON.parse(slice) as T
        } catch (e) {
          throw new LlmError('JSON 解析失败', 0, String(e))
        }
      }
    }
  }
  throw new LlmError('模型输出 JSON 不完整', 0, text.slice(-500))
}

/** 非流式对话 */
export async function chat(
  settings: ModelSettings,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<GenerationResult> {
  const base = normalizeBaseUrl(settings.baseUrl)
  if (!base) throw new LlmError('未配置 API 地址，请在设置中选择供应商或填写自定义地址')
  if (!settings.apiKey) throw new LlmError('未配置 API Key')

  const model = resolveModel(settings, opts.purpose as never, opts.model)
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? settings.temperature ?? 0.85,
    max_tokens: clampMaxTokens(opts.maxTokens, settings.maxTokens),
    stream: false
  }
  if (opts.json) body.response_format = { type: 'json_object' }

  const retries = opts.retries ?? 3
  let lastErr: unknown
  let timedOut = false
  for (let attempt = 0; attempt < retries; attempt++) {
    const started = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 300_000)
    const onAbort = () => ctrl.abort()
    opts.signal?.addEventListener('abort', onAbort)
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify(body),
        signal: ctrl.signal
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const retryable = res.status === 429 || res.status >= 500
        if (retryable && attempt < retries - 1) {
          await sleep(1200 * Math.pow(2, attempt))
          continue
        }
        const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 240)
        throw new LlmError(
          `模型请求失败 HTTP ${res.status}${snippet ? `：${snippet}` : ''}`,
          res.status,
          text.slice(0, 800)
        )
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
        model?: string
      }
      const content = data.choices?.[0]?.message?.content || ''
      if (!content) throw new LlmError('模型返回空内容', 0, JSON.stringify(data).slice(0, 500))
      return {
        content,
        model: data.model || model,
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        elapsedMs: Date.now() - started
      }
    } catch (err) {
      lastErr = err
      if (ctrl.signal.aborted && !opts.signal?.aborted) timedOut = true
      if (err instanceof LlmError && err.status && err.status < 500 && err.status !== 429) throw err
      if (opts.signal?.aborted) throw new LlmError('已取消')
      if (attempt >= retries - 1) break
      await sleep(1200 * Math.pow(2, attempt))
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }
  if (timedOut) {
    throw new LlmError(
      `模型请求超时（单次 ${Math.round((opts.timeoutMs ?? 300_000) / 1000)} 秒），请检查网络、降低单次输出或换更快的模型`
    )
  }
  if (lastErr instanceof LlmError) throw lastErr
  throw new LlmError(`模型请求失败：${(lastErr as Error)?.message || '未知错误'}`)
}

/** 流式对话（含增量回调，最终返回完整结果） */
export async function chatStream(
  settings: ModelSettings,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<GenerationResult> {
  const base = normalizeBaseUrl(settings.baseUrl)
  if (!base) throw new LlmError('未配置 API 地址，请在设置中选择供应商或填写自定义地址')
  if (!settings.apiKey) throw new LlmError('未配置 API Key')

  const model = resolveModel(settings, opts.purpose as never, opts.model)
  const started = Date.now()
  let full = ''
  let promptTokens = 0
  let completionTokens = 0
  let usedModel = model
  let lastErr: unknown = null
  let timedOut = false
  const retries = opts.retries ?? 3

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? settings.temperature ?? 0.85,
    max_tokens: clampMaxTokens(opts.maxTokens, settings.maxTokens),
    stream: true,
    stream_options: { include_usage: true }
  }
  if (opts.json) body.response_format = { type: 'json_object' }

  for (let attempt = 0; attempt < retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 600_000)
    const onAbort = () => ctrl.abort()
    opts.signal?.addEventListener('abort', onAbort)

    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify(body),
        signal: ctrl.signal
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 240)
        const err = new LlmError(
          `模型请求失败 HTTP ${res.status}${snippet ? `：${snippet}` : ''}`,
          res.status,
          text.slice(0, 800)
        )
        if ((res.status === 429 || res.status >= 500) && attempt < retries - 1) {
          lastErr = err
          await sleep(1200 * Math.pow(2, attempt))
          continue
        }
        throw err
      }
      if (!res.body) throw new LlmError('响应体为空')
      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split(/\r?\n\r?\n/)
        buffer = parts.pop() || ''
        for (const part of parts) {
          for (const line of part.split(/\r?\n/)) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const payload = trimmed.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const json = JSON.parse(payload) as {
                choices?: { delta?: { content?: string } }[]
                usage?: { prompt_tokens?: number; completion_tokens?: number }
                model?: string
              }
              if (json.model) usedModel = json.model
              const delta = json.choices?.[0]?.delta?.content
              if (delta) {
                full += delta
                opts.onDelta?.(delta, full)
              }
              if (json.usage) {
                promptTokens = json.usage.prompt_tokens || promptTokens
                completionTokens = json.usage.completion_tokens || completionTokens
              }
            } catch {
              /* 跳过无法解析的心跳行 */
            }
          }
        }
      }
      if (!full) throw new LlmError('模型返回空内容')
      return {
        content: full,
        model: usedModel,
        promptTokens,
        completionTokens,
        elapsedMs: Date.now() - started
      }
    } catch (err) {
      lastErr = err
      if (ctrl.signal.aborted && !opts.signal?.aborted) timedOut = true
      if (opts.signal?.aborted) throw new LlmError('已取消')
      if (err instanceof LlmError && err.status && err.status < 500 && err.status !== 429) throw err
      // 已经收到部分内容时不自动重试，避免正文重复
      if (full.length > 0) {
        throw new LlmError(
          `流式输出中断（已接收 ${full.length} 字），为避免正文重复已停止重试，可重写本章`,
          0,
          String((err as Error)?.message || err)
        )
      }
      if (attempt >= retries - 1) break
      await sleep(1200 * Math.pow(2, attempt))
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }

  if (timedOut) {
    throw new LlmError(
      `模型请求超时（单次 ${Math.round((opts.timeoutMs ?? 600_000) / 1000)} 秒），本章已安全中断，可重试`
    )
  }
  if (lastErr instanceof LlmError) throw lastErr
  throw new LlmError(`模型请求失败：${(lastErr as Error)?.message || '未知错误'}`)
}

/** 获取可用模型列表 */
export async function listModels(settings: ModelSettings): Promise<string[]> {
  const base = normalizeBaseUrl(settings.baseUrl)
  if (!base) throw new LlmError('未配置 API 地址')
  const res = await fetch(`${base}/models`, { headers: headers(settings) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new LlmError(`获取模型列表失败 HTTP ${res.status}`, res.status, text.slice(0, 400))
  }
  const data = (await res.json()) as { data?: { id: string }[] }
  return (data.data || []).map((m) => m.id).sort()
}

/** Embedding；服务端不支持时返回 null 由本地兜底 */
/** embedding 调用的结果：成功 / 为什么失败 */
export interface EmbedResult {
  vecs: Float32Array[] | null
  error: string
}

export async function embedDetailed(settings: ModelSettings, texts: string[]): Promise<EmbedResult> {
  const base = normalizeBaseUrl(settings.baseUrl)
  const model = settings.models?.embedding
  if (!base) return { vecs: null, error: '未配置 API 地址' }
  if (!settings.apiKey) return { vecs: null, error: '未配置 API Key' }
  if (!model) return { vecs: null, error: '未填写向量模型名' }
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({ model, input: texts })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { vecs: null, error: `HTTP ${res.status}：${body.replace(/\s+/g, ' ').slice(0, 160)}` }
    }
    const data = (await res.json()) as { data?: { embedding: number[]; index: number }[] }
    if (!data.data?.length) return { vecs: null, error: '服务返回空向量' }
    const sorted = [...data.data].sort((a, b) => a.index - b.index)
    const vecs = sorted.map((d) => Float32Array.from(d.embedding))
    if (vecs[0].length === 0) return { vecs: null, error: '向量维度为 0' }
    return { vecs, error: '' }
  } catch (err) {
    return { vecs: null, error: `请求失败：${(err as Error).message}` }
  }
}

export async function embed(settings: ModelSettings, texts: string[]): Promise<Float32Array[] | null> {
  const r = await embedDetailed(settings, texts)
  return r.vecs
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  // 中文约 1 字 ≈ 0.75 token；英文约 4 字符 ≈ 1 token
  const cjk = (text.match(/[一-鿿]/g) || []).length
  const rest = text.length - cjk
  return Math.ceil(cjk * 0.75 + rest / 4)
}
