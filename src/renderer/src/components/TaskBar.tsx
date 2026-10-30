import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { AppTask } from '@shared/types'
import { useApp } from '../store/useApp'

const KIND_LABEL: Record<string, string> = {
  deai: '去AI味',
  review: '审校',
  reviewFix: '审校修稿',
  summary: '写入记忆',
  rewrite: '重写',
  chapters: '写章节',
  concept: '选题方案',
  bookInit: '开书初始化',
  bible: '设定库',
  volumes: '分卷大纲',
  structure: '短故事结构',
  outlines: '章节细纲',
  index: '记忆索引',
  style: '文风卡',
  cover: '封面',
  test: '连接测试',
  models: '模型列表',
  tags: '自动选标签',
  publish: '发布',
  publishTags: '勾选标签',
  replay: '接口回放'
}

function elapsed(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  return `${m} 分 ${s % 60} 秒`
}

export default function TaskBar(): React.ReactNode {
  const tasks = useApp((s) => s.tasks)
  const [, forceTick] = useState(0)

  const running = useMemo(() => tasks.filter((t) => t.status === 'running'), [tasks])

  // 运行中每秒刷新一次耗时
  useEffect(() => {
    if (!running.length) return
    const timer = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [running.length])

  if (!running.length) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center p-4">
      <div className="pointer-events-auto w-[min(760px,92%)] space-y-2 rounded-2xl border border-accent/20 bg-panel2/95 px-4 py-3 shadow-2xl backdrop-blur">
        {running.slice(0, 4).map((t: AppTask) => (
          <div key={t.id}>
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-accent" />
              <span className="shrink-0 rounded bg-accent/12 px-1.5 py-0.5 text-[10px] text-accent/90">
                {KIND_LABEL[t.kind] || t.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg/85">{t.title}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-mist-400">
                {t.detail || `${t.progress}%`} · {elapsed(t.startedAt)}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-fg/10">
              <div
                className="h-full rounded-full accent-gradient transition-all"
                style={{ width: `${Math.max(3, t.progress)}%` }}
              />
            </div>
            <div className="mt-1 line-clamp-1 text-[11px] leading-relaxed text-fg/30">{t.message}</div>
          </div>
        ))}
        {running.length > 4 && (
          <div className="text-[10.5px] text-fg/25">还有 {running.length - 4} 个任务在跑…</div>
        )}
      </div>
    </div>
  )
}

/** 任务状态图标（供页面内按钮复用） */
export function TaskIcon({ status }: { status?: AppTask['status'] }): React.ReactNode {
  if (status === 'done') return <CheckCircle2 size={13} className="text-emerald-400" />
  if (status === 'error') return <XCircle size={13} className="text-red-400" />
  return <Loader2 size={13} className="animate-spin" />
}