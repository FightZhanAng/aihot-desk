import type { ReactElement } from 'react'
import { formatRelative } from '@shared/format'
import { savedFromArticle, savedFromStory, type SavedInput } from '@shared/saved'
import type { LinkSet } from '@shared/types'
import { useLoaded } from '../useLoaded'
import { BackIcon } from './Icons'
import { SaveButton } from './SaveButton'
import { ErrorBanner, LoadingState } from './States'

/*
 * 事件页 —— 一条热点的"完整的线"。
 *
 * 阅读顺序是刻意的：最新进展 → 来龙去脉 → 报道时间线。
 * 先回答"现在到哪了"，再回答"这事是怎么来的"，最后才是原始材料。
 * 反过来（一上来就是 50 条报道列表）等于把整理工作丢回给读者。
 */

interface StoryViewProps {
  publicId: string
  savedKeys: Set<string>
  onToggleSave: (input: SavedInput) => void
  onOpenUrl: (url: string) => void
  onOpenStory: (publicId: string) => void
  onBack: () => void
}

export function StoryView({
  publicId,
  savedKeys,
  onToggleSave,
  onOpenUrl,
  onOpenStory,
  onBack
}: StoryViewProps): ReactElement {
  const { loaded, reload } = useLoaded(() => window.hotspot.getStory(publicId), [publicId])

  if (loaded === null) return <LoadingState message="正在调取事件…" />

  if (!loaded.data) {
    return (
      <>
        <button type="button" className="backbtn" onClick={onBack}>
          <BackIcon />
          返回
        </button>
        <ErrorBanner message={loaded.error ?? '这个事件没有内容'} onRetry={reload} />
      </>
    )
  }

  const story = loaded.data
  const paragraphs = (story.digest ?? '').split(/\n{2,}/).filter((text) => text.trim().length > 0)
  const open = (links: LinkSet) => (): void => {
    const url = links.aihot ?? links.original
    if (url) onOpenUrl(url)
  }

  return (
    <div className="story">
      <button type="button" className="backbtn" onClick={onBack}>
        <BackIcon />
        返回
      </button>

      <header className="story__head">
        <div className="story__eyebrow">
          <span className={`story__status is-${story.status === 'active' ? 'live' : 'idle'}`}>
            {story.status === 'active' ? '进行中' : '已归档'}
          </span>
          <span className="row__dot">·</span>
          <span>{story.sourceCount} 家信源</span>
          <span className="row__dot">·</span>
          <span>{story.reportCount} 篇报道</span>
        </div>

        <h2 className="story__title" data-testid="story-title">
          {story.title}
        </h2>

        <div className="story__foot">
          <span className="story__times">
            首次报道 {formatRelative(story.firstReportAt)}
            {story.latestAt ? ` · 最新 ${formatRelative(story.latestAt)}` : ''}
          </span>
          <SaveButton
            input={savedFromStory(story)}
            keys={savedKeys}
            onToggle={onToggleSave}
            withLabel
          />
        </div>
      </header>

      {story.latest && (
        <section className="story__block story__block--latest">
          <div className="story__label">最新进展</div>
          <p className="story__latest">{story.latest}</p>
        </section>
      )}

      {paragraphs.length > 0 && (
        <section className="story__block">
          <div className="story__label">来龙去脉</div>
          {paragraphs.map((text, index) => (
            <p className="story__para" key={index}>
              {text}
            </p>
          ))}
          <div className="story__byline">
            由 AIHOT 综述
            {story.digestUpdatedAt ? ` · ${formatRelative(story.digestUpdatedAt)}更新` : ''}
          </div>
        </section>
      )}

      {story.reports.length > 0 && (
        <section className="story__block">
          <div className="story__label">
            报道时间线<span className="story__label-num">{story.reports.length}</span>
          </div>
          <ol className="timeline">
            {story.reports.map((report) => (
              <li className="timeline__item" key={report.id}>
                <div className="timeline__time">{formatRelative(report.publishedAt)}</div>
                <div className="timeline__body">
                  <button type="button" className="timeline__title" onClick={open(report.links)}>
                    {report.title}
                  </button>
                  {report.summary && <p className="timeline__summary">{report.summary}</p>}
                  <div className="timeline__foot">
                    <span className="timeline__source">{report.source.name}</span>
                    <SaveButton
                      input={savedFromArticle(report)}
                      keys={savedKeys}
                      onToggle={onToggleSave}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {story.related.length > 0 && (
        <section className="story__block">
          <div className="story__label">相关事件</div>
          <div className="related">
            {story.related.map((item) => (
              <button
                type="button"
                className="related__item"
                key={item.publicId}
                onClick={() => onOpenStory(item.publicId)}
              >
                {item.title}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
