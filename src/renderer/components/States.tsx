import type { ReactElement } from 'react'
import { WarnIcon } from './Icons'

/* 加载 / 空 / 失败三种状态。文案要说明"发生了什么、怎么办"，不卖萌 */

export function LoadingState({ message = '正在接收信号…' }: { message?: string }): ReactElement {
  return (
    <div className="state" data-testid="loading">
      <div className="state__pulse" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="state__title">{message}</div>
    </div>
  )
}

export function EmptyState({ title, desc }: { title: string; desc: string }): ReactElement {
  return (
    <div className="state" data-testid="empty-state">
      <div className="state__title">{title}</div>
      <div className="state__desc">{desc}</div>
    </div>
  )
}

/** 某个视图取数失败时的横幅：说清楚原因，并提供重试 */
export function ErrorBanner({
  message,
  onRetry
}: {
  message: string
  onRetry: () => void
}): ReactElement {
  return (
    <div className="banner" role="alert">
      <WarnIcon className="banner__icon" />
      <span className="banner__text">{message}</span>
      <button type="button" className="btn" onClick={onRetry}>
        重试
      </button>
    </div>
  )
}
