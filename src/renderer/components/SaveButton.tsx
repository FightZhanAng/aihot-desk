import type { MouseEvent, ReactElement } from 'react'
import { savedKey, type SavedInput } from '@shared/saved'
import { BookmarkIcon } from './Icons'

/*
 * 收藏按钮。
 *
 * 两个刻意的细节：
 *   - 它出现在"整行可点"的列表里，所以点击必须 stopPropagation，
 *     否则收藏一下会把这一行的详情也展开。
 *   - 已收藏和未收藏是**同一个图标的两个状态**（实心 / 空心），
 *     不换成另一个形状 —— 换形状会让人以为是两个不同的功能。
 */

interface SaveButtonProps {
  input: SavedInput
  /** 已收藏的 key 集合，由上层统一算一次，不要在每一行里各自遍历 */
  keys: Set<string>
  onToggle: (input: SavedInput) => void
  /** 显示文字标签（详情页用），列表里只留图标 */
  withLabel?: boolean
}

export function SaveButton({ input, keys, onToggle, withLabel }: SaveButtonProps): ReactElement {
  const active = keys.has(savedKey(input.kind, input.id))
  const text = active ? '已收藏' : '收藏'

  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    onToggle(input)
  }

  return (
    <button
      type="button"
      className={`savebtn${active ? ' is-on' : ''}${withLabel ? ' savebtn--label' : ''}`}
      aria-pressed={active}
      title={active ? '取消收藏' : '收藏'}
      onClick={onClick}
      data-testid="save-btn"
    >
      <BookmarkIcon filled={active} />
      {withLabel && <span>{text}</span>}
    </button>
  )
}
