import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react'
import { useApp } from '../store/useApp'

export function Spinner({ className = '' }: { className?: string }): ReactNode {
  return <Loader2 className={`animate-spin ${className}`} size={16} />
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 'max-w-2xl'
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}): ReactNode {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative flex max-h-[calc(100vh-2rem)] w-full ${width} fade-up flex-col overflow-hidden rounded-2xl border border-line/10 bg-panel shadow-2xl`}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-line/6 px-5 py-4">
          <div>
            <h3 className="font-serif-cn text-[17px] font-semibold text-fg">{title}</h3>
            {subtitle && <p className="mt-1 text-xs text-mist-400">{subtitle}</p>}
          </div>
          <button className="rounded-lg p-1.5 text-mist-400 hover:bg-fg/10 hover:text-fg" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line/6 px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function Toasts(): ReactNode {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto fade-up flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] shadow-xl backdrop-blur ${
            t.type === 'error'
              ? 'border-red-500/30 bg-red-950/80 text-red-200'
              : t.type === 'success'
                ? 'border-emerald-500/25 bg-emerald-950/80 text-emerald-200'
                : 'border-line/10 bg-panel2/95 text-fg/85'
          }`}
        >
          {t.type === 'error' ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : t.type === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <Info size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button className="opacity-50 hover:opacity-100" onClick={() => dismiss(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  desc,
  action
}: {
  icon?: ReactNode
  title: string
  desc?: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-4 text-fg/20">{icon}</div>}
      <div className="font-serif-cn text-[15px] text-fg/75">{title}</div>
      {desc && <div className="mt-1.5 max-w-sm text-xs leading-relaxed text-mist-400">{desc}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-fg/25">{hint}</p>}
    </div>
  )
}

export function Stat({ value, label }: { value: ReactNode; label: string }): ReactNode {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

export function StatusDot({ status }: { status: string }): ReactNode {
  const map: Record<string, string> = {
    planned: 'bg-slate-500',
    drafted: 'bg-sky-400',
    reviewed: 'bg-emerald-400',
    published: 'bg-accent',
    open: 'bg-accent',
    resolved: 'bg-emerald-400',
    abandoned: 'bg-slate-600'
  }
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${map[status] || 'bg-slate-500'}`} />
}
