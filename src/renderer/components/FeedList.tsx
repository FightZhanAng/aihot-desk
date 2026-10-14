import type { ReactElement, MouseEvent, KeyboardEvent } from 'react'
import { categoryLabel, formatRelative } from '@shared/format'
import { savedFromItem, type SavedInput } from '@shared/saved'
import { itemSignal } from '@shared/signal'
import type { Item } from '@shared/types'
import { ExternalIcon } from './Icons'
import { SaveButton } from './SaveButton'
import { SignalBar } from './SignalBar'

/*
 * 精选流。这里的信号带量的是**编辑评分**（score 0~100），
 * 和热榜的信源数不是同一个量 —— 两处都用 8 格刻度，是因为它们回答的是
 * 同一个问题："这条有多强"，只是"强"的判据随视图不同。
 */

interface FeedListProps {
  items: Item[]
  openId: string | null
  fresh: boolean
  savedKeys: Set<string>
  onToggle: (id: string) => void
  onOpenUrl: (url: string) => void
  onToggleSave: (input: SavedInput) => void
}

export function FeedList({
  items,
  openId,
  fresh,
  savedKeys,
  onToggle,
  onOpenUrl,
  onToggleSave
}: FeedListProps): ReactElement {
  return (
    <div className={`list${fresh ? ' is-fresh' : ''}`}>
      {items.map((item) => (
        <FeedRow
          key={item.id}
          item={item}
          open={openId === item.id}
          savedKeys={savedKeys}
          onToggle={onToggle}
          onOpenUrl={onOpenUrl}
          onToggleSave={onToggleSave}
        />
      ))}
    </div>
  )
}

function FeedRow({
  item,
  open,
  savedKeys,
  onToggle,
  onOpenUrl,
  onToggleSave
}: {
  item: Item
  open: boolean
  savedKeys: Set<string>
  onToggle: (id: string) => void
  onOpenUrl: (url: string) => void
  onToggleSave: (input: SavedInput) => void
}): ReactElement {
  const level = itemSignal(item.score)
  const activate = (): void => onToggle(item.id)
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    // 行里还有收藏、原文这些真按钮：焦点在它们身上时，回车/空格该由它们响应。
    // 不挡这一下的话，下面的 preventDefault 会顶掉按钮自己的激活，结果按收藏却把整行展开了。
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }
  const inDetail = (handler: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    handler()
  }

  return (
    <div
      className={`row row--feed${open ? ' is-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      data-testid="feed-row"
      onClick={activate}
      onKeyDown={onKey}
    >
      <div className="row__head">
        <span className="row__tag" data-cat={item.category ?? ''} title={categoryLabel(item.category)} />
        <span className="row__main">
          <span className="row__title">{item.title}</span>
          <span className="row__meta">
            <span className="row__source">{item.source.name}</span>
            <span className="row__dot">·</span>
            <span>{categoryLabel(item.category)}</span>
            <span className="row__dot">·</span>
            <span>{formatRelative(item.publishedAt ?? item.discoveredAt)}</span>
          </span>
        </span>
        <span className="row__tail">
          <SaveButton input={savedFromItem(item)} keys={savedKeys} onToggle={onToggleSave} />
          <SignalBar
            level={level}
            label={item.score == null ? '编辑评分 未知' : `编辑评分 ${item.score} / 100`}
          />
        </span>
      </div>

      <div className="row__detail">
        <div className="row__detail-inner">
          <div className="row__detail-pad">
            {item.summary && <p className="detail__summary">{item.summary}</p>}
            {item.reason && (
              <p className="detail__reason">
                <b>荐语</b> {item.reason}
              </p>
            )}

            <div className="detail__actions">
              {item.links.original && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={inDetail(() => onOpenUrl(item.links.original as string))}
                >
                  <ExternalIcon />
                  打开原文
                </button>
              )}
              {item.links.aihot && (
                <button
                  type="button"
                  className="btn"
                  onClick={inDetail(() => onOpenUrl(item.links.aihot as string))}
                >
                  在 AIHOT 阅读
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
