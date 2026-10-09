import type { ReactElement } from 'react'
import type { SavedInput } from '@shared/saved'
import type { Snapshot } from '@shared/types'
import { EmptyState, ErrorBanner } from './States'
import { TopicList } from './TopicList'

interface HotViewProps {
  snapshot: Snapshot
  openId: string | null
  fresh: boolean
  savedKeys: Set<string>
  onToggle: (id: string) => void
  onOpenUrl: (url: string) => void
  onOpenStory: (publicId: string) => void
  onToggleSave: (input: SavedInput) => void
  onRetry: () => void
}

export function HotView({
  snapshot,
  openId,
  fresh,
  savedKeys,
  onToggle,
  onOpenUrl,
  onOpenStory,
  onToggleSave,
  onRetry
}: HotViewProps): ReactElement {
  const { items, error } = snapshot.hot
  return (
    <>
      <div className="viewhead">
        <span className="viewhead__title" data-testid="title">
          热点
        </span>
        <span className="viewhead__note">
          {items.length > 0 ? `${items.length} 条信号 · 按热度排序` : '当前没有数据'}
        </span>
      </div>

      {error && <ErrorBanner message={error} onRetry={onRetry} />}

      {items.length === 0 && !error ? (
        <EmptyState
          title="暂时没有热点"
          desc="AIHOT 的观测窗口里还没有聚合出热点事件，稍后再看看。"
        />
      ) : (
        <TopicList
          items={items}
          openId={openId}
          fresh={fresh}
          savedKeys={savedKeys}
          onToggle={onToggle}
          onOpenUrl={onOpenUrl}
          onOpenStory={onOpenStory}
          onToggleSave={onToggleSave}
        />
      )}
    </>
  )
}
