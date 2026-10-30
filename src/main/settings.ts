import type { AppSettings, ModelSettings } from '@shared/types'
import { providerRepo, settingsRepo } from './db/repo'
import { decryptSecret, encryptSecret, maskSecret } from './secrets'

const SETTINGS_KEY = 'app_settings'
export const ACTIVE_PROVIDER_KEY = 'active_provider_id'

export const DEFAULT_SETTINGS: AppSettings = {
  model: {
    baseUrl: '',
    apiKey: '',
    models: {
      default: 'gpt-4o',
      planner: 'gpt-4o',
      writer: 'gpt-4o',
      summarizer: 'gpt-4o-mini',
      judge: 'gpt-4o-mini',
      embedding: '',
      image: ''
    },
    temperature: 0.85,
    maxTokens: 8192,
    concurrency: 1,
    extraHeaders: ''
  },
  fanqie: {
    writerUrl: 'https://fanqienovel.com/main/writer/',
    autoPublish: false,
    useApiReplay: true,
    publishDelayMs: 1500
  },
  writing: {
    autoReview: true,
    consistencyCheck: true,
    contextBudget: 32000
  },
  ui: { theme: 'dark', accent: 'amber' }
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch as T) ?? base
  const out = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = (base as Record<string, unknown>)[k]
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? deepMerge(cur, v) : v
  }
  return out as T
}

export function getActiveProviderId(): string {
  return settingsRepo.get<string>(ACTIVE_PROVIDER_KEY, '')
}

export function setActiveProviderId(id: string): void {
  settingsRepo.set(ACTIVE_PROVIDER_KEY, id)
}

/**
 * 读取设置。若存在激活的供应商配置，以该配置覆盖 model 字段——
 * 供应商表是多套配置的唯一事实来源，settings.model 只是运行时缓存。
 */
export function loadSettings(): AppSettings {
  const stored = settingsRepo.get<Partial<AppSettings>>(SETTINGS_KEY, {})
  const merged = deepMerge(DEFAULT_SETTINGS, stored)
  merged.model.apiKey = decryptSecret((stored.model as ModelSettings | undefined)?.apiKey || '')

  const activeId = getActiveProviderId()
  if (activeId) {
    const p = providerRepo.get(activeId)
    if (p) {
      merged.model = {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        models: { ...merged.model.models, ...p.models },
        temperature: p.temperature,
        maxTokens: p.maxTokens,
        concurrency: merged.model.concurrency,
        extraHeaders: p.extraHeaders
      }
    }
  }
  return merged
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const merged = deepMerge(current, patch)
  const toStore: AppSettings = {
    ...merged,
    model: { ...merged.model, apiKey: encryptSecret(merged.model.apiKey) }
  }
  settingsRepo.set(SETTINGS_KEY, toStore)
  return merged
}

export function maskKey(key: string): string {
  return maskSecret(key)
}
