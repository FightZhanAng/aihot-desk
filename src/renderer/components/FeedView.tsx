import { useEffect, useState, type ReactElement } from 'react'
import { CATEGORY_FILTERS } from '@shared/format'
import type { SavedInput } from '@shared/saved'
import type { CategoryFilter, FeedMode, Item, Loaded, Snapshot } from '@shared/types'
import { FeedList } from './FeedList'
import { CloseIcon, SearchIcon } from './Icons'
import { EmptyState, ErrorBanner, LoadingState } from './States'

/*
 * 精选流（含搜索）。
 *
 * 搜索框放在这一栏而不是单独开一个视图：搜索返回的就是资讯条目，
 * 和精选是同一批内容的两种取法（一个是编辑挑的，一个是按关键词捞的）。
 * 换个视图去做只会让"搜一下看看有没有"这件事多绕一步。
 *
 * 输入防抖 400ms —— 每个字符都发一次请求既浪费，也会撞上 AIHOT 的限流。
 */

const DEBOUNCE_MS = 400
/** 接口本身的下限：短于 2 字不收 */
const MIN_QUERY = 2

interface FeedViewProps {
  snapshot: Snapshot
  category: CategoryFilter
  feedMode: FeedMode
  openId: string | null
  fresh: boolean
  savedKeys: Set<string>
  onToggle: (id: string) => void
  onOpenUrl: (url: string) => void
  onPickCategory: (category: CategoryFilter) => void
  onPickMode: (mode: FeedMode) => void
  onToggleSave: (input: SavedInput) => void
  onRetry: () => void
}

export function FeedView({
  snapshot,
  category,
  feedMode,
  openId,
  fresh,
  savedKeys,
  onToggle,
  onOpenUrl,
  onPickCategory,
  onPickMode,
  onToggleSave,
  onRetry
}: FeedViewProps): ReactElement {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<Loaded<Item[]> | null>(null)
  const [searching, setSearching] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const term = query.trim()
  const active = term.length >= MIN_QUERY

  useEffect(() => {
    if (term.length < MIN_QUERY) {
      setResult(null)
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    const timer = setTimeout(() => {
      void window.hotspot
        .search(term, feedMode)
        .then((loaded) => {
          if (alive) setResult(loaded)
        })
        .catch(() => {
          if (alive) setResult({ data: null, error: '搜索失败，稍后再试' })
        })
        .finally(() => {
          if (alive) setSearching(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [term, feedMode, attempt])

  const { items, error } = snapshot.feed
  const found = result?.data ?? []
  const shown = active ? found : items
  const visibleError = active ? (result?.data ? result.error : (result?.error ?? null)) : error

  return (
    <>
      <div className="viewhead">
        <span className="viewhead__title" data-testid="title">
          精选
        </span>
        <span className="viewhead__note">
          {active
            ? searching
              ? `正在搜索「${term}」…`
              : `「${term}」找到 ${found.length} 条`
            : items.length > 0
              ? `${items.length} 条 · ${feedMode === 'all' ? '全部动态' : '编辑精选'} · 最近 7 天`
              : '当前没有数据'}
        </span>
      </div>

      <label className="searchbox">
        <SearchIcon className="searchbox__icon" />
        <input
          type="search"
          className="searchbox__input"
          value={query}
          placeholder="搜索最近 7 天的公司、模型、产品、人物或话题"
          aria-label="搜索"
          data-testid="search-input"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query.length > 0 && (
          <button
            type="button"
            className="searchbox__clear"
            aria-label="清空"
            onClick={() => setQuery('')}
          >
            <CloseIcon />
          </button>
        )}
      </label>

      <div className="chips">
        <button
          type="button"
          className={`chip${feedMode === 'selected' ? ' is-active' : ''}`}
          onClick={() => onPickMode('selected')}
        >
          编辑精选
        </button>
        <button
          type="button"
          className={`chip${feedMode === 'all' ? ' is-active' : ''}`}
          onClick={() => onPickMode('all')}
        >
          全部动态
        </button>

        {/* 搜索不吃分类参数，这时把分类条收起来，别给一个点了没反应的控件 */}
        {!active && (
          <>
            <span className="chips__divider" aria-hidden="true" />
            {CATEGORY_FILTERS.map((filter) => (
              <button
                key={filter.key ?? 'all'}
                type="button"
                className={`chip chip--light${category === filter.key ? ' is-active' : ''}`}
                onClick={() => onPickCategory(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </>
        )}
      </div>

      {visibleError && !active && <ErrorBanner message={visibleError} onRetry={onRetry} />}
      {active && visibleError && found.length === 0 && (
        <ErrorBanner message={visibleError} onRetry={() => setAttempt((n) => n + 1)} />
      )}

      {active && searching && found.length === 0 ? (
        <LoadingState message="正在搜索…" />
      ) : shown.length === 0 ? (
        active ? (
          <EmptyState
            title={`没有找到「${term}」`}
            desc="换个关键词试试 —— 搜索只覆盖 AIHOT 最近 7 天的内容。"
          />
        ) : (
          <EmptyState
            title="这个分类下没有内容"
            desc="换一个分类看看，或者稍后再来 —— AIHOT 每天都会更新精选。"
          />
        )
      ) : (
        <FeedList
          items={shown}
          openId={openId}
          fresh={fresh && !active}
          savedKeys={savedKeys}
          onToggle={onToggle}
          onOpenUrl={onOpenUrl}
          onToggleSave={onToggleSave}
        />
      )}
    </>
  )
}
