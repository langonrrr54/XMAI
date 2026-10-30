import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  stack: string
}

/**
 * 全局错误边界。
 * 任何页面组件抛异常时，显示可读的错误信息而不是整屏白屏，
 * 同时提供「返回书库」「复制错误」「重试」三个出口。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] 组件崩溃', error, info.componentStack)
    this.setState({ stack: `${error.stack || ''}\n\n组件栈：\n${info.componentStack || ''}` })
  }

  private copy = (): void => {
    const text = `${this.state.error?.message || ''}\n${this.state.stack}`
    void navigator.clipboard.writeText(text)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full w-full items-center justify-center bg-app p-6">
        <div className="w-[min(720px,100%)] rounded-2xl border border-red-500/25 bg-panel/90 p-6 shadow-2xl">
          <div className="font-serif-cn text-[17px] font-semibold text-red-300">界面出现异常</div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg/60">
            这一步操作触发了渲染错误，数据本身没有丢失。可以返回书库继续，或复制错误信息反馈。
          </p>
          <pre className="mt-3 max-h-[38vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line/8 bg-fg/[0.03] p-3 font-mono text-[11px] leading-relaxed text-fg/50">
            {error.message}
            {this.state.stack ? `\n\n${this.state.stack}` : ''}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="btn-primary"
              onClick={() => {
                this.setState({ error: null, stack: '' })
              }}
            >
              重试
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                this.setState({ error: null, stack: '' })
                window.location.hash = ''
                window.location.reload()
              }}
            >
              重新加载
            </button>
            <button className="btn-ghost" onClick={this.copy}>
              复制错误信息
            </button>
          </div>
        </div>
      </div>
    )
  }
}