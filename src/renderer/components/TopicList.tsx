import type { ReactElement, MouseEvent, KeyboardEvent } from 'react'
import { formatRelative } from '@shared/format'
import { storyIdFromUrl } from '@shared/links'
import { savedFromTopic, type SavedInput } from '@shared/saved'
import { topicSignal } from '@shared/signal'
import type { HotTopic } from '@shared/types'
import { ExternalIcon } from './Icons'
import { SaveButton } from './SaveButton'
import { SignalBar } from './SignalBar'

/*
 * 热榜。名次是真实的排名（AIHOT 观测到的当前最强信号），
 * 所以用大号等宽数字排出来 —— 这不是"给内容编号"的装饰。
 *
 * 展开详情挂在行下面（不跳页、不弹窗）：扫读的节奏不该被打断。
 * 唯一"跳页"的是事件来龙去脉 —— 那是另一层内容（时间线 + 综述），
 * 但它也在应用里打开，不走浏览器。
 */

interface TopicListProps {
  items: HotTopic[]
  openId: string | null
  fresh: boolean
  savedKeys: Set<string>
  onToggle: (id: string) => void
  onOpenUrl: (url: string) => void
  onOpenStory: (publicId: string) => void
  onToggleSave: (input: SavedInput) => void
}

export function TopicList({
  items,
  openId,
  fresh,
  savedKeys,
  onToggle,
  onOpenUrl,
  onOpenStory,
  onToggleSave
}: TopicListProps): ReactElement {
  return (
    <div className={`list${fresh ? ' is-fresh' : ''}`}>
      {items.map((topic) => (
        <TopicRow
          key={topic.id}
          topic={topic}
          open={openId === topic.id}
          savedKeys={savedKeys}
          onToggle={onToggle}
          onOpenUrl={onOpenUrl}
          onOpenStory={onOpenStory}
          onToggleSave={onToggleSave}
        />
      ))}
    </div>
  )
}

function TopicRow({
  topic,
  open,
  savedKeys,
  onToggle,
  onOpenUrl,
  onOpenStory,
  onToggleSave
}: {
  topic: HotTopic
  open: boolean
  savedKeys: Set<string>
  onToggle: (id: string) => void
  onOpenUrl: (url: string) => void
  onOpenStory: (publicId: string) => void
  onToggleSave: (input: SavedInput) => void
}): ReactElement {
  const level = topicSignal(topic)
  const rank = String(topic.rank).padStart(2, '0')
  const storyId = storyIdFromUrl(topic.links.story)

  const activate = (): void => onToggle(topic.id)
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    // 行里还有收藏、原文、阅读这些真按钮：焦点在它们身上时，回车/空格该由它们响应。
    // 不挡这一下的话，下面的 preventDefault 会顶掉按钮自己的激活，结果按收藏却把整行展开了。
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }
  // 详情里的按钮不该把整行折叠回去
  const inDetail = (handler: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    handler()
  }

  return (
    <div
      className={`row row--topic${topic.rank <= 3 ? ' is-top' : ''}${open ? ' is-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      data-testid="topic-row"
      onClick={activate}
      onKeyDown={onKey}
    >
      <div className="row__head">
        <span className="row__rank">{rank}</span>
        <span className="row__main">
          <span className="row__title">{topic.title}</span>
          <span className="row__meta">
            <span className="row__source">{topic.source.name}</span>
            <span className="row__dot">·</span>
            <span>{topic.sourceCount} 家信源</span>
            <span className="row__dot">·</span>
            <span>{formatRelative(topic.latestAt)}</span>
          </span>
        </span>
        <span className="row__tail">
          <SaveButton
            input={savedFromTopic(topic)}
            keys={savedKeys}
            onToggle={onToggleSave}
          />
          <SignalBar level={level} label={`信号强度 ${level}/8：${topic.sourceCount} 家信源在报道`} />
        </span>
      </div>

      <div className="row__detail">
        <div className="row__detail-inner">
          <div className="row__detail-pad">
            <dl className="detail__stats">
              <div className="detail__stat">
                <dt>信源</dt>
                <dd>{topic.sourceCount}</dd>
              </div>
              <div className="detail__stat">
                <dt>信号</dt>
                <dd>{topic.signalCount}</dd>
              </div>
              <div className="detail__stat">
                <dt>参与者</dt>
                <dd>{topic.participantCount}</dd>
              </div>
            </dl>

            {topic.sourceNames.length > 1 && (
              <div className="detail__sources">共 {topic.sourceNames.length} 家：{topic.sourceNames.join('、')}</div>
            )}

            <div className="detail__actions">
              {storyId && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={inDetail(() => onOpenStory(storyId))}
                >
                  事件来龙去脉
                </button>
              )}
              {topic.links.original && (
                <button
                  type="button"
                  className="btn"
                  onClick={inDetail(() => onOpenUrl(topic.links.original as string))}
                >
                  <ExternalIcon />
                  打开原文
                </button>
              )}
              {topic.links.aihot && (
                <button
                  type="button"
                  className="btn"
                  onClick={inDetail(() => onOpenUrl(topic.links.aihot as string))}
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
