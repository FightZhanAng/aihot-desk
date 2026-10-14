import { useMemo, useState, type ReactElement } from 'react'
import {
  changelogEntryCount,
  changelogKindTally,
  changelogMonthTally,
  filterChangelog
} from '@shared/changelog'
import { formatDateLabel, formatMonthLabel, formatRelative } from '@shared/format'
import { useLoaded } from '../useLoaded'
import { ExternalIcon, RefreshIcon } from './Icons'
import { ErrorBanner, LoadingState } from './States'

/*
 * AIHOT 的更新日志。
 *
 * 第一件要说清的事：**这不是本应用的更新日志**。
 * 它就在侧栏「设置」上面，名字也叫「更新日志」，用户十有八九会当成
 * "这个应用最近改了什么" —— 而它记的是**数据来源站点自己**的变更。
 * 所以标题下面那条说明不是装饰，是这一页最容易被误解的地方。
 *
 * 内容是"服务本身变了什么"，不是资讯 —— 没有来源、没有信号带，
 * 版式就照着一份变更记录来：左边按天分组，右边给出两种索引
 * （按类型 / 按月份）和一个反馈出口。
 * 索引只做筛选、不做跳转 —— 这一页统共几百行，滚一下比"点一下就跳走"省事。
 *
 * 数据是从页面解析出来的（更新日志没有 JSON 接口，见 shared/changelog.ts），
 * 所以底部保留「去 AIHOT 看原页面」这条路：解析器认不出来的时候，
 * 用户至少还能看到全文。
 *
 * 例外是"特稿"那种日子（整天的重点是一篇长文）：这里只放标题、导语和小节目录，
 * 换一张带信号红脊线的卡片装，并在末尾直接给出"读全文"的出口 ——
 * 一篇几千字的东西挤进这种一览式的列表里，谁都读不下去。
 */

const CHANGELOG_PAGE = 'https://aihot.news/changelog'
const FEEDBACK_PAGE = 'https://aihot.news/feedback'

/**
 * 类型色点。
 *
 * 四档刻意只用已有的墨阶，不开新颜色 —— 全站就一支强调色（--signal），
 * 「更新」用它，其余三档按分量落到 ink-2 / ink-3 / ink-4 上。
 * 这几个变量在深浅两套主题里都是"从最强到最弱"，所以这里不用再单独翻一遍方向。
 */
const KIND_TIER: Record<string, string> = {
  更新: 'new',
  优化: 'tune',
  公告: 'note',
  下线: 'retire'
}

function tierOf(kind: string): string {
  return KIND_TIER[kind] ?? 'other'
}

interface ChangelogViewProps {
  onOpenUrl: (url: string) => void
}

export function ChangelogView({ onOpenUrl }: ChangelogViewProps): ReactElement {
  const { loaded, reload, reloadFresh } = useLoaded(
    (force) => window.hotspot.getChangelog(force),
    []
  )
  /** null = 这一维不筛。两维叠加：都选中就都得满足 */
  const [kind, setKind] = useState<string | null>(null)
  const [month, setMonth] = useState<string | null>(null)

  const days = loaded?.data ?? []
  const kinds = useMemo(() => changelogKindTally(days), [days])
  const months = useMemo(() => changelogMonthTally(days), [days])
  const shown = useMemo(() => filterChangelog(days, kind, month), [days, kind, month])

  if (loaded === null) return <LoadingState message="正在读取更新日志…" />

  const total = changelogEntryCount(days)
  const shownCount = changelogEntryCount(shown)
  const filtering = kind !== null || month !== null
  const latest = days[0]

  const clearFilters = (): void => {
    setKind(null)
    setMonth(null)
  }

  return (
    <>
      <div className="viewhead">
        <span className="viewhead__title" data-testid="title">
          更新日志
        </span>
        <span className="viewhead__note">
          {total > 0
            ? `${total} 条记录 · 最近 ${latest ? formatRelative(`${latest.date}T00:00:00+08:00`) : ''}`
            : 'AIHOT 的功能更新、优化与下线记录'}
        </span>
      </div>

      {loaded.error && <ErrorBanner message={loaded.error} onRetry={reload} />}

      {days.length === 0 && !loaded.error ? (
        <div className="state">
          <div className="state__title">暂时读不出来</div>
          <div className="state__desc">
            更新日志只能从 AIHOT 的页面上取，可能是网络原因，也可能页面改版了。
            稍后再试一次，或者直接去站上看。
          </div>
        </div>
      ) : (
        <>
          {/*
            * 这条说明是这一页的重点。侧栏里它挨着「设置」，名字又叫「更新日志」，
            * 不写清楚，用户会一直在里面找"这个应用什么时候改的悬浮胶囊"。
            */}
          <p className="log__scope" data-testid="log-scope">
            这里记的是数据来源站点 <b>AIHOT</b> 自己的功能变更 ——
            <b>不是本应用的更新日志</b>。本应用自己的版本记录在左下角「设置」里。
          </p>

          <div className="logwrap">
            <div className="log" data-testid="log">
              {filtering && shown.length > 0 && (
                <div className="log__filter">
                  <span>
                    筛出 <b>{shownCount}</b> 条
                  </span>
                  <button type="button" className="log__filter-clear" onClick={clearFilters}>
                    清除筛选
                  </button>
                </div>
              )}

              {shown.map((day) => (
                <section className="log__day" key={day.date}>
                  <h3 className="log__date">
                    {formatDateLabel(day.date)}
                    {day.weekday && <span className="log__weekday">{day.weekday}</span>}
                  </h3>
                  <ol className="log__list">
                    {day.entries.map((entry, index) => (
                      <li
                        className={`log__item${entry.feature ? ' is-feature' : ''}`}
                        key={`${day.date}-${entry.time}-${index}`}
                      >
                        <div className="log__rail">
                          <span className="log__time">{entry.time}</span>
                          <span className={`log__kind is-${tierOf(entry.kind)}`}>{entry.kind}</span>
                        </div>
                        <div className="log__body">
                          <h4 className="log__title">{entry.title}</h4>
                          {entry.body.map((text, i) => (
                            <p className="log__para" key={i}>
                              {text}
                            </p>
                          ))}
                          {entry.bullets.length > 0 && (
                            <>
                              {/* 特稿的 bullets 是小节目录，不是要点，得说清楚它是什么 */}
                              {entry.feature && <div className="log__caption">这篇更新包含</div>}
                              <ul className="log__bullets">
                                {entry.bullets.map((text, i) => (
                                  <li key={i}>{text}</li>
                                ))}
                              </ul>
                            </>
                          )}
                          {entry.feature && (
                            <div className="log__more">
                              正文较长，这里只放开头
                              <button
                                type="button"
                                className="log__more-link"
                                onClick={() => onOpenUrl(CHANGELOG_PAGE)}
                              >
                                读全文
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}

              {shown.length === 0 && (
                <div className="log__none" data-testid="log-none">
                  <div className="log__none-title">没有符合条件的记录</div>
                  <div className="log__none-desc">换个类型或月份再看看。</div>
                  <button type="button" className="btn" onClick={clearFilters}>
                    看全部
                  </button>
                </div>
              )}
            </div>

            <aside className="logside">
              <section className="logside__card">
                <h3 className="logside__title">按类型看</h3>
                <ul className="logside__list" data-testid="log-kinds">
                  <li>
                    <button
                      type="button"
                      className={`logside__opt${kind === null ? ' is-on' : ''}`}
                      aria-pressed={kind === null}
                      onClick={() => setKind(null)}
                    >
                      <span className="logside__dot is-all" aria-hidden="true" />
                      <span className="logside__label">全部</span>
                      <span className="logside__count">{total}</span>
                    </button>
                  </li>
                  {kinds.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        className={`logside__opt${kind === item.key ? ' is-on' : ''}`}
                        aria-pressed={kind === item.key}
                        onClick={() => setKind(kind === item.key ? null : item.key)}
                      >
                        <span className={`logside__dot is-${tierOf(item.key)}`} aria-hidden="true" />
                        <span className="logside__label">{item.key}</span>
                        <span className="logside__count">{item.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="logside__card">
                <h3 className="logside__title">按月份</h3>
                <ul className="logside__list" data-testid="log-months">
                  {months.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        className={`logside__opt${month === item.key ? ' is-on' : ''}`}
                        aria-pressed={month === item.key}
                        onClick={() => setMonth(month === item.key ? null : item.key)}
                      >
                        <span className="logside__label">{formatMonthLabel(item.key)}</span>
                        <span className="logside__count">{item.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              {/*
                * 反馈指向的是 AIHOT 的反馈页，不是本应用的渠道 ——
                * 这一栏说的是"那边的东西想改"，措辞里得带上主语。
                */}
              <section className="logside__card">
                <h3 className="logside__title">有想法或遇到问题</h3>
                <p className="logside__note">
                  对 AIHOT 有想加的功能、用着不顺手的地方，可以去它的反馈页提。
                </p>
                <button
                  type="button"
                  className="logside__go"
                  onClick={() => onOpenUrl(FEEDBACK_PAGE)}
                >
                  去 AIHOT 反馈
                  <ExternalIcon />
                </button>
              </section>
            </aside>
          </div>
        </>
      )}

      <div className="log__actions">
        <button type="button" className="btn" onClick={reloadFresh}>
          <RefreshIcon />
          重新读取
        </button>
        <button type="button" className="btn" onClick={() => onOpenUrl(CHANGELOG_PAGE)}>
          <ExternalIcon />
          在 AIHOT 看原页面
        </button>
      </div>
    </>
  )
}
