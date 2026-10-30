import { app, BrowserWindow, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { backupDaily, closeDatabase, initDatabase } from './db/database'
import { registerIpc } from './ipc'
import { fanqie } from './publish/fanqie'
import { updater } from './updater'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

// 统一应用名，确保 userData 路径稳定（%APPDATA%/熊喵AI写作）
app.setName('熊喵AI写作')

/** 应用图标：开发态取 resources/icon.ico，打包后取 resourcesPath 下的同名文件 */
function appIconPath(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(app.getAppPath(), 'resources', 'icon.ico'),
    path.join(process.cwd(), 'resources', 'icon.ico')
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return ''
}
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: '熊喵AI写作',
    backgroundColor: '#0a0c11',
    autoHideMenuBar: true,
    ...(appIconPath() ? { icon: appIconPath() } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 开发期自检：XM_SMOKE=1 时截图并记录渲染进程报错，然后退出
  if (process.env.XM_SMOKE) {
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message}`)
    })
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          // 可选：执行一段渲染进程脚本（仅开发自检用）
          const evalFile = process.env.XM_SMOKE_EVAL_FILE
          const evalCode = evalFile && fs.existsSync(evalFile) ? fs.readFileSync(evalFile, 'utf-8') : process.env.XM_SMOKE_EVAL
          if (evalCode) {
            await win.webContents.executeJavaScript(evalCode, true)
            await new Promise((r) => setTimeout(r, Number(process.env.XM_SMOKE_WAIT || 3000)))
          }
          const img = await win.webContents.capturePage()
          const resized = img.resize({ width: 1280 })
          const out = path.join(process.cwd(), 'data', 'smoke.png')
          fs.mkdirSync(path.dirname(out), { recursive: true })
          fs.writeFileSync(out, resized.toPNG())
          console.log('[smoke] screenshot saved', out)
        } catch (err) {
          console.error('[smoke] capture failed', err)
        }
        if (process.env.XM_SMOKE_KEEP) return
        setTimeout(() => app.quit(), 400)
      }, 2000)
    })
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.xiongmao.aiwriter')
    await initDatabase()
    backupDaily()
    // 启动时自动对齐索引：换了向量模型也不用用户手动重建
    void (async () => {
      try {
        const { ensureAllIndexesFresh } = await import('./memory/retriever')
        const rebuilt = await ensureAllIndexesFresh()
        if (rebuilt.length) {
          console.log('[memory] 已自动重建索引:', rebuilt.map((r) => `${r.title}(${r.reason})`).join('; '))
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send('memory:autoRebuilt', rebuilt)
            }
          }
        }
      } catch (err) {
        console.warn('[memory] 启动索引检查失败', err)
      }
    })()
    setInterval(backupDaily, 30 * 60 * 1000)
    registerIpc()
    mainWindow = createWindow()
    fanqie.setParent(mainWindow)
    // 启动 8 秒后静默检查更新（不打扰用户，有新版才提示）
    updater.scheduleAutoCheck(8000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
        if (mainWindow) fanqie.setParent(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    closeDatabase()
  })
}
