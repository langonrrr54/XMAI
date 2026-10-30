/**
 * 多供应商配置服务：供应商表是配置的唯一事实来源，
 * 激活某个供应商时把它的地址/Key/模型同步到 settings.model 供运行时使用。
 */
import type { AppSettings, ModelSettings, ProviderInput, ProviderProfile } from '@shared/types'
import { providerRepo } from './db/repo'
import {
  DEFAULT_SETTINGS,
  getActiveProviderId,
  loadSettings,
  saveSettings,
  setActiveProviderId
} from './settings'

export function providerToModel(p: ProviderProfile): ModelSettings {
  return {
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    models: p.models,
    temperature: p.temperature,
    maxTokens: p.maxTokens,
    concurrency: loadSettings().model.concurrency || 1,
    extraHeaders: p.extraHeaders
  }
}

export function listProviders(): ProviderProfile[] {
  const activeId = getActiveProviderId()
  return providerRepo.list().map((p) => ({ ...p, active: p.id === activeId }))
}

export function activateProvider(id: string): AppSettings {
  const p = providerRepo.get(id)
  if (!p) throw new Error('供应商配置不存在')
  setActiveProviderId(id)
  return saveSettings({ model: providerToModel(p) })
}

export function createProvider(input: ProviderInput, activate: boolean): AppSettings {
  const id = providerRepo.create(input)
  if (activate || !getActiveProviderId()) return activateProvider(id)
  return loadSettings()
}

export function updateProvider(id: string, patch: Partial<ProviderInput>): AppSettings {
  providerRepo.update(id, patch)
  if (getActiveProviderId() === id) {
    const p = providerRepo.get(id)
    if (p) return saveSettings({ model: providerToModel(p) })
  }
  return loadSettings()
}

export function removeProvider(id: string): AppSettings {
  const wasActive = getActiveProviderId() === id
  providerRepo.remove(id)
  if (!wasActive) return loadSettings()

  const next = providerRepo.list()[0]
  if (next) return activateProvider(next.id)

  setActiveProviderId('')
  return saveSettings({ model: { ...DEFAULT_SETTINGS.model } })
}
