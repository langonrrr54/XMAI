/**
 * 作品导出：TXT（带 UTF-8 BOM，Windows 记事本可直接打开）与 EPUB 3（手动打包 ZIP，无额外依赖）。
 * 章节按 chapter_no 升序，正文与标题完整保留，特殊字符做 XML 转义。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Chapter } from '@shared/types'
import { bookRepo, chapterRepo } from './db/repo'
import { getDataDir } from './db/database'

export interface ExportResult {
  path: string
  format: 'txt' | 'epub'
  bytes: number
  chapters: number
}

const safeName = (name: string): string =>
  (name || '未命名').replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名'

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

function loadBody(bookId: string): { title: string; synopsis: string; short: boolean; chapters: Chapter[] } {
  const book = bookRepo.get(bookId)
  if (!book) throw new Error('书籍不存在')
  const chapters = chapterRepo
    .list(bookId, true)
    .filter((c) => c.content.trim())
    .sort((a, b) => a.chapterNo - b.chapterNo)
  if (!chapters.length) throw new Error('还没有可导出的正文')
  return { title: book.title, synopsis: book.synopsis, short: book.workType === 'short', chapters }
}

/* ----------------------------- TXT ----------------------------- */

export function buildTxt(bookId: string): { data: Buffer; filename: string; chapters: number } {
  const { title, synopsis, short, chapters } = loadBody(bookId)
  const lines: string[] = []
  lines.push(`《${title}》`)
  if (synopsis.trim()) lines.push('', `简介：${synopsis.trim()}`)
  lines.push('', '='.repeat(40), '')

  if (short) {
    const c = chapters[0]
    lines.push(c.content.trim(), '')
  } else {
    for (const c of chapters) {
      lines.push(`第${c.chapterNo}章 ${c.title}`.trim(), '', c.content.trim(), '')
    }
  }

  // UTF-8 BOM + CRLF，保证 Windows 记事本正常识别换行与编码
  const text = '﻿' + lines.join('\r\n')
  return { data: Buffer.from(text, 'utf8'), filename: `${safeName(title)}.txt`, chapters: chapters.length }
}

/* ----------------------------- EPUB ----------------------------- */

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  data: Buffer
}

/** 仅存储（不压缩）的 ZIP 写入器，足够生成 EPUB */
function zipStore(entries: ZipEntry[]): Buffer {
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff

  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data)
    const size = e.data.length

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0x0800, 6)
    lh.writeUInt16LE(0, 8)
    lh.writeUInt16LE(dosTime, 10)
    lh.writeUInt16LE(dosDate, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(size, 18)
    lh.writeUInt32LE(size, 22)
    lh.writeUInt16LE(name.length, 26)
    lh.writeUInt16LE(0, 28)
    locals.push(lh, name, e.data)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x0800, 8)
    ch.writeUInt16LE(0, 10)
    ch.writeUInt16LE(dosTime, 12)
    ch.writeUInt16LE(dosDate, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(size, 20)
    ch.writeUInt32LE(size, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt16LE(0, 30)
    ch.writeUInt16LE(0, 32)
    ch.writeUInt16LE(0, 34)
    ch.writeUInt16LE(0, 36)
    ch.writeUInt32LE(0, 38)
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, name)

    offset += 30 + name.length + size
  }

  const centralSize = centrals.reduce((s, b) => s + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, ...centrals, eocd])
}

function paragraphs(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeXml(line)}</p>`)
    .join('\n')
}

export function buildEpub(bookId: string): { data: Buffer; filename: string; chapters: number } {
  const { title, synopsis, short, chapters } = loadBody(bookId)
  const id = `urn:xiongmao:${bookId}`
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  const items = chapters.map((c, i) => ({
    id: `c${i + 1}`,
    file: `text/chapter-${String(i + 1).padStart(3, '0')}.xhtml`,
    heading: short ? title : `第${c.chapterNo}章 ${c.title}`,
    content: c.content
  }))

  const entries: ZipEntry[] = []
  entries.push({ name: 'mimetype', data: Buffer.from('application/epub+zip', 'ascii') })
  entries.push({
    name: 'META-INF/container.xml',
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>\n`,
      'utf8'
    )
  })
  entries.push({
    name: 'OEBPS/style.css',
    data: Buffer.from(
      `body{font-family:"Noto Serif SC","Songti SC",serif;line-height:2;margin:5%}h1{font-size:1.4em;margin:1.2em 0 0.8em}p{margin:0 0 0.9em;text-indent:2em}`,
      'utf8'
    )
  })

  const manifestItems = items
    .map((it) => `    <item id="${it.id}" href="${it.file}" media-type="application/xhtml+xml"/>`)
    .join('\n')
  const spineItems = items.map((it) => `    <itemref idref="${it.id}"/>`).join('\n')

  entries.push({
    name: 'OEBPS/content.opf',
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(id)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>熊喵AI写作</dc:creator>
    <dc:description>${escapeXml(synopsis || '')}</dc:description>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>
`,
      'utf8'
    )
  })

  const navLis = items.map((it) => `      <li><a href="${it.file}">${escapeXml(it.heading)}</a></li>`).join('\n')
  entries.push({
    name: 'OEBPS/nav.xhtml',
    data: Buffer.from(
      `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title><link rel="stylesheet" href="style.css" type="text/css"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${navLis}
    </ol>
  </nav>
</body>
</html>
`,
      'utf8'
    )
  })

  for (const it of items) {
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><meta charset="utf-8"/><title>${escapeXml(it.heading)}</title><link rel="stylesheet" href="../style.css" type="text/css"/></head>
<body>
  <h1>${escapeXml(it.heading)}</h1>
${paragraphs(it.content)}
</body>
</html>
`
    entries.push({ name: `OEBPS/${it.file}`, data: Buffer.from(xhtml, 'utf8') })
  }

  return { data: zipStore(entries), filename: `${safeName(title)}.epub`, chapters: items.length }
}

/* ----------------------------- 落盘 ----------------------------- */

export function exportBook(bookId: string, format: 'txt' | 'epub', targetPath?: string): ExportResult {
  const built = format === 'epub' ? buildEpub(bookId) : buildTxt(bookId)
  let outPath = targetPath
  if (!outPath) {
    const dir = path.join(getDataDir(), 'exports')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    outPath = path.join(dir, `${built.filename.replace(/\.(txt|epub)$/, '')}-${stamp}.${format}`)
  } else {
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
  }
  fs.writeFileSync(outPath, built.data)
  return { path: outPath, format, bytes: built.data.length, chapters: built.chapters }
}
