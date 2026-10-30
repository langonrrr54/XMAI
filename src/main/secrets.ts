/**
 * 密钥加解密：优先使用 Electron safeStorage（系统级凭据保护），不可用时回退明文。
 * 数据库里 API Key 统一以 enc:v1:base64 形式存放。
 */
import { safeStorage } from 'electron'

const ENC_PREFIX = 'enc:v1:'

export function encryptSecret(value: string): string {
  if (!value) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
    }
  } catch {
    /* 回退明文 */
  }
  return value
}

export function decryptSecret(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
    } catch {
      return ''
    }
  }
  return stored
}

export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}
