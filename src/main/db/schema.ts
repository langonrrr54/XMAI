export const SCHEMA_VERSION = 6

export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  synopsis TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  genre TEXT NOT NULL DEFAULT '',
  cover_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planning',
  work_type TEXT NOT NULL DEFAULT 'novel',
  target_chapters INTEGER NOT NULL DEFAULT 500,
  words_per_chapter INTEGER NOT NULL DEFAULT 2200,
  style_profile TEXT,
  concept TEXT,
  fanqie_tags TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  volume_no INTEGER NOT NULL DEFAULT 1,
  chapter_no INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  outline TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  word_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  key_events TEXT NOT NULL DEFAULT '[]',
  /** 检索关键词（JSON 数组），没有 embedding 时提升召回 */
  search_terms TEXT NOT NULL DEFAULT '[]',
  /** 该章最后一次去AI味完成的时间戳；0 表示没做过 */
  deai_done_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(book_id, chapter_no)
);
CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id, chapter_no);

/** 去AI味前的原稿快照，用于回滚 */
CREATE TABLE IF NOT EXISTS deai_backups (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deai_backups_book ON deai_backups(book_id, chapter_id);

CREATE TABLE IF NOT EXISTS bible_entries (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '{}',
  importance INTEGER NOT NULL DEFAULT 3,
  locked INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  last_chapter_no INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bible_book_kind ON bible_entries(book_id, kind);

CREATE TABLE IF NOT EXISTS outline_nodes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  level TEXT NOT NULL,
  seq INTEGER NOT NULL,
  parent_seq INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  beats TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_outline_book ON outline_nodes(book_id, level, seq);

CREATE TABLE IF NOT EXISTS foreshadowing (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  planted_chapter_no INTEGER NOT NULL DEFAULT 0,
  resolve_by_chapter_no INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_book ON foreshadowing(book_id, status);

CREATE TABLE IF NOT EXISTS volume_summaries (
  book_id TEXT NOT NULL,
  volume_no INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(book_id, volume_no)
);

CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  vec BLOB NOT NULL,
  dim INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emb_book ON embeddings(book_id, ref_type);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'fanqie',
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publish_book ON publish_jobs(book_id, created_at);

CREATE TABLE IF NOT EXISTS captured_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  headers TEXT NOT NULL DEFAULT '{}',
  body TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'unknown',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  models TEXT NOT NULL DEFAULT '{}',
  temperature REAL NOT NULL DEFAULT 0.85,
  max_tokens INTEGER NOT NULL DEFAULT 8192,
  extra_headers TEXT NOT NULL DEFAULT '',
  preset TEXT NOT NULL DEFAULT 'custom',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_providers_name ON providers(name);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
