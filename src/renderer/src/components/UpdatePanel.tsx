import { useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw, Rocket } from 'lucide-react'
import { useApp } from '../store/useApp'

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
  version?: string
  releaseNotes?: string
  releaseDate?: string
  progress: number
  downloading: boolean
  downloaded: boolean
  error?: string
  currentVersion: string
}

/**
 * 软件更新面板。
 * 三段式：检查 → 下载 → 重启安装，每一步都由用户主动触发。
 */
export default function UpdatePanel(): React.ReactNode {
  const toast = useApp((s) => s.toast)
  const [state, setState] = useState<UpdateState | null>(null)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    void window.api.update.state().then((s) => setState(s as UpdateState))
    const off = window.api.update.onState((s) => setState(s as UpdateState))
    return () => {
      off()
    }
  }, [])

  const check = async (): Promise<void> => {
    setBusy('check')
    try {
      const s = (await window.api.update.check()) as UpdateState
      setState(s)
      if (s.status === 'not-available') toast('success', '已是最新版本')
      if (s.status === 'available') toast('info', `发现新版本 ${s.version}`)
      if (s.status === 'error') toast('error', `检查失败：${s.error || '未知错误'}`)
    } finally {
      setBusy('')
    }
  }

  const download = async (): Promise<void> => {
    setBusy('download')
    try {
      await window.api.update.download()
    } catch (err) {
      toast('error', `下载失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const install = async (): Promise<void> => {
    if (!window.confirm('立即重启并安装更新？未保存的编辑会丢失。')) return
    await window.api.update.install()
  }

  const s = state
  const label =
    !s
      ? '加载中…'
      : s.status === 'checking'
        ? '正在检查更新…'
        : s.status === 'available'
          ? `发现新版本 ${s.version}`
          : s.status === 'not-available'
            ? '已是最新版本'
            : s.status === 'error'
              ? `检查失败：${s.error || '未知错误'}`
              : '尚未检查'

  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="section-title flex items-center gap-1.5">
          <Rocket size={14} /> 软件更新
        </div>
        <div className="text-[10.5px] text-fg/25">
          当前版本 {s?.currentVersion || '—'}
        </div>
        <div className="flex-1" />
        <button className="btn-ghost btn-sm" disabled={!!busy || s?.status === 'checking'} onClick={() => void check()}>
          {busy === 'check' || s?.status === 'checking' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}{' '}
          检查更新
        </button>
      </div>

      <div className="rounded-lg border border-line/8 bg-fg/[0.02] p-3">
        <div className="text-[12.5px] text-fg/75">{label}</div>

        {s?.releaseNotes && (
          <div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-fg/45">
            {s.releaseNotes}
          </div>
        )}

        {s?.downloading && (
          <div className="mt-3">
            <div className="h-1 overflow-hidden rounded-full bg-fg/10">
              <div className="h-full rounded-full accent-gradient transition-all" style={{ width: `${s.progress}%` }} />
            </div>
            <div className="mt-1 text-[10.5px] text-fg/30">正在下载 {s.progress}%</div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {s?.status === 'available' && !s.downloaded && (
            <button className="btn-primary btn-sm" disabled={!!busy || s.downloading} onClick={() => void download()}>
              {s.downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} 下载更新
            </button>
          )}
          {s?.downloaded && (
            <button className="btn-primary btn-sm" onClick={() => void install()}>
              重启并安装
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-fg/25">
        更新从 GitHub Releases 获取。仅打包版支持；开发态会提示「不检查更新」。
      </p>
    </section>
  )
}