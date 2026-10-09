import { useMemo, useState, type ReactElement } from 'react'
import { formatRelative } from '@shared/format'
import { SAVED_KINDS, savedKindLabel } from '@shared/saved'
import type { SavedEntry, SavedKind } from '@shared/types'
import { BookmarkIcon, TrashIcon } from './Icons'

/*
 * 收藏夹。
 *
 * 它和别的视图有个根本差别：**内容不再来自 AIHOT，而是存在本机的一份快照**。
 * 所以这里没有"刷新"这个概念 —— 能做的只有打开原文和取消收藏。
 * 空态也要说清楚东西存在哪，不然用户会以为是同步出了问题。
 */

interface SavedViewProps {
  entries: SavedEntry[]
  onRemove: (key: string) => void
  onClear: () => void
  onOpenUrl: (url: string) => void
  onOpenStory: (publicId: string) => void
}

export function SavedView({
  entries,
  onRemove,
  onClear,
  onOpenUrl,
  onOpenStory
}: SavedViewProps): ReactElement {
  const [scope, setScope] = useState<SavedKind | null>(null)
  const [confirming, setConfirming] = useState(false)

  const filtered = useMemo(
    () => (scope === null ? entries : entries.filter((entry) => entry.kind === scope)),
    [entries, scope]
  )

  const open = (entry: SavedEntry): void => {
    // 事件类收藏先进应用内的事件页（那里有完整的时间线），其余的开原文
    if (entry.kind === 'story') {
      onOpenStory(entry.id)
      return
    }
    const url = entry.originalUrl ?? entry.aihotUrl
    if (url) onOpenUrl(url)
  }

  return (
    <>
      <div className="viewhead">
        <span className="viewhead__title" data-testid="title">
          收藏
        </span>
        <span className="viewhead__note">
          {entries.length > 0 ? `${entries.length} 条 · 存在本机` : '还没有收藏'}
        </span>
      </div>

      {entries.length > 0 && (
        <div className="chips">
          <button
            type="button"
            className={`chip${scope === null ? ' is-active' : ''}`}
            onClick={() => setScope(null)}
          >
            全部
          </button>
          {SAVED_KINDS.map((item) => {
            const count = entries.filter((entry) => entry.kind === item.key).length
            return (
              <button
                key={item.key}
                type="button"
                className={`chip${scope === item.key ? ' is-active' : ''}`}
                onClick={() => setScope(item.key)}
                disabled={count === 0}
              >
                {item.label}
                {count > 0 && <span className="chip__num">{count}</span>}
              </button>
            )
          })}

          <span className="chips__spacer" />

          {confirming ? (
            <>
              <button
                type="button"
                className="chip chip--danger"
                onClick={() => {
                  onClear()
                  setConfirming(false)
                  setScope(null)
                }}
              >
                <TrashIcon />
                确认清空
              </button>
              <button type="button" className="chip" onClick={() => setConfirming(false)}>
                取消
              </button>
            </>
          ) : (
            <button type="button" className="chip" onClick={() => setConfirming(true)}>
              清空
            </button>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="state" data-testid="empty-state">
          <div className="state__title">收藏夹是空的</div>
          <div className="state__desc">
            在精选、热榜、事件页或报告里点书签图标，内容会存到本机的一个文件里 ——
            不需要账号，也不会同步到别处。
          </div>
        </div>
      ) : (
        <div className="list" data-testid="saved-list">
          {filtered.map((entry) => (
            <div className="saved" key={entry.key} data-testid="saved-row">
              <span className="saved__kind">{savedKindLabel(entry.kind)}</span>
              <button type="button" className="saved__main" onClick={() => open(entry)}>
                <span className="saved__title">{entry.title}</span>
                <span className="saved__meta">
                  {entry.sourceName && <span>{entry.sourceName}</span>}
                  {entry.at && (
                    <>
                      <span className="row__dot">·</span>
                      <span>{formatRelative(entry.at)}</span>
                    </>
                  )}
                  <span className="row__dot">·</span>
                  <span>收藏于 {formatRelative(new Date(entry.savedAt).toISOString())}</span>
                </span>
              </button>
              <button
                type="button"
                className="savebtn is-on"
                title="取消收藏"
                aria-label="取消收藏"
                onClick={() => onRemove(entry.key)}
              >
                <BookmarkIcon filled />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
