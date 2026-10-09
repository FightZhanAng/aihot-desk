import type { ReactElement } from 'react'
import { RefreshIcon } from './Icons'

/*
 * 标题栏：左边是日期牌（像仪表上的读数），右边是刷新。
 * 整条由 CSS 声明为窗口拖动区，按钮自己声明 no-drag。
 */

interface TitleBarProps {
  dateText: string
  busy: boolean
  updatedText: string | null
  onRefresh: () => void
}

export function TitleBar({ dateText, busy, updatedText, onRefresh }: TitleBarProps): ReactElement {
  return (
    <header className={`titlebar${busy ? ' is-busy' : ''}`}>
      <span className="titlebar__date">{dateText}</span>
      <span className="titlebar__spacer" />
      <span className="titlebar__updated">{updatedText ? `更新于 ${updatedText}` : '尚未取到数据'}</span>
      <button
        type="button"
        className={`refresh${busy ? ' is-busy' : ''}`}
        onClick={onRefresh}
        disabled={busy}
        title="立即刷新"
      >
        <RefreshIcon className="refresh__icon" />
        <span>刷新</span>
      </button>
    </header>
  )
}
