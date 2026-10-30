/**
 * 封面生成器
 * - local：纯 SVG 程序化排版（零依赖、必定成功），再栅格化为 PNG
 * - ai：调用 OpenAI 兼容的 /images/generations，失败自动回退 local
 * 产物：<data>/covers/<bookId>.png 与 .svg
 */
import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Book } from '@shared/types'
import { chat, normalizeBaseUrl } from '../llm/client'
import * as P from '../llm/prompts'
import { loadSettings } from '../settings'
import { getDataDir } from '../db/database'
import { bookRepo } from '../db/repo'

const W = 900
const H = 1200

const PALETTES = [
  { bg1: '#0b1022', bg2: '#241338', accent: '#f4c96b', sub: '#8ea2ff' },
  { bg1: '#120b08', bg2: '#3a1b12', accent: '#ffb35c', sub: '#ff7a59' },
  { bg1: '#071410', bg2: '#123a2e', accent: '#7ee0c0', sub: '#d9b36c' },
  { bg1: '#101018', bg2: '#2b2340', accent: '#c9a6ff', sub: '#7fd1ff' },
  { bg1: '#140a10', bg2: '#3a1024', accent: '#ff9bb3', sub: '#ffd166' }
]

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 封面左右留白后的可用宽度 */
const TITLE_SAFE_WIDTH = 760

/**
 * 按最长一行反算字号：字号 = (可用宽度 / 字数) - 字间距。
 * 原来固定 132/112/92，长书名（每行 10 字以上）会直接超出画布被裁掉。
 */
function fitFontSize(lines: string[], preferred: number): number {
  const longest = Math.max(...lines.map((l) => l.length), 1)
  const letterSpacing = 6
  const byWidth = Math.floor(TITLE_SAFE_WIDTH / longest) - letterSpacing
  return Math.max(48, Math.min(preferred, byWidth))
}

function splitTitle(title: string): string[] {
  const clean = title.replace(/[《》]/g, '').trim()
  if (clean.length <= 5) return [clean]
  const lines: string[] = []
  // 超过 8 字拆 2 行，超过 12 字拆 3 行，保证每行长度接近
  const rows = clean.length <= 8 ? 2 : clean.length <= 12 ? 2 : 3
  const per = Math.ceil(clean.length / rows)
  for (let i = 0; i < clean.length; i += per) lines.push(clean.slice(i, i + per))
  return lines.slice(0, 3)
}

export function buildLocalSvg(book: Book, bgImageHref?: string, variant = 0): string {
  const p = PALETTES[(hashCode(book.title || book.id) + variant) % PALETTES.length]
  const lines = splitTitle(book.title || '未命名作品')
  const preferredSize = lines.length === 1 ? 132 : lines.length === 2 ? 112 : 92
  const fontSize = fitFontSize(lines, preferredSize)
  // 标题整体上移，避免长书名向下顶到副标题与底部信息
  const startY = lines.length === 1 ? 520 : lines.length === 2 ? 470 : 420

  const titleSvg = lines
    .map((line, i) => {
      const y = startY + i * Math.round(fontSize * 1.16)
      return `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="${fontSize}"
        font-family="'Noto Serif SC','Source Han Serif SC','STZhongsong',serif" font-weight="700"
        fill="url(#gold)" letter-spacing="6" filter="url(#soft)">${esc(line)}</text>`
    })
    .join('\n')

  const tags = (book.tags || []).slice(0, 3)
  const tagSvg = tags
    .map((t, i) => {
      const y = 1030 + i * 0
      const total = tags.length
      const width = 26 + t.length * 18
      const gap = 14
      const allWidth = tags.reduce((s, x) => s + 26 + x.length * 18 + gap, -gap)
      const startX = (W - allWidth) / 2
      let x = startX
      for (let k = 0; k < i; k++) x += 26 + tags[k].length * 18 + gap
      return `<g><rect x="${x}" y="${y - 24}" width="${width}" height="38" rx="19"
        fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.25)"/>
        <text x="${x + width / 2}" y="${y + 2}" text-anchor="middle" font-size="20"
          font-family="'Microsoft YaHei',sans-serif" fill="rgba(255,255,255,0.86)">${esc(t)}</text></g>`
    })
    .join('\n')

  const meta = book.workType === 'short'
    ? [book.genre, `${book.wordsPerChapter}字短篇`].filter(Boolean).join(' · ')
    : [book.genre, `${book.targetChapters}章长篇`].filter(Boolean).join(' · ')

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6d8"/><stop offset="0.45" stop-color="${p.accent}"/>
      <stop offset="1" stop-color="#c08a3e"/>
    </linearGradient>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(0,0,0,0.15)"/><stop offset="0.45" stop-color="rgba(0,0,0,0.35)"/>
      <stop offset="1" stop-color="rgba(0,0,0,0.92)"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="${p.sub}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${p.sub}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${bgImageHref ? `<image href="${bgImageHref}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` : ''}
  <rect width="${W}" height="${H}" fill="url(#veil)" opacity="${bgImageHref ? 0.78 : 0.5}"/>
  <rect width="${W}" height="${H}" fill="url(#halo)"/>
  <g opacity="0.5">
    <circle cx="740" cy="240" r="180" fill="none" stroke="${p.accent}" stroke-opacity="0.14" stroke-width="2"/>
    <circle cx="740" cy="240" r="250" fill="none" stroke="${p.accent}" stroke-opacity="0.08" stroke-width="2"/>
    <circle cx="150" cy="900" r="210" fill="none" stroke="${p.sub}" stroke-opacity="0.10" stroke-width="2"/>
  </g>
  <path d="M0 980 L180 860 L330 950 L520 820 L700 930 L900 840 L900 1200 L0 1200 Z"
        fill="rgba(0,0,0,0.35)"/>
  <path d="M0 1060 L220 960 L420 1040 L640 930 L900 1020 L900 1200 L0 1200 Z"
        fill="rgba(0,0,0,0.45)"/>
  <rect x="60" y="70" width="120" height="34" rx="17" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.25)"/>
  <text x="120" y="93" text-anchor="middle" font-size="18" font-family="'Microsoft YaHei',sans-serif"
        fill="rgba(255,255,255,0.82)">${esc(book.genre || '小说')}</text>
  <line x1="330" y1="150" x2="570" y2="150" stroke="${p.accent}" stroke-opacity="0.5" stroke-width="1.5"/>
  ${titleSvg}
  <text x="${W / 2}" y="${startY + lines.length * Math.round(fontSize * 1.16) + 20}" text-anchor="middle"
        font-size="30" font-family="'Noto Serif SC',serif" fill="rgba(255,255,255,0.72)" letter-spacing="10">
    ${esc(book.subtitle || (book.workType === 'short' ? '短篇故事' : '长篇连载'))}
  </text>
  <line x1="300" y1="985" x2="600" y2="985" stroke="${p.accent}" stroke-opacity="0.35" stroke-width="1"/>
  ${tagSvg}
  <text x="${W / 2}" y="1140" text-anchor="middle" font-size="22" font-family="'Microsoft YaHei',sans-serif"
        fill="rgba(255,255,255,0.55)">${esc(meta)}</text>
  <text x="${W / 2}" y="1178" text-anchor="middle" font-size="20" font-family="'Microsoft YaHei',sans-serif"
        fill="rgba(255,255,255,0.42)">熊喵AI写作 生成</text>
</svg>`
}

/** 用离屏窗口把 HTML/SVG 渲染成 PNG */
export async function renderToPng(html: string, width: number, height: number, outPath: string): Promise<boolean> {
  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      transparent: false,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
    })
    win.webContents.setFrameRate(30)
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    await win.loadURL(dataUrl)
    await new Promise((r) => setTimeout(r, 600))
    const image = await win.webContents.capturePage()
    const png = image.toPNG()
    if (!png?.length) return false
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, png)
    return true
  } catch (err) {
    console.error('[cover] 渲染失败', err)
    return false
  } finally {
    win?.destroy()
  }
}

async function aiImage(book: Book): Promise<string | null> {
  const s = loadSettings().model
  const base = normalizeBaseUrl(s.baseUrl)
  if (!base || !s.apiKey) return null
  const model = s.models.image || ''
  if (!model) return null
  try {
    const promptRes = await chat(
      s,
      [
        { role: 'system', content: P.coverPromptSystem() },
        { role: 'user', content: P.coverPromptUser(book) }
      ],
      { purpose: 'planner', temperature: 0.7, maxTokens: 500 }
    )
    const prompt = promptRes.content.trim().replace(/^["“]|["”]$/g, '')
    const res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${s.apiKey}`,
        ...(s.extraHeaders ? (JSON.parse(s.extraHeaders) as Record<string, string>) : {})
      },
      body: JSON.stringify({ model, prompt, n: 1, size: '1024x1536', response_format: 'b64_json' })
    })
    if (!res.ok) return null
    const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] }
    const first = data.data?.[0]
    if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`
    if (first?.url) {
      const img = await fetch(first.url)
      if (!img.ok) return null
      const buf = Buffer.from(await img.arrayBuffer())
      return `data:image/png;base64,${buf.toString('base64')}`
    }
    return null
  } catch (err) {
    console.warn('[cover] AI 封面失败，回退本地生成', err)
    return null
  }
}

export interface CoverResult {
  path: string
  svgPath: string
  dataUrl: string
  mode: 'ai' | 'local'
}

export async function generateCover(bookId: string, useAi = true, variant = 0): Promise<CoverResult> {
  const book = bookRepo.get(bookId)
  if (!book) throw new Error('书籍不存在')
  const dir = path.join(getDataDir(), 'covers')
  fs.mkdirSync(dir, { recursive: true })
  const pngPath = path.join(dir, `${bookId}.png`)
  const svgPath = path.join(dir, `${bookId}.svg`)

  const aiHref = useAi ? await aiImage(book) : null
  const svg = buildLocalSvg(book, aiHref || undefined, variant)
  const ok = await renderToPng(
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#000}</style></head><body>${svg}</body></html>`,
    W,
    H,
    pngPath
  )
  if (!ok) {
    // 渲染失败时也保留 SVG，至少可在界面预览
    fs.writeFileSync(svgPath, svg, 'utf-8')
    throw new Error('封面渲染失败（离屏渲染不可用）')
  }
  fs.writeFileSync(svgPath, svg, 'utf-8')
  bookRepo.update(bookId, { coverPath: pngPath })

  // 缩小为 3:4 缩略图数据，供界面直接显示
  const base64 = fs.readFileSync(pngPath).toString('base64')
  return {
    path: pngPath,
    svgPath,
    dataUrl: `data:image/png;base64,${base64}`,
    mode: aiHref ? 'ai' : 'local'
  }
}

export function readCoverAsDataUrl(bookId: string): string | null {
  const book = bookRepo.get(bookId)
  if (!book?.coverPath) return null
  try {
    if (fs.existsSync(book.coverPath)) {
      const ext = path.extname(book.coverPath).toLowerCase()
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
      return `data:${mime};base64,${fs.readFileSync(book.coverPath).toString('base64')}`
    }
  } catch {
    /* ignore */
  }
  return null
}

/** 导入用户自选封面图片 */
export function importCover(bookId: string, sourcePath: string): { path: string; dataUrl: string } {
  const book = bookRepo.get(bookId)
  if (!book) throw new Error('书籍不存在')
  const ext = path.extname(sourcePath).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    throw new Error('仅支持 PNG / JPG / JPEG / WEBP 图片')
  }
  const stat = fs.statSync(sourcePath)
  if (stat.size > 12 * 1024 * 1024) throw new Error('图片不能超过 12MB')

  const dir = path.join(getDataDir(), 'covers')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${bookId}-upload${ext}`)
  fs.copyFileSync(sourcePath, dest)
  bookRepo.update(bookId, { coverPath: dest })

  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
  return {
    path: dest,
    dataUrl: `data:${mime};base64,${fs.readFileSync(dest).toString('base64')}`
  }
}
