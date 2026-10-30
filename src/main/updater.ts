/**
 * 自动更新。
 *
 * 设计要点：
 * - 只在打包版生效（开发态直接跳过，避免误触发）
 * - 启动后延迟检查，不阻塞开窗
 * - 支持「检查 / 下载 / 立即安装」三段式，由用户决定何时重启
 * - 全部失败都静默降级，不影响正常写作
 *
 * 更新源在 package.json 的 build.publish 里配置（GitHub Releases）。
 */
import { app, BrowserWindow } from 'electron'
import type { UpdateInfo } from 'electron-updater'

export interface UpdateState {
  /** idle: 未检查 / checking: 检查中 / available: 有新版 / not-available: 已是最新 */
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
  version?: string
  releaseNotes?: string
  releaseDate?: string
  /** 下载进度 0~100 */
  progress: number
  /** downloading / downloaded */
  downloading: boolean
  downloaded: boolean
  error?: string
  /** 当前版本 */
  currentVersion: string
}

class Updater {
  private state: UpdateState = {
    status: 'idle',
    progress: 0,
    downloading: false,
    downloaded: false,
    currentVersion: ''
  }
  private autoUpdater: import('electron-updater').AppUpdater | null = null
  private initialized = false

  /**
   * 是否具备自动更新条件。
   * 不能只看 app.isPackaged：win-unpacked 直接运行 exe 时它可能为 false，
   * 但那是完整打包产物，只要 resources/app-update.yml 存在就说明能更新。
   */
  private canUpdate(): boolean {
    try {
      const resourcesPath = process.resourcesPath || ''
      if (!resourcesPath) return false
      const fs = require('node:fs') as typeof import('node:fs')
      const path = require('node:path') as typeof import('node:path')
      // electron-builder 打包时会写入 app-update.yml；开发态没有这个文件
      const marker = path.join(resourcesPath, 'app-update.yml')
      return fs.existsSync(marker)
    } catch {
      return false
    }
  }

  getState(): UpdateState {
    return { ...this.state, currentVersion: app.getVersion() }
  }

  private broadcast(): void {
    const payload = this.getState()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update:state', payload)
    }
  }

  private patch(next: Partial<UpdateState>): void {
    this.state = { ...this.state, ...next }
    this.broadcast()
  }

  /** 惰性加载 electron-updater：开发态不需要这个依赖 */
  private async ensure(): Promise<import('electron-updater').AppUpdater | null> {
    if (this.initialized) return this.autoUpdater
    this.initialized = true
    if (!this.canUpdate()) {
      console.log('[update] 当前环境不支持自动更新（缺少 app-update.yml 或为开发态）')
      return null
    }
    try {
      // electron-updater 是 CJS：动态 import 后可能是 { default: module } 或 module 本身
      const mod = (await import('electron-updater')) as unknown as {
        autoUpdater?: import('electron-updater').AppUpdater
        default?: { autoUpdater?: import('electron-updater').AppUpdater }
      }
      const autoUpdater = mod.autoUpdater || mod.default?.autoUpdater
      if (!autoUpdater) throw new Error('electron-updater 未导出 autoUpdater')
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.logger = null

      autoUpdater.on('checking-for-update', () => this.patch({ status: 'checking', error: undefined }))
      autoUpdater.on('update-available', (info: UpdateInfo) => {
        this.patch({
          status: 'available',
          version: info.version,
          releaseNotes:
            typeof info.releaseNotes === 'string'
              ? info.releaseNotes
              : Array.isArray(info.releaseNotes)
                ? info.releaseNotes.map((n) => n.note || '').join('\n')
                : '',
          releaseDate: info.releaseDate,
          progress: 0,
          downloaded: false
        })
      })
      autoUpdater.on('update-not-available', () => this.patch({ status: 'not-available' }))
      autoUpdater.on('download-progress', (p) => {
        this.patch({ downloading: true, progress: Math.round(p.percent || 0) })
      })
      autoUpdater.on('update-downloaded', () => {
        this.patch({ downloading: false, downloaded: true, progress: 100 })
      })
      autoUpdater.on('error', (err) => {
        console.warn('[update] 更新失败', err?.message || err)
        this.patch({ status: 'error', error: err?.message || String(err), downloading: false })
      })

      this.autoUpdater = autoUpdater
      return autoUpdater
    } catch (err) {
      console.warn('[update] electron-updater 加载失败', err)
      this.patch({ status: 'error', error: (err as Error).message })
      return null
    }
  }

  /** 启动后延迟检查（不阻塞界面） */
  scheduleAutoCheck(delayMs = 8000): void {
    if (!this.canUpdate()) return
    setTimeout(() => {
      void this.check(true)
    }, delayMs)
  }

  async check(silent = false): Promise<UpdateState> {
    const updater = await this.ensure()
    if (!updater) {
      if (!silent) this.patch({ status: 'error', error: '开发态不检查更新' })
      return this.getState()
    }
    try {
      this.patch({ status: 'checking', error: undefined })
      await updater.checkForUpdates()
    } catch (err) {
      // 网络不通等情况：静默模式下不打扰用户
      if (!silent) {
        this.patch({ status: 'error', error: (err as Error).message })
      } else {
        this.patch({ status: 'idle' })
      }
    }
    return this.getState()
  }

  async download(): Promise<UpdateState> {
    const updater = await this.ensure()
    if (!updater) return this.getState()
    try {
      this.patch({ downloading: true, progress: 0 })
      await updater.downloadUpdate()
    } catch (err) {
      this.patch({ status: 'error', error: (err as Error).message, downloading: false })
    }
    return this.getState()
  }

  /** 立即重启并安装 */
  install(): void {
    if (!this.autoUpdater) return
    this.autoUpdater.quitAndInstall(false, true)
  }
}

export const updater = new Updater()