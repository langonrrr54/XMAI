import { useState } from 'react'
import { ArrowRight, UploadCloud } from 'lucide-react'
import { useApp } from '../store/useApp'
import PublishPanel from '../components/PublishPanel'
import { EmptyState } from '../components/ui'
import CoverThumb from '../components/CoverThumb'

export default function PublishPage(): React.ReactNode {
  const books = useApp((s) => s.books)
  const bookId = useApp((s) => s.bookId)
  const navigate = useApp((s) => s.navigate)
  const book = books.find((b) => b.id === bookId)

  if (!book) {
    return (
      <div className="mx-auto max-w-[1180px] px-8 py-7">
        <h1 className="font-serif-cn text-[24px] font-semibold tracking-wide text-fg">发布中心</h1>
        <p className="mt-1.5 text-[12.5px] text-mist-400">选择要发布的作品</p>
        {books.length === 0 ? (
          <div className="panel mt-6">
            <EmptyState
              icon={<UploadCloud size={40} />}
              title="还没有作品"
              desc="先去书库创建一本，写几章后再来发布。"
              action={
                <button className="btn-primary" onClick={() => navigate('library')}>
                  去书库 <ArrowRight size={14} />
                </button>
              }
            />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
            {books.map((b) => (
              <button
                key={b.id}
                className="group overflow-hidden rounded-2xl border border-line/8 bg-panel text-left transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-xl hover:shadow-black/40"
                onClick={() => navigate('publish', { bookId: b.id })}
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-black/40">
                  <CoverThumb book={b} />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/85 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-2">
                    <div className="cover-text-safe line-clamp-2 font-serif-cn text-[12.5px] font-semibold leading-snug text-white drop-shadow">
                      {b.title}
                    </div>
                    <div className="mt-0.5 text-[9.5px] text-white/50">
                      {b.genre || '未分类'} · {b.workType === 'short' ? `${b.wordsPerChapter} 字短篇` : `${b.targetChapters} 章规划`}
                    </div>
                  </div>
                  <div className="absolute left-1.5 top-1.5">
                    <span
                      className={`rounded px-1 py-0.5 text-[9px] backdrop-blur ${
                        b.workType === 'short' ? 'bg-accent/25 text-accent' : 'bg-black/40 text-white/75'
                      }`}
                    >
                      {b.workType === 'short' ? '短故事' : '长篇小说'}
                    </span>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
                    <span className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-fg shadow-lg">
                      <UploadCloud size={13} /> 去发布
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line/6 px-6 py-4">
        <div className="flex items-center gap-2">
          <h1 className="font-serif-cn text-[19px] font-semibold tracking-wide text-fg">发布中心</h1>
          <span className="text-[11px] text-fg/25">《{book.title}》</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${book.workType === 'short' ? 'bg-accent/12 text-accent/90' : 'bg-fg/6 text-fg/45'}`}>
            {book.workType === 'short' ? '短故事' : '长篇小说'}
          </span>
          {books.length > 1 && (
            <select
              className="ml-auto rounded-lg border border-line/10 bg-field px-2 py-1 text-[11px] text-fg/70 outline-none"
              value={book.id}
              onChange={(e) => navigate('publish', { bookId: e.target.value })}
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="mt-1 text-[11.5px] text-fg/35">
          内置番茄作家后台 · 登录态本地保存 · 支持接口直发 / 页面自动化 / 复制人工三种模式
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PublishPanel book={book} onChanged={() => undefined} />
      </div>
    </div>
  )
}
