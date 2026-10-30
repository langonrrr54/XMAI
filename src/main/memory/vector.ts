/**
 * 轻量检索工具：中文分词（单字+二元组）、本地哈希向量、余弦相似度、BM25。
 * 设计目标：在没有 Embedding 模型时也能提供可用的语义近似检索（零依赖、纯 JS）。
 */

const LOCAL_DIM = 512

export function tokenize(text: string): string[] {
  if (!text) return []
  const normalized = text
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .replace(/[^一-鿿\w]+/g, ' ')
  const tokens: string[] = []
  const chunks = normalized.split(' ').filter(Boolean)
  for (const chunk of chunks) {
    const cjk = chunk.match(/[一-鿿]+/g)
    if (cjk) {
      for (const seg of cjk) {
        // 单字：保留人名/术语的单字召回
        for (let i = 0; i < seg.length; i++) tokens.push(seg[i])
        // 二元组：中文主要语义单元
        for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2))
        // 三元组：专有名词
        for (let i = 0; i < seg.length - 2; i++) tokens.push(seg.slice(i, i + 3))
      }
    }
    const latin = chunk.match(/[a-z0-9]+/g)
    if (latin) tokens.push(...latin)
  }
  return tokens
}

function hash32(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** 本地哈希向量（带符号随机投影 + 子词哈希），L2 归一化 */
export function localEmbed(text: string): Float32Array {
  const vec = new Float32Array(LOCAL_DIM)
  const tokens = tokenize(text)
  if (!tokens.length) return vec
  const freq = new Map<string, number>()
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1)
  for (const [tok, count] of freq) {
    const h = hash32(tok)
    const idx = h % LOCAL_DIM
    const sign = (h >>> 31) & 1 ? -1 : 1
    // 次线性词频，抑制高频词
    vec[idx] += sign * (1 + Math.log(count))
  }
  // L2 归一化
  let norm = 0
  for (let i = 0; i < LOCAL_DIM; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < LOCAL_DIM; i++) vec[i] /= norm
  return vec
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export interface Bm25Doc {
  id: string
  text: string
}

export interface Bm25Hit {
  id: string
  score: number
}

/** 内存 BM25（语料规模 < 10 万条时足够快） */
export function bm25Search(docs: Bm25Doc[], query: string, topK = 10): Bm25Hit[] {
  if (!docs.length || !query.trim()) return []
  const k1 = 1.5
  const b = 0.75
  const docTokens = docs.map((d) => tokenize(d.text))
  const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / docs.length || 1
  const df = new Map<string, number>()
  for (const toks of docTokens) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1)
  }
  const qTokens = Array.from(new Set(tokenize(query)))
  const N = docs.length
  const scored: Bm25Hit[] = []
  for (let i = 0; i < docs.length; i++) {
    const toks = docTokens[i]
    const tf = new Map<string, number>()
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1)
    let score = 0
    for (const q of qTokens) {
      const f = tf.get(q)
      if (!f) continue
      const n = df.get(q) || 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / avgLen)))
    }
    if (score > 0) scored.push({ id: docs[i].id, score })
  }
  scored.sort((a, b2) => b2.score - a.score)
  return scored.slice(0, topK)
}

export function chunkText(text: string, size = 420, overlap = 80): string[] {
  const clean = text.replace(/\r/g, '').trim()
  if (clean.length <= size) return clean ? [clean] : []
  const out: string[] = []
  for (let i = 0; i < clean.length; i += size - overlap) {
    out.push(clean.slice(i, i + size))
    if (i + size >= clean.length) break
  }
  return out
}

export function vecToArray(v: Float32Array): number[] {
  return Array.from(v)
}
