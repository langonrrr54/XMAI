/**
 * SQLite 持久层（sql.js / WASM，无原生依赖）
 * - 启动时从磁盘加载 .db，变更后防抖写回
 * - 提供同步 query/run 接口，业务层无需感知底层
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'

let SQL: SqlJsStatic | null = null
let raw: Database | null = null
let dbFile = ''
let persistTimer: NodeJS.Timeout | null = null
let dirty = false

function resolveWasm(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'sql-wasm.wasm'),
    path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
}

export function getDataDir(): string {
  if (process.env.XM_DATA_DIR) return process.env.XM_DATA_DIR
  if (!app.isPackaged) return path.join(process.cwd(), 'data')
  return path.join(app.getPath('userData'), 'data')
}

export async function initDatabase(): Promise<void> {
  SQL = await initSqlJs({ locateFile: () => resolveWasm() })
  const dir = getDataDir()
  fs.mkdirSync(dir, { recursive: true })
  dbFile = path.join(dir, 'xiongmao.db')

  if (fs.existsSync(dbFile)) {
    try {
      raw = new SQL.Database(new Uint8Array(fs.readFileSync(dbFile)))
    } catch (err) {
      console.error('[db] 数据库损坏，已备份并重建', err)
      fs.copyFileSync(dbFile, `${dbFile}.broken-${Date.now()}`)
      raw = new SQL.Database()
    }
  } else if (fs.existsSync(`${dbFile}.tmp`)) {
    // 上次写盘在重命名阶段中断，使用临时文件恢复
    try {
      raw = new SQL.Database(new Uint8Array(fs.readFileSync(`${dbFile}.tmp`)))
      console.warn('[db] 从 .tmp 恢复数据库')
    } catch {
      raw = new SQL.Database()
    }
  } else {
    raw = new SQL.Database()
  }

  raw.run('PRAGMA foreign_keys = ON;')
  raw.exec(SCHEMA_SQL)
  migrate()
  persistNow()
  console.log('[db] ready at', dbFile)
}

function migrate(): void {
  const current = Number(getRaw<{ v: string }>('SELECT value AS v FROM meta WHERE key = ?', ['schema_version'])?.v || 0)
  if (current >= SCHEMA_VERSION) return

  // v2：区分长篇小说 / 短故事
  if (current < 2) {
    const cols = allRaw<{ name: string }>('PRAGMA table_info(books)')
    if (!cols.some((c) => c.name === 'work_type')) {
      execRaw("ALTER TABLE books ADD COLUMN work_type TEXT NOT NULL DEFAULT 'novel'")
    }
  }

  // v3：多套供应商配置
  if (current < 3) {
    const existing = Number(getRaw<{ c: number }>('SELECT COUNT(*) AS c FROM providers')?.c || 0)
    if (!existing) {
      const row = getRaw<{ value: string }>("SELECT value FROM settings WHERE key = 'app_settings'")
      if (row?.value) {
        try {
          const stored = JSON.parse(row.value) as {
            model?: {
              baseUrl?: string
              apiKey?: string
              models?: Record<string, string>
              temperature?: number
              maxTokens?: number
              extraHeaders?: string
            }
          }
          const m = stored.model
          if (m?.baseUrl) {
            const id = 'pr_migrated'
            const t = Date.now()
            runRaw(
              `INSERT INTO providers(id,name,base_url,api_key,models,temperature,max_tokens,extra_headers,preset,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
              [
                id,
                '默认配置',
                m.baseUrl,
                m.apiKey || '',
                JSON.stringify(m.models || {}),
                m.temperature ?? 0.85,
                m.maxTokens ?? 8192,
                m.extraHeaders || '',
                'custom',
                t,
                t
              ]
            )
            runRaw(
              "INSERT INTO settings(key,value) VALUES('active_provider_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
              [JSON.stringify(id)]
            )
          }
        } catch (err) {
          console.warn('[db] 旧模型配置迁移失败', err)
        }
      }
    }
  }

  // v4：番茄阅读标签（主分类 / 主题 / 角色 / 情节）
  if (current < 4) {
    const cols = allRaw<{ name: string }>('PRAGMA table_info(books)')
    if (!cols.some((c) => c.name === 'fanqie_tags')) {
      execRaw("ALTER TABLE books ADD COLUMN fanqie_tags TEXT NOT NULL DEFAULT '{}'")
    }
  }

  // v5：去AI味标记 + 原稿备份表
  if (current < 5) {
    const cols = allRaw<{ name: string }>('PRAGMA table_info(chapters)')
    if (!cols.some((c) => c.name === 'deai_done_at')) {
      execRaw('ALTER TABLE chapters ADD COLUMN deai_done_at INTEGER NOT NULL DEFAULT 0')
    }
    execRaw(`CREATE TABLE IF NOT EXISTS deai_backups (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`)
    execRaw('CREATE INDEX IF NOT EXISTS idx_deai_backups_book ON deai_backups(book_id, chapter_id)')
  }

  // v6：章节检索关键词
  if (current < 6) {
    const cols = allRaw<{ name: string }>('PRAGMA table_info(chapters)')
    if (!cols.some((c) => c.name === 'search_terms')) {
      execRaw("ALTER TABLE chapters ADD COLUMN search_terms TEXT NOT NULL DEFAULT '[]'")
    }
  }

  runRaw('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    'schema_version',
    String(SCHEMA_VERSION)
  ])
}

function ensure(): Database {
  if (!raw) throw new Error('数据库尚未初始化')
  return raw
}

export function runRaw(sql: string, params: unknown[] = []): void {
  ensure().run(sql, params as never[])
  markDirty()
}

export function getRaw<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = ensure().prepare(sql)
  try {
    stmt.bind(params as never[])
    if (stmt.step()) return stmt.getAsObject() as unknown as T
    return undefined
  } finally {
    stmt.free()
  }
}

export function allRaw<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = ensure().prepare(sql)
  const out: T[] = []
  try {
    stmt.bind(params as never[])
    while (stmt.step()) out.push(stmt.getAsObject() as unknown as T)
    return out
  } finally {
    stmt.free()
  }
}

export function execRaw(sql: string): void {
  ensure().exec(sql)
  markDirty()
}

export function markDirty(): void {
  dirty = true
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistNow()
  }, 700)
}

export function persistNow(): void {
  if (!raw || !dbFile) return
  try {
    const data = Buffer.from(raw.export())
    const tmp = `${dbFile}.tmp`
    fs.writeFileSync(tmp, data)
    try {
      fs.renameSync(tmp, dbFile)
    } catch (renameErr) {
      // Windows 上重命名可能因杀软/同步盘占用返回 EXDEV/EPERM，退化为覆盖复制
      try {
        fs.copyFileSync(tmp, dbFile)
        fs.unlinkSync(tmp)
      } catch (copyErr) {
        console.error('[db] 持久化失败（重命名与复制均失败）', renameErr, copyErr)
        return
      }
    }
    dirty = false
  } catch (err) {
    console.error('[db] 持久化失败', err)
  }
}

/**
 * 每日自动备份：一天最多一份，保留最近 14 份。
 * 长篇写到几百章后，一次误操作就可能丢稿，这个兜底比任何 UI 都重要。
 */
let lastBackupDay = ''

export function backupDaily(): string | null {
  if (!dbFile || !fs.existsSync(dbFile)) return null
  const day = new Date().toISOString().slice(0, 10)
  if (lastBackupDay === day) return null
  try {
    const dir = path.join(path.dirname(dbFile), 'backups')
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, `xiongmao-${day}.db`)
    if (!fs.existsSync(target)) fs.copyFileSync(dbFile, target)
    lastBackupDay = day
    // 只留 14 份
    const files = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith('xiongmao-') && n.endsWith('.db'))
      .sort()
    while (files.length > 14) {
      const old = files.shift()!
      try {
        fs.unlinkSync(path.join(dir, old))
      } catch {
        /* 忽略 */
      }
    }
    console.log('[db] 已备份', target)
    return target
  } catch (err) {
    console.warn('[db] 备份失败', err)
    return null
  }
}

export function isDirty(): boolean {
  return dirty
}

export function getDbFilePath(): string {
  return dbFile
}

export function closeDatabase(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  persistNow()
  raw?.close()
  raw = null
}

/** 生成短 id */
export function newId(prefix = ''): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `${prefix}${t}${r}`
}
