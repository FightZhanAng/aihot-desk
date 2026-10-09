import { useEffect, useMemo, useState, type MouseEvent, type ReactElement } from 'react'
import {
  codexCalendar,
  codexMonthTally,
  codexState,
  codexStateText,
  codexStats,
  daysFromToday,
  groupCodexByDay
} from '@shared/codex'
import {
  formatClock,
  formatDateLabel,
  formatMonthLabel,
  formatRelative,
  formatShortDate,
  monthOf,
  shanghaiDay,
  shiftMonth
} from '@shared/format'
import type { CodexCalendarDay, CodexResetEvent, CodexState } from '@shared/types'
import { useLoaded } from '../useLoaded'
import { ExternalIcon } from './Icons'
import { ErrorBanner, LoadingState } from './States'

/*
 * Codex 额度重置。
 *
 * 这条线最要紧的一件事：**"说了要发"和"确实发了"必须一眼能分开**。
 * 把预告当既成事实展示，用户会白等一晚上额度到账。所以这里把它做成了
 * 一套贯穿全页的记号 —— 日历格子的颜色、日志卡片的行首、顶部统计的取舍，
 * 用的都是同一个四档状态。
 *
 * 版式分三块，回答三个不同的问题：
 *   顶部四个数字 —— 这条线最近的节奏是快是慢；
 *   左边的月历   —— 什么时候发生、接下来还有没有；
 *   右边的合订本 —— 具体是哪天几点、原话怎么说的。
 *
 * 统计口径（四档状态、90 天窗口、间隔按时刻而非整天）不是想当然定的，
 * 是拿 AIHOT 监控页上印着的数字逐条反推核对过的，见 shared/codex.ts。
 */

const MONITOR_PAGE = 'https://aihot.news/codex-reset'
/** 周一起头 —— 和 AIHOT 的日历、以及日报的发行点阵同一个读法 */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/** 四档状态在界面上长什么样：一个点的样式 + 一句话 */
const STATE_MARK: Record<CodexState, { label: string; hint: string }> = {
  confirmed: { label: '已生效', hint: '官方确认，时间明确' },
  likely: { label: '已生效（未明确）', hint: '官方确认，时间只是推算' },
  due: { label: '应已生效', hint: '按预计时间，未见确认帖' },
  waiting: { label: '等待生效', hint: '已宣布，还没到点' }
}

const LEGEND: CodexState[] = ['confirmed', 'likely', 'due', 'waiting']

interface CodexViewProps {
  /** 加载完成后把条数报上去，侧栏的档位徽标要用 */
  onCount: (count: number) => void
  onOpenUrl: (url: string) => void
}

export function CodexView({ onCount, onOpenUrl }: CodexViewProps): ReactElement {
  const { loaded, reload } = useLoaded(() => window.hotspot.getCodexResets(), [])
  /** 只在用户翻过月之后才有值；没翻过就跟着服务端的"今天"走 */
  const [typedMonth, setTypedMonth] = useState<string | null>(null)
  /*
   * 右边合订本正看哪一天。三种取值缺一不可：
   *   undefined   还没动过 —— 跟着服务端的"今天"走（打开页面就是这个态）
   *   null        显式点了"全部记录"
   *   日期字符串  点了某一天
   *
   * 默认刻意不是"全部"：这条线攒了四十多条，全铺出来时"最近一次是什么时候"
   * 要往下翻好几屏才看得到 —— 而那恰好是打开这一页最想知道的事。
   * AIHOT 的监控页也是这个取舍（默认定在当天），这里跟它保持一致。
   */
  const [picked, setPicked] = useState<string | null | undefined>(undefined)

  const snapshot = loaded?.data ?? null
  const events = snapshot?.events ?? []
  const today = snapshot?.today ?? ''
  /*
   * "过没过预计时间"用服务端这次采集的时刻来判，不用本机时钟 ——
   * 机器时钟偏一点，就会有事件在"应已生效"和"等待生效"之间跳来跳去。
   */
  const nowMs = useMemo(
    () => Date.parse(snapshot?.checkedAt ?? '') || Date.now(),
    [snapshot?.checkedAt]
  )

  const stats = useMemo(
    () => (today ? codexStats(events, today, nowMs) : null),
    [events, today, nowMs]
  )

  const month = typedMonth ?? monthOf(today)
  const thisMonth = monthOf(today)
  const cells = useMemo(
    () => (month ? codexCalendar(events, month, nowMs) : []),
    [events, month, nowMs]
  )
  /*
   * 翻到别的月份时，这行读数要跟着走 —— 只认"本月"的话，用户一翻页
   * 这块就空了，看起来像这个月什么都没发生。
   */
  const tally = useMemo(
    () => (month ? codexMonthTally(events, month, nowMs) : null),
    [events, month, nowMs]
  )
  const allGroups = useMemo(() => groupCodexByDay(events), [events])
  /** 实际在看的那一天；没选过就跟今天。为 null 表示"全部" */
  const focusDay = picked === undefined ? today || null : picked
  const groups = useMemo(
    () => (focusDay ? allGroups.filter((group) => group.day === focusDay) : allGroups),
    [allGroups, focusDay]
  )
  /** 最近一次有记录的那天 —— 空态里"看最近一次"那个出口要用它 */
  const latestDay = allGroups[0]?.day ?? null

  useEffect(() => {
    if (snapshot) onCount(snapshot.events.length)
  }, [snapshot, onCount])

  if (loaded === null) return <LoadingState message="正在调取重置记录…" />

  const waiting = events.filter((event) => codexState(event, nowMs) === 'waiting').length

  /*
   * 翻月：把焦点带到那个月最近有记录的一天。
   *
   * 不保留原来的焦点 —— 翻到 9 月、右边还印着 10 月的事，日历和合订本就对不上了；
   * 也不一律退回"全部" —— 那样这条线一长，翻完月又要往下翻。
   * 那个月一条记录都没有时才退回全部（总比停在一个空日期上强）。
   */
  const gotoMonth = (next: string): void => {
    setTypedMonth(next)
    setPicked(allGroups.find((group) => group.day.slice(0, 7) === next)?.day ?? null)
  }

  /** 直接跳到某一天 —— 空态里那个"看最近一次记录"走这条路 */
  const jumpTo = (day: string): void => {
    setTypedMonth(monthOf(day))
    setPicked(day)
  }

  return (
    <>
      <div className="viewhead">
        <span className="viewhead__title" data-testid="title">
          Codex 重置监控
        </span>
        <span className="viewhead__note">
          {events.length > 0
            ? `${events.length - waiting} 次已生效${waiting > 0 ? ` · ${waiting} 次等待生效` : ''}`
            : 'AIHOT 观测到的额度重置与重置卡'}
        </span>
      </div>

      {loaded.error && <ErrorBanner message={loaded.error} onRetry={reload} />}

      {events.length === 0 && !loaded.error ? (
        <div className="state">
          <div className="state__title">暂时没有记录</div>
          <div className="state__desc">AIHOT 会在 Tibo 放出重置消息时记下来，这里会自动更新。</div>
        </div>
      ) : (
        <>
          {stats && (
            <div className="cxstats" data-testid="codex-stats">
              <StatCell label="近 90 天额度重置" value={stats.reset90} unit="次" />
              <StatCell label="近 90 天发重置卡" value={stats.credit90} unit="次" />
              <StatCell
                label="重置间隔中位数"
                value={stats.medianGap === null ? '—' : stats.medianGap}
                unit={stats.medianGap === null ? '' : '天'}
              />
              <StatCell
                label="上次额度重置"
                value={stats.lastResetDay ? formatDateLabel(stats.lastResetDay) : '—'}
              />
            </div>
          )}

          <div className="cxbody">
            <section className="cxcal">
              <div className="cxcal__intro">
                <h3 className="cxcal__heading">重置日历</h3>
                <p className="cxcal__desc">点带标签的日期，右边就只看那天；默认停在今天。</p>
              </div>

              <div className="cxcal__card">
                <div className="cxcal__bar">
                  <span className="cxcal__month">{formatMonthLabel(month)}</span>
                  <div className="cxcal__nav">
                    <button
                      type="button"
                      className="cxcal__link"
                      onClick={() => {
                        setTypedMonth(monthOf(today))
                        setPicked(undefined)
                      }}
                    >
                      今天
                    </button>
                    <button
                      type="button"
                      className="cxcal__link"
                      onClick={() => setPicked(null)}
                      disabled={picked === null}
                    >
                      全部记录
                    </button>
                    <button
                      type="button"
                      className="cxcal__step"
                      aria-label="上个月"
                      onClick={() => gotoMonth(shiftMonth(month, -1))}
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="cxcal__step"
                      aria-label="下个月"
                      onClick={() => gotoMonth(shiftMonth(month, 1))}
                    >
                      ›
                    </button>
                  </div>
                </div>

                {tally && (tally.resets > 0 || tally.credits > 0) && (
                  <p className="cxcal__sub">
                    {month === thisMonth ? '本月' : `${Number(month.slice(5))} 月`}{' '}
                    <b>{tally.resets}</b> 次额度重置 · <b>{tally.credits}</b> 次发重置卡
                  </p>
                )}

                <div className="cxcal__grid">
                  {WEEKDAYS.map((name) => (
                    <span className="cxcal__wd" key={name}>
                      {name}
                    </span>
                  ))}
                  {cells.map((cell, index) => (
                    <CalendarCell
                      key={cell.day?.day ?? `blank-${index}`}
                      day={cell.day}
                      today={today}
                      picked={focusDay}
                      stateOf={(day) => cellStateAt(events, day, nowMs)}
                      onPick={(day) => setPicked((current) => (current === day ? null : day))}
                    />
                  ))}
                </div>

                <ul className="cxcal__legend">
                  {LEGEND.map((state) => (
                    <li className="cxcal__legend-item" key={state}>
                      <span className={`cxdot is-${state}`} aria-hidden="true" />
                      <span className="cxcal__legend-text">
                        {STATE_MARK[state].label}
                        <span className="cxcal__legend-hint">{STATE_MARK[state].hint}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="cxlog">
              <div className="cxlog__head">
                <h3 className="cxlog__heading">日志合订本</h3>
                {/*
                  这一栏在"看哪一天"上有个明确的状态，所以把头牌做成"状态 + 出口"：
                  左边说清现在看的是什么，右边给回全部的口子。
                  原来那个「{日期} · 显示全部」把状态和动作挤在同一句里，
                  默认态下两边都不显示 —— 用户看不出这栏现在是全部还是某一天。
                */}
                <div className="cxlog__tools">
                  <span className="cxlog__focus" data-testid="codex-focus">
                    {focusDay
                      ? `${formatDateLabel(focusDay)}${focusDay === today ? ' · 今天' : ''}`
                      : `全部 ${events.length} 条`}
                  </span>
                  {focusDay && (
                    <button type="button" className="cxlog__clear" onClick={() => setPicked(null)}>
                      看全部
                    </button>
                  )}
                </div>
              </div>

              {groups.length === 0 && (
                <div className="cxlog__empty" data-testid="codex-empty">
                  <div className="cxlog__empty-title">
                    {focusDay ? '这一天没有记录' : '没有可显示的记录'}
                  </div>
                  <div className="cxlog__empty-desc">
                    {focusDay
                      ? '重置和发卡只在个别日子发生 —— 日历上写着「重置」或「重置卡」的格子才有内容。'
                      : '这批数据里没有落在具体某一天的记录。'}
                  </div>
                  {focusDay && latestDay && (
                    <button
                      type="button"
                      className="btn cxlog__empty-go"
                      onClick={() => jumpTo(latestDay)}
                    >
                      看最近一次记录 · {formatDateLabel(latestDay)}
                    </button>
                  )}
                </div>
              )}

              {groups.map((group) => (
                <div className="cxlog__group" key={group.day}>
                  <div className="cxlog__daybar">
                    <span className="cxlog__day">{formatDateLabel(group.day)}</span>
                    <span className="cxlog__year">{group.day.slice(0, 4)}</span>
                  </div>
                  {group.events.map((event, index) => (
                    <CodexCard
                      /*
                       * 官方数据里有 10 组 id 重复（同一个 id 挂着一条 confirmed
                       * 和一条 announced），拿 id 当 key 会撞。位置后缀保证唯一。
                       */
                      key={`${event.id}-${index}`}
                      event={event}
                      state={codexState(event, nowMs)}
                      onOpenUrl={onOpenUrl}
                    />
                  ))}
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </>
  )
}

/** 一个方格子里当天"最实"的那一档 —— 和月历的着色规则保持一致 */
function cellStateAt(events: CodexResetEvent[], day: CodexCalendarDay, nowMs: number): CodexState {
  let best: CodexState = 'waiting'
  const rank: Record<CodexState, number> = { confirmed: 3, likely: 2, due: 1, waiting: 0 }
  for (const event of events) {
    if (event.day !== day.day) continue
    const state = codexState(event, nowMs)
    if (rank[state] > rank[best]) best = state
  }
  return best
}

function StatCell({
  label,
  value,
  unit
}: {
  label: string
  value: string | number
  unit?: string
}): ReactElement {
  return (
    <div className="cxstat">
      <span className="cxstat__label">{label}</span>
      <span className="cxstat__value">
        {value}
        {unit && <span className="cxstat__unit">{unit}</span>}
      </span>
    </div>
  )
}

function CalendarCell({
  day,
  today,
  picked,
  stateOf,
  onPick
}: {
  day: CodexCalendarDay | null
  today: string
  picked: string | null
  stateOf: (day: CodexCalendarDay) => CodexState
  onPick: (day: string) => void
}): ReactElement {
  if (!day) return <span className="cxcell is-blank" aria-hidden="true" />

  const state = stateOf(day)
  const distance = today ? daysFromToday(day.day, today) : Number.NaN
  const isToday = distance === 0
  // 没有记录的日子只是一张日期纸，不该有按钮的手感
  const hasRecords = day.marked

  if (!hasRecords) {
    return (
      <span className={`cxcell${isToday ? ' is-today' : ''}`}>
        <span className="cxcell__num">{day.date}</span>
      </span>
    )
  }

  return (
    <button
      type="button"
      className={`cxcell is-marked is-${state}${isToday ? ' is-today' : ''}${
        picked === day.day ? ' is-picked' : ''
      }`}
      data-testid="codex-cell"
      data-day={day.day}
      aria-pressed={picked === day.day}
      onClick={() => onPick(day.day)}
    >
      <span className="cxcell__num">{day.date}</span>
      <span className="cxcell__badges">
        {/*
          格子里只有 48px 宽，徽标文案必须短。「重置 / 重置卡」比
          「额度重置 / 发重置卡」各短两个字，省下来的正是那一格。
          完整说法挂在 title 上 —— 鼠标停一下就补全，信息不丢。
          数量口径和 AIHOT 一样：多出来的折成「+N」（两条显示「重置 +1」）。
        */}
        {day.resets > 0 && (
          <span className="cxbadge" title={`额度重置 ${day.resets} 次`}>
            重置{day.resets > 1 ? ` +${day.resets - 1}` : ''}
          </span>
        )}
        {day.credits > 0 && (
          <span className="cxbadge is-credit" title={`发重置卡 ${day.credits} 次`}>
            重置卡{day.credits > 1 ? ` +${day.credits - 1}` : ''}
          </span>
        )}
      </span>
    </button>
  )
}

function CodexCard({
  event,
  state,
  onOpenUrl
}: {
  event: CodexResetEvent
  state: CodexState
  onOpenUrl: (url: string) => void
}): ReactElement {
  const inCard = (handler: () => void) => (click: MouseEvent) => {
    click.stopPropagation()
    handler()
  }

  const scope = [event.audience, event.products].filter(Boolean).join('、')

  return (
    <article className={`cxcard is-${state}`} data-testid="codex-card">
      <div className="cxcard__state">
        <span className={`cxdot is-${state}`} aria-hidden="true" />
        <span className="cxcard__state-text">{codexStateText(state)}</span>
        {/*
          "已生效"和"已生效 · 时间未明确"自己就说清楚了；
          "应已生效""等待生效"这两档最容易被误读（一个是没确认帖、一个是还没到点），
          在卡片上补一句"为什么是这个状态"。
        */}
        {(state === 'due' || state === 'waiting') && (
          <span className="cxcard__state-hint">{STATE_MARK[state].hint}</span>
        )}
      </div>

      <h4 className="cxcard__title">{event.title || event.displayLabel}</h4>

      <div className="cxcard__meta">
        {event.confirmedAt ? (
          // 日期从 confirmedAt 自己推 —— 用 event.day（落点）会和钟点对不上
          <span>
            确认于 {formatShortDate(shanghaiDay(event.confirmedAt))} {formatClock(event.confirmedAt)}
          </span>
        ) : (
          <span>尚未确认</span>
        )}
        {event.scheduleLabel && (
          <>
            <span className="cxcard__dot">·</span>
            <span>{event.scheduleLabel}</span>
          </>
        )}
      </div>

      {scope && <div className="cxcard__scope">适用范围：{scope}</div>}

      <ol className="cxposts">
        {event.posts.map((post) => (
          <li className="cxpost" key={post.id}>
            <div className="cxpost__head">
              {post.stage && <span className="cxpost__stage">{post.stage}</span>}
              <span className="cxpost__time">{formatRelative(post.publishedAt)}</span>
              {post.url && (
                <button
                  type="button"
                  className="cxpost__link"
                  onClick={inCard(() => onOpenUrl(post.url as string))}
                >
                  原推
                </button>
              )}
            </div>
            {post.fullText && <p className="cxpost__text">{post.fullText}</p>}
            {post.originalText && post.originalText !== post.fullText && (
              <details className="cxpost__more">
                <summary>英文原文</summary>
                <p className="cxpost__original">{post.originalText}</p>
              </details>
            )}
          </li>
        ))}
      </ol>

      <div className="cxcard__foot">
        <button
          type="button"
          className="cxcard__open"
          onClick={inCard(() => onOpenUrl(MONITOR_PAGE))}
        >
          <ExternalIcon />
          在 AIHOT 看监控页
        </button>
      </div>
    </article>
  )
}
