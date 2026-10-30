import { useEffect, useState } from 'react'
import { BookOpen } from 'lucide-react'
import type { Book } from '@shared/types'

/**
 * 作品封面缩略图。
 * 有封面就显示封面，没有就显示书名占位。
 * 书库与发布中心共用，保证两处视觉一致。
 */
export default function CoverThumb({ book }: { book: Book }): React.ReactNode {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!book.coverPath) {
      setSrc(null)
      return
    }
    void window.api.cover.read(book.id).then((d) => {
      if (alive) setSrc(d)
    })
    return () => {
      alive = false
    }
  }, [book.id, book.coverPath])

  if (src) {
    return <img src={src} alt={book.title} className="h-full w-full object-cover" draggable={false} />
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#1a1f2b] to-[#0d1017] text-white/25">
      <BookOpen size={28} />
      <span className="mt-2 px-3 text-center font-serif-cn text-[13px] leading-snug text-white/40">
        {book.title}
      </span>
    </div>
  )
}