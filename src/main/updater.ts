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
    if (!app.isPackaged) {
      console.log('[update] 开发态跳过自动更新')
      return null
    }
    try {
      const { autoUpdater } = await import('electron-updater')
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
    if (!app.isPackaged) return
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