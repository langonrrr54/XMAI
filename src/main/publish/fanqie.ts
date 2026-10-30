/**
 * 番茄小说作家后台适配器
 *
 * 三种发布模式：
 *  1. api  —— 录制回放：先在后台手动发布一次，录制真实接口，之后一键复用（推荐）
 *  2. dom  —— 页面内自动化：定位标题框与正文编辑器写入内容，可自动点发布
 *  3. manual —— 复制正文 + 打开页面，人工确认
 *
 * 登录态保存在独立分区 persist:fanqie，关掉软件也不会丢。
 */
import { BrowserWindow, clipboard, session } from 'electron'
import fs from 'node:fs'
import type { CapturedRequest, FanqieSession, FanqieTagPick, PublishJob } from '@shared/types'
import { captureRepo, chapterRepo, bookRepo, publishRepo } from '../db/repo'
import { loadSettings } from '../settings'
import { FANQIE_INJECTOR, READ_CAPTURES_JS } from './injector'

const PARTITION = 'persist:fanqie'
const ORIGIN = 'https://fanqienovel.com'

export interface RawCapture {
  id: string
  at: number
  duration: number
  url: string
  method: string
  status: number
  reqHeaders: Record<string, string>
  reqBody: string
  resHeaders: Record<string, string>
  resBody: string
  source: string
}

class FanqieService {
  private win: BrowserWindow | null = null
  private parent: BrowserWindow | null = null
  private injectedFor = new Set<number>()

  setParent(w: BrowserWindow): void {
    this.parent = w
  }

  private getSession(): Electron.Session {
    return session.fromPartition(PARTITION)
  }

  private ensureWindow(show = true): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) {
      if (show) {
        this.win.show()
        this.win.focus()
      }
      return this.win
    }
    const url = loadSettings().fanqie.writerUrl || `${ORIGIN}/main/writer/`
    this.win = new BrowserWindow({
      width: 1320,
      height: 900,
      show: false,
      title: '番茄作家后台（内置）',
      parent: this.parent || undefined,
      autoHideMenuBar: true,
      backgroundColor: '#111318',
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false
      }
    })
    this.win.setMenuBarVisibility(false)
    this.win.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )

    const inject = (): void => {
      const wc = this.win?.webContents
      if (!wc || wc.isDestroyed()) return
      wc.executeJavaScript(FANQIE_INJECTOR, true).catch(() => {
        /* 页面尚未就绪时忽略 */
      })
    }
    this.win.webContents.on('dom-ready', inject)
    this.win.webContents.on('did-navigate', inject)
    this.win.webContents.on('did-navigate-in-page', inject)
    this.win.webContents.on('did-finish-load', inject)
    this.win.on('closed', () => {
      this.win = null
      this.injectedFor.clear()
    })

    void this.win.loadURL(url)
    if (show) this.win.once('ready-to-show', () => this.win?.show())
    return this.win
  }

  async open(show = true): Promise<void> {
    const win = this.ensureWindow(show)
    if (win.webContents.getURL() && !show) return
    if (!win.webContents.getURL()) await win.loadURL(loadSettings().fanqie.writerUrl).catch(() => undefined)
  }

  close(): void {
    this.win?.close()
    this.win = null
  }

  async status(): Promise<FanqieSession> {
    const ses = this.getSession()
    const cookies = await ses.cookies.get({ url: ORIGIN }).catch(() => [])
    const names = new Set(cookies.map((c) => c.name))
    const loggedIn = names.has('sessionid') || names.has('sessionid_ss') || names.has('passport_csrf_token') || cookies.length > 8
    const url = this.win?.webContents.getURL() || ''
    return {
      loggedIn,
      url: url || loadSettings().fanqie.writerUrl,
      userName: this.win?.getTitle() || undefined,
      cookieCount: cookies.length,
      capturedTemplates: captureRepo.list().length
    }
  }

  async pageProbe(): Promise<unknown> {
    const wc = this.win?.webContents
    if (!wc) return { ready: false }
    try {
      await wc.executeJavaScript(FANQIE_INJECTOR, true)
      return await wc.executeJavaScript('(window.__XM_HELPERS__ && window.__XM_HELPERS__.probe()) || {ready:false}')
    } catch (err) {
      return { ready: false, error: String(err) }
    }
  }

  async readCaptures(): Promise<RawCapture[]> {
    const wc = this.win?.webContents
    if (!wc) return []
    try {
      const raw = (await wc.executeJavaScript(READ_CAPTURES_JS)) as string
      return JSON.parse(raw) as RawCapture[]
    } catch {
      return []
    }
  }

  async clearCaptures(): Promise<void> {
    await this.win?.webContents.executeJavaScript('(window.__XM_CAPTURE__||[]).length=0')
  }

  /** 把页面捕获到的请求存为可复用模板 */
  saveCapture(raw: RawCapture[], role: CapturedRequest['role'], name: string): string {
    return captureRepo.add({
      name,
      method: raw[0]?.method || 'POST',
      url: raw[0]?.url || '',
      headers: sanitizeHeaders(raw[0]?.reqHeaders || {}),
      body: raw[0]?.reqBody || '',
      contentType: raw[0]?.reqHeaders?.['Content-Type'] || raw[0]?.reqHeaders?.['content-type'] || '',
      role
    })
  }

  /** 等待页面加载完成（最多 15s） */
  private async waitLoaded(wc: Electron.WebContents): Promise<void> {
    if (!wc.isLoading()) return
    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        wc.removeListener('did-finish-load', done)
        wc.removeListener('did-fail-load', done)
        resolve()
      }
      wc.once('did-finish-load', done)
      wc.once('did-fail-load', done)
      setTimeout(done, 15000)
    })
  }

  /** 用选中模板发起真实请求（在已登录页面上下文里执行，自动带 Cookie） */
  async replay(tpl: CapturedRequest, vars: Record<string, string | number>): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
    const wc = this.ensureWindow(false).webContents
    if (!wc.getURL() || !wc.getURL().startsWith(ORIGIN)) {
      const loading = wc.loadURL(`${ORIGIN}/main/writer/`).catch(() => undefined)
      await Promise.race([loading, this.waitLoaded(wc)])
    }
    const body = fillTemplate(tpl.body, vars)
    const headers = sanitizeHeaders(tpl.headers)
    const script = `(async () => {
      try {
        const res = await fetch(${JSON.stringify(tpl.url)}, {
          method: ${JSON.stringify(tpl.method)},
          headers: ${JSON.stringify(headers)},
          body: ${JSON.stringify(body)},
          credentials: 'include'
        });
        const text = await res.text();
        return JSON.stringify({ ok: res.ok, status: res.status, body: text.slice(0, 8000) });
      } catch (e) {
        return JSON.stringify({ ok: false, status: 0, body: '', error: String(e) });
      }
    })()`
    try {
      const raw = (await wc.executeJavaScript(script, true)) as string
      return JSON.parse(raw)
    } catch (err) {
      return { ok: false, status: 0, body: '', error: String(err) }
    }
  }

  /** DOM 自动化：填入标题与正文 */
  async fillEditor(title: string, content: string): Promise<{ titleFound: boolean; editorFound: boolean; method: string }> {
    const wc = this.ensureWindow(true).webContents
    await this.waitLoaded(wc)
    await wc.executeJavaScript(FANQIE_INJECTOR, true).catch(() => undefined)
    const script = `(window.__XM_HELPERS__ ? window.__XM_HELPERS__.fill(${JSON.stringify(title)}, ${JSON.stringify(content)}) : {titleFound:false,editorFound:false,method:'no-helper'})`
    return (await wc.executeJavaScript(script, true)) as { titleFound: boolean; editorFound: boolean; method: string }
  }

  /** 在内置后台按番茄词表自动勾选「阅读标签」，返回每步结果 */
  async applyTags(pick: FanqieTagPick): Promise<unknown> {
    const wc = this.ensureWindow(true).webContents
    await this.waitLoaded(wc)
    await wc.executeJavaScript(FANQIE_INJECTOR, true).catch(() => undefined)
    const script = `(async () => {
      if (!window.__XM_HELPERS__ || !window.__XM_HELPERS__.applyTags) return { ok: false, reason: 'helper-missing' };
      return await window.__XM_HELPERS__.applyTags(${JSON.stringify(pick)});
    })()`
    return wc.executeJavaScript(script, true)
  }

  /** 读取弹窗里当前勾选的标签 */
  async readTags(): Promise<unknown> {
    const wc = this.ensureWindow(false).webContents
    await wc.executeJavaScript(FANQIE_INJECTOR, true).catch(() => undefined)
    return wc.executeJavaScript(
      '(window.__XM_HELPERS__ && window.__XM_HELPERS__.readTagSelection()) || null',
      true
    )
  }

  async clickByText(texts: string[]): Promise<string | null> {
    const wc = this.win?.webContents
    if (!wc) return null
    return (await wc.executeJavaScript(
      `(window.__XM_HELPERS__ ? window.__XM_HELPERS__.click(${JSON.stringify(texts)}) : null)`,
      true
    )) as string | null
  }

  /* ------------------------ 发布入口 ------------------------ */

  async publishChapter(
    bookId: string,
    chapterId: string,
    mode: 'api' | 'dom' | 'manual'
  ): Promise<{ job: PublishJob; message: string; detail?: unknown }> {
    const chapter = chapterRepo.get(chapterId)
    const book = bookRepo.get(bookId)
    if (!chapter || !book) throw new Error('章节或书籍不存在')
    if (!chapter.content.trim()) throw new Error('章节正文为空，无法发布')

    const payload = { title: chapter.title, chapterNo: chapter.chapterNo, wordCount: chapter.wordCount, mode }
    const jobId = publishRepo.create(bookId, chapterId, payload)
    publishRepo.update(jobId, 'running', null)

    try {
      if (mode === 'manual') {
        clipboard.writeText(`第${chapter.chapterNo}章 ${chapter.title}\n\n${chapter.content}`)
        await this.open(true)
        publishRepo.update(jobId, 'need_manual', { copied: true }, '已复制到剪贴板，请在页面中粘贴发布')
        return { job: this.job(jobId), message: '正文已复制，浏览器已打开，请人工确认发布' }
      }

      if (mode === 'dom') {
        const r = await this.fillEditor(chapter.title, chapter.content)
        if (!r.editorFound) {
          publishRepo.update(jobId, 'need_manual', r, '未找到正文编辑器，请手动定位到章节编辑页后重试')
          return { job: this.job(jobId), message: '未找到编辑器：请先在内置浏览器中进入"新建章节"页面' }
        }
        if (loadSettings().fanqie.autoPublish) {
          await sleep(loadSettings().fanqie.publishDelayMs)
          const clicked = await this.clickByText(['发布', '提交', '确定发布'])
          publishRepo.update(jobId, clicked ? 'success' : 'need_manual', { ...r, clicked }, clicked ? '' : '已填入内容但未找到发布按钮')
          return { job: this.job(jobId), message: clicked ? `已填入并点击「${clicked}」` : '已填入内容，请手动点击发布' }
        }
        publishRepo.update(jobId, 'need_manual', r, '')
        return { job: this.job(jobId), message: '已填入标题与正文，请人工点击发布' }
      }

      // api 回放
      const templates = captureRepo.list().filter((t) => t.role !== 'unknown' && t.role !== 'query')
      if (!templates.length) {
        publishRepo.update(jobId, 'need_manual', null, '没有可用的接口模板')
        return { job: this.job(jobId), message: '尚未录制发布接口：请在内置浏览器手动发布一章并保存接口模板' }
      }
      const order: CapturedRequest['role'][] = ['create_draft', 'save_content', 'publish']
      const ordered = order
        .map((r) => templates.find((t) => t.role === r))
        .filter((x): x is CapturedRequest => !!x)
      const useList = ordered.length ? ordered : templates

      const vars: Record<string, string | number> = {
        title: chapter.title,
        content: chapter.content,
        chapterNo: chapter.chapterNo,
        bookName: book.title,
        wordCount: chapter.wordCount
      }
      const results: unknown[] = []
      for (const tpl of useList) {
        const res = await this.replay(tpl, vars)
        results.push({ role: tpl.role, ok: res.ok, status: res.status })
        if (!res.ok) {
          publishRepo.update(jobId, 'failed', { results }, `接口 ${tpl.role} 失败：HTTP ${res.status} ${res.body.slice(0, 200)}`)
          const cur = this.job(jobId)
          cur.error = `接口 ${tpl.role} 失败：HTTP ${res.status}`
          return { job: cur, message: '发布失败，请检查录制模板或改用页面自动化', detail: results }
        }
        // 抽取响应中的新章节 id，供后续模板使用
        const newId = extractEntityId(res.body)
        if (newId) vars.chapterId = newId
        await sleep(loadSettings().fanqie.publishDelayMs)
      }
      chapterRepo.update(chapterId, { status: 'published' })
      publishRepo.update(jobId, 'success', { results })
      return { job: this.job(jobId), message: `已通过 ${useList.length} 个接口完成发布`, detail: results }
    } catch (err) {
      publishRepo.update(jobId, 'failed', null, (err as Error).message)
      return { job: this.job(jobId), message: `发布失败：${(err as Error).message}` }
    }
  }

  private job(id: string): PublishJob {
    const job = publishRepo.get(id)
    if (!job) throw new Error('发布任务不存在')
    return job
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const blocked = new Set(['cookie', 'host', 'content-length', 'connection', 'accept-encoding', 'origin', 'referer', 'user-agent'])
  for (const [k, v] of Object.entries(headers || {})) {
    if (blocked.has(k.toLowerCase())) continue
    out[k] = v
  }
  if (!Object.keys(out).some((k) => k.toLowerCase() === 'content-type') && !out['Content-Type']) {
    out['Content-Type'] = 'application/json'
  }
  return out
}

const TITLE_KEY = /(^|_|\b)(title|chapter_?name|name)($|_|\b)/i
const CONTENT_KEY = /(content|text|body|paragraph|article_?content|chapter_?content)/i
const CHNO_KEY = /(chapter_?no|chapter_?num|chapter_?index|serial_?number|section_?no)/i

/** 把章节数据写入录制下来的请求体（JSON / 表单 / 原始文本） */
export function fillTemplate(bodyRaw: string, vars: Record<string, string | number>): string {
  if (!bodyRaw) return ''
  const replaceVars = (s: string): string =>
    s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => String(vars[k] ?? ''))

  try {
    const obj = JSON.parse(bodyRaw)
    const walk = (node: unknown, key = ''): unknown => {
      if (Array.isArray(node)) return node.map((v) => walk(v, key))
      if (node && typeof node === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v, k)
        return out
      }
      if (typeof node === 'string') {
        const replaced = replaceVars(node)
        if (CONTENT_KEY.test(key) && /^(content|text|body)$/i.test(key)) return vars.content
        if (TITLE_KEY.test(key) && !/id$/i.test(key)) return vars.title
        return replaced
      }
      if (typeof node === 'number') {
        if (CHNO_KEY.test(key)) return Number(vars.chapterNo ?? node)
        if (/(word_?count)/i.test(key)) return Number(vars.wordCount ?? node)
        return node
      }
      return node
    }
    return JSON.stringify(walk(obj))
  } catch {
    // 表单或纯文本
    const replaced = replaceVars(bodyRaw)
    if (CONTENT_KEY.test(replaced) && /=\{2\}/.test(bodyRaw)) return replaced
    try {
      const params = new URLSearchParams(bodyRaw)
      let touched = false
      for (const k of Array.from(params.keys())) {
        if (TITLE_KEY.test(k)) { params.set(k, String(vars.title)); touched = true }
        else if (CONTENT_KEY.test(k)) { params.set(k, String(vars.content)); touched = true }
        else if (CHNO_KEY.test(k)) { params.set(k, String(vars.chapterNo)); touched = true }
      }
      return touched ? params.toString() : replaced
    } catch {
      return replaced
    }
  }
}

function extractEntityId(resBody: string): string | null {
  try {
    const obj = JSON.parse(resBody)
    let found: string | null = null
    const walk = (n: unknown): void => {
      if (found || !n || typeof n !== 'object') return
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (found) return
        if (/^(article_?id|chapter_?id|item_?id|book_?id|draft_?id|id)$/i.test(k) && (typeof v === 'string' || typeof v === 'number')) {
          const s = String(v)
          if (s.length >= 6 && s !== '0') { found = s; return }
        }
        walk(v)
      }
    }
    walk(obj)
    return found
  } catch {
    return null
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const fanqie = new FanqieService()

/** 供 IPC 使用：导入本地封面到番茄（若接口模板支持）——预留 */
export function coverFileOf(bookId: string): string | null {
  const book = bookRepo.get(bookId)
  if (book?.coverPath && fs.existsSync(book.coverPath)) return book.coverPath
  return null
}
