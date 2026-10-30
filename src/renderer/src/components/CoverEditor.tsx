import { useEffect, useState } from 'react'
import { Image as ImageIcon, Loader2, RefreshCw, Sparkles, Upload, Wand2 } from 'lucide-react'
import type { Book } from '@shared/types'
import { Modal } from './ui'
import { useApp } from '../store/useApp'

export default function CoverEditor({
  book,
  open,
  onClose,
  onChanged
}: {
  book: Book
  open: boolean
  onClose: () => void
  onChanged: () => Promise<void> | void
}): React.ReactNode {
  const toast = useApp((s) => s.toast)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState<'' | 'local' | 'ai' | 'upload' | 'reset'>('')
  const [variant, setVariant] = useState(0)
  const [mode, setMode] = useState<'template' | 'ai' | 'custom'>('template')

  useEffect(() => {
    if (!open) return
    setBusy('')
    setVariant(0)
    setMode('template')
    setPreview(null)
    void window.api.cover.read(book.id).then((d) => setPreview(d))
  }, [open, book.id, book.coverPath])

  const generate = async (kind: 'local' | 'ai' | 'reset'): Promise<void> => {
    setBusy(kind)
    const v = kind === 'reset' ? 0 : kind === 'local' ? variant + 1 : variant
    try {
      const r = await window.api.cover.generate(book.id, kind === 'ai', v)
      setPreview(r.dataUrl)
      setVariant(v)
      setMode(r.mode === 'ai' ? 'ai' : 'template')
      if (kind === 'ai' && r.mode !== 'ai') {
        toast('info', '未配置绘图模型，已使用本地模板生成；配置绘图模型后可再试')
      } else {
        toast('success', kind === 'reset' ? '已恢复默认样式' : r.mode === 'ai' ? 'AI 封面已生成' : '封面已生成')
      }
      await onChanged()
    } catch (err) {
      toast('error', `生成失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const upload = async (): Promise<void> => {
    setBusy('upload')
    try {
      const r = await window.api.cover.pick(book.id)
      if (!r) return
      setPreview(r.dataUrl)
      setMode('custom')
      toast('success', '已使用你选择的图片作为封面')
      await onChanged()
    } catch (err) {
      toast('error', `上传失败：${(err as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal
      open={open}
      title="封面管理"
      subtitle="生成、换样式，或上传自己的图片"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <button className="btn-ghost" onClick={onClose}>
          完成
        </button>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[240px_1fr]">
        <div>
          <div className="aspect-[3/4] w-full overflow-hidden rounded-xl border border-line/10 bg-field">
            {preview ? (
              <img src={preview} alt={book.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-fg/20">
                <ImageIcon size={28} />
                <span className="text-[11px]">暂无封面</span>
              </div>
            )}
          </div>
          <div className="mt-2 text-center text-[10.5px] text-fg/30">
            {mode === 'ai' ? 'AI 生成' : mode === 'custom' ? '本地上传' : '本地模板'} · 3:4
          </div>
        </div>

        <div className="space-y-2">
          <button className="btn-primary w-full" disabled={!!busy} onClick={() => void generate('local')}>
            {busy === 'local' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            生成本地封面 · 换一个样式
          </button>
          <button className="btn-ghost w-full" disabled={!!busy} onClick={() => void generate('ai')}>
            {busy === 'ai' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            AI 生成封面
          </button>
          <button className="btn-ghost w-full" disabled={!!busy} onClick={() => void upload()}>
            {busy === 'upload' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            上传自己的图片
          </button>
          <button className="btn-ghost w-full" disabled={!!busy} onClick={() => void generate('reset')}>
            {busy === 'reset' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            恢复默认样式
          </button>

          <div className="space-y-1.5 pt-2 text-[11px] leading-relaxed text-fg/30">
            <p>本地模板每次会换一套配色，免费且必定成功。</p>
            <p>AI 封面需要供应商里配置「绘图模型」，且服务支持 /images/generations；未配置时自动回退本地模板。</p>
            <p>上传支持 PNG / JPG / WEBP，不超过 12MB；封面会立即同步到书库与作品页。</p>
          </div>
        </div>
      </div>
    </Modal>
  )
}
