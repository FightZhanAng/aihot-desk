import { useMemo, useState, type ReactElement } from 'react'
import {
  dayOfMonth,
  daysInMonth,
  formatClock,
  formatDateRange,
  formatMonthLabel,
  formatRelative,
  makeDate,
  monthNameCN,
  monthOf,
  reportKeyLabel,
  reportKindLabel,
  weekdayIndex,
  weekdayOf,
  REPORT_KINDS
} from '@shared/format'
import {
  dailyStats,
  groupReportsByMonth,
  issueNumber,
  periodicalHighlights,
  periodicalLead,
  periodicalStats,
  yearIssueCount
} from '@shared/report'
import { savedFromArticle, type SavedInput } from '@shared/saved'
import type { LinkSet, ReportDetail, ReportEntry, ReportKind } from '@shared/types'
import { useLoaded } from '../useLoaded'
import { SaveButton } from './SaveButton'
import { EmptyState, ErrorBanner, LoadingState } from './States'

/*
 * 报告 —— 三个档位共用一套「报纸」骨架：左边是往期合订，中间是版面，
 * 右边是这一期的目录。理由很简单：看某一期这件事的形状是一样的，
 * 三档各写一套版式只会让"看某一期"长出三套操作习惯。
 *
 * 差别在中间那一栏问的问题不一样：
 *   日报   —— "今天发生了什么、有多少" → 刊头 + 日期牌 + 头条 + 分栏 + 快讯
 *   周报月报 —— "这一期讲了什么"      → 刊头 + 期号徽记 + 导读 + 头条 + 分栏
 *
 * 右栏两块都是从数据里算出来的，不冒充站上编辑挑的那份：
 *   各栏目头条 = 每个分栏打头的那一条
 *   本期栏目   = 各分栏的条数
 * AIHOT 页上那个「今日看点」「本周看点」是编辑挑的，开放接口没有这个字段。
 */

/** 三个档位各自多久出一期 —— 写在提示里，省得用户猜"为什么只有这一期" */
const CADENCE: Record<ReportKind, string> = {
  daily: '每天 08:00 发布',
  weekly: '每周一发布',
  monthly: '每月 1 日发布'
}

/** 刊名下面那行小字：这是什么刊、多久出一次 */
const KICK: Record<ReportKind, string> = {
  daily: '人工智能 · 每日要闻',
  weekly: '人工智能 · 每周综述',
  monthly: '人工智能 · 每月盘点'
}

/** 右栏第一块的抬头按档位换字：本周看点 / 本月看点 */
const SCOPE: Record<ReportKind, string> = {
  daily: '今日',
  weekly: '本周',
  monthly: '本月'
}

/** 「期刊合订本」跳到站上对应那一档的归档页 */
const ARCHIVE_PAGE: Record<ReportKind, string> = {
  daily: 'https://aihot.news/daily',
  weekly: 'https://aihot.news/weekly',
  monthly: 'https://aihot.news/monthly'
}

/** 小点阵的星期表头：和 AIHOT 一样从周一起头，紧凑 */
const MINI_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

interface ReportViewProps {
  savedKeys: Set<string>
  onToggleSave: (input: SavedInput) => void
  onOpenUrl: (url: string) => void
}

export function ReportView({ savedKeys, onToggleSave, onOpenUrl }: ReportViewProps): ReactElement {
  const [kind, setKind] = useState<ReportKind>('daily')
  /** 选中的期号；null = 最新一期 */
  const [period, setPeriod] = useState<string | null>(null)

  /*
   * 换档位时把选中的期号一起清掉 —— 「第 40 周」放到月报里是没有意义的。
   *
   * 清期号和换档位必须在同一次点击里做完。原来这里是
   * `useEffect(() => setPeriod(null), [kind])`，那样会先渲染一帧
   * 「新档位 + 旧期号」，而取数 hook 是按 [kind, period] 触发的 ——
   * 那一帧会真的拿着日报的日期去问周报接口（/weeklies/2026-10-08 → 400）。
   * 界面上看不出来，因为下一帧就自愈了，但每切一次档就白打一次被拒的请求。
   * 两个 setState 写在一起，React 会合并成同一次渲染。
   */
  function pickKind(next: ReportKind): void {
    if (next === kind) return
    setKind(next)
    setPeriod(null)
  }

  const list = useLoaded(() => window.hotspot.listReports(kind), [kind])
  const detail = useLoaded(() => window.hotspot.getReport(kind, period ?? undefined), [kind, period])

  const entries = list.loaded?.data ?? []
  // 没选具体期时，高亮的是归档里的第一条（也就是最新那期）
  const activeKey = period ?? entries[0]?.key ?? null
  const report = detail.loaded?.data ?? null

  const kindSwitch = (
    <div className="chips" data-testid="kind-switch">
      {REPORT_KINDS.map((item) => (
        <button
          key={item}
          type="button"
          className={`chip${kind === item ? ' is-active' : ''}`}
          onClick={() => pickKind(item)}
        >
          {reportKindLabel(item)}
        </button>
      ))}
    </div>
  )

  const detailNode =
    detail.loaded === null ? (
      <LoadingState message="正在调取报告…" />
    ) : !report ? (
      <>
        {detail.loaded.error && <ErrorBanner message={detail.loaded.error} onRetry={detail.reload} />}
        {!detail.loaded.error && (
          <EmptyState
            title={`还没有${reportKindLabel(kind)}`}
            desc={`AIHOT 的${reportKindLabel(kind)}${CADENCE[kind]}，稍后再来看看。`}
          />
        )}
      </>
    ) : kind === 'daily' ? (
      <DailyPaper
        report={report}
        entries={entries}
        activeKey={activeKey}
        savedKeys={savedKeys}
        onToggleSave={onToggleSave}
        onOpenUrl={onOpenUrl}
        onPick={setPeriod}
      />
    ) : (
      <FasciclePaper
        report={report}
        entries={entries}
        activeKey={activeKey}
        savedKeys={savedKeys}
        onToggleSave={onToggleSave}
        onOpenUrl={onOpenUrl}
        onPick={setPeriod}
      />
    )

  return (
    <>
      <div className="viewhead">
        {/* 标题跟着档位走 —— 侧栏那一项叫「AI 日报」，进了周报就该写「AI 周报」 */}
        <span className="viewhead__title" data-testid="title">
          {`AI ${reportKindLabel(kind)}`}
        </span>
        <span className="viewhead__note">
          {report ? `${reportKeyLabel(kind, report.key)} · ${CADENCE[kind]}` : CADENCE[kind]}
        </span>
      </div>

      {/*
        档位切换在**所有档位**下都要在。
        一开始只给周报月报留了它（想着"报纸版式自带刊头，别再压一条横排"），
        结果日报档位下没有任何入口能切出去 —— 用户被困在日报里。
        一行 chips 换掉一个死胡同，这买卖很值。
      */}
      {kindSwitch}

      {/*
        原来这里还有一条横排的期号条，现在撤了：三个档位的版式里都自带往期栏，
        期刊号列在左边一列、还能读到标题 —— 再压一条横排就是把同一件事说两遍，
        而且横排到 20 多期就得横向滚。
      */}

      {/*
        往期列表是另一份请求（reports:list）。它失败时正文照常显示，但左边那一栏
        会是空的、期号徽记也会退化成"全年 0 期" —— 不把这条错误显示出来，
        用户就分不清"这一刊还没有往期"和"往期没取到"。
      */}
      {list.loaded?.error && (
        <ErrorBanner message={`往期列表：${list.loaded.error}`} onRetry={list.reload} />
      )}

      {detailNode}
    </>
  )
}

/* ------------------------------------------------------------ 日报：报纸版式 */

function DailyPaper({
  report,
  entries,
  activeKey,
  savedKeys,
  onToggleSave,
  onOpenUrl,
  onPick
}: {
  report: ReportDetail
  entries: ReportEntry[]
  activeKey: string | null
  savedKeys: Set<string>
  onToggleSave: (input: SavedInput) => void
  onOpenUrl: (url: string) => void
  onPick: (key: string) => void
}): ReactElement {
  const stats = dailyStats(report)
  const groups = useMemo(() => groupReportsByMonth(entries), [entries])
  const month = monthOf(report.key)

  /*
   * 往期有 100 期，全展开是一列读不完的流水账。默认只展开正在看的这个月，
   * 其余折起来；用户自己点过之后就以他的选择为准。
   */
  const defaultClosed = useMemo(
    () => new Set(groups.filter((group) => group.month !== month).map((group) => group.month)),
    [groups, month]
  )
  const [manual, setManual] = useState<Set<string> | null>(null)
  const closed = manual ?? defaultClosed

  const issueDays = useMemo(() => {
    const days = new Set<string>()
    for (const entry of entries) {
      if (monthOf(entry.key) === month) days.add(entry.key)
    }
    return days
  }, [entries, month])

  /** 各分栏打头的那一条 —— 今天最该先看的几条 */
  const highlights = report.sections
    .map((section) => {
      const first = section.items[0]
      return first ? { section: section.label, item: first } : null
    })
    .filter((x): x is { section: string; item: ReportDetail['sections'][number]['items'][number] } => x !== null)

  const openIn = (links: LinkSet) => (): void => {
    const url = links.aihot ?? links.original
    if (url) onOpenUrl(url)
  }

  const toggleMonth = (key: string): void => {
    setManual(() => {
      const next = new Set(closed)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="paper" data-testid="report-body">
      <aside className="paper__archive">
        <div className="paper__archive-head">往期</div>
        <div className="paper__archive-list">
          {groups.map((group) => {
            const isClosed = closed.has(group.month) && group.month !== month
            return (
              <div className="paper__month" key={group.month}>
                <button
                  type="button"
                  className="paper__month-head"
                  aria-expanded={!isClosed}
                  onClick={() => toggleMonth(group.month)}
                >
                  <span className="paper__caret" aria-hidden="true">
                    {isClosed ? '›' : '⌄'}
                  </span>
                  <span className="paper__month-name">{formatMonthLabel(group.month)}</span>
                  <span className="paper__month-count">{group.entries.length}</span>
                </button>
                {!isClosed && (
                  <ul className="paper__issues">
                    {group.entries.map((entry) => (
                      <li key={entry.key}>
                        <button
                          type="button"
                          className={`paper__issue${activeKey === entry.key ? ' is-active' : ''}`}
                          data-testid="report-issue"
                          onClick={() => onPick(entry.key)}
                        >
                          <span className="paper__issue-day">{dayOfMonth(entry.key)}</span>
                          <span className="paper__issue-title">{entry.headline || '（无头条）'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className="paper__archive-foot"
          onClick={openIn({ aihot: ARCHIVE_PAGE.daily })}
        >
          期刊合订本
        </button>
      </aside>

      <div className="paper__body">
        <header className="paper__masthead">
          <div className="paper__brand">
            <div className="paper__wordmark">
              AI<span className="paper__wordmark-cn">日报</span>
            </div>
            {/* 刊头上写的是这个应用的名字，数据源写在页脚 —— 别把出处当招牌 */}
            <div className="paper__brand-sub">AI 热点 · 数据来自 AIHOT</div>
          </div>
          <IssueStamp month={month} day={Number(report.key.slice(8, 10))} issueDays={issueDays} />
        </header>

        <div className="paper__stats" data-testid="paper-stats">
          <PaperStat value={stats.bigItems} unit="件大事" />
          <PaperStat value={stats.sources} unit="家信源" />
          <PaperStat value={stats.flashes} unit="条快讯" />
          <span className="paper__read">约 {stats.minutes} 分钟读完</span>
        </div>

        {report.lead && (
          <section className="paper__front">
            <div className="paper__rule">
              <span className="paper__rule-label is-lead">头条</span>
            </div>
            <h2 className="paper__lead-title">{report.lead.title}</h2>
            <p className="paper__lead-body">{report.lead.leadParagraph}</p>
            <div className="paper__lead-foot">
              <button type="button" className="paper__lead-source" onClick={openIn(report.links)}>
                在 AIHOT 读这一期
              </button>
            </div>
          </section>
        )}

        {report.sections.map((section) => (
          <section className="paper__section" key={section.label}>
            <div className="paper__rule">
              <span className="paper__rule-label">{section.label}</span>
              <span className="paper__rule-count">{section.items.length}</span>
            </div>
            {section.items.map((item, index) => (
              <div className="paper__item" key={`${section.label}-${index}`}>
                <button type="button" className="paper__item-main" onClick={openIn(item.links)}>
                  <span className="paper__item-title">{item.title}</span>
                  <span className="paper__item-meta">
                    {item.source.name}
                    {item.summary ? ` · ${truncate(item.summary, 54)}` : ''}
                  </span>
                </button>
                <SaveButton input={savedFromArticle(item)} keys={savedKeys} onToggle={onToggleSave} />
              </div>
            ))}
          </section>
        ))}

        {report.flashes.length > 0 && (
          <section className="paper__section">
            <div className="paper__rule">
              <span className="paper__rule-label">快讯</span>
              <span className="paper__rule-count">{report.flashes.length}</span>
            </div>
            {report.flashes.map((flash, index) => (
              <div className="paper__item" key={`flash-${index}`}>
                <button type="button" className="paper__flash" onClick={openIn(flash.links)}>
                  <span className="paper__flash-time">{formatClock(flash.publishedAt ?? null)}</span>
                  <span className="paper__flash-title">{flash.title}</span>
                </button>
                <SaveButton input={savedFromArticle(flash)} keys={savedKeys} onToggle={onToggleSave} />
              </div>
            ))}
          </section>
        )}
      </div>

      <aside className="paper__aside">
        {highlights.length > 0 && (
          <section className="paper__box">
            <div className="paper__rule">
              <span className="paper__rule-label">各栏目头条</span>
            </div>
            <ol className="paper__picks">
              {highlights.map((pick, index) => (
                <li className="paper__pick" key={`${pick.section}-${index}`}>
                  <button type="button" className="paper__pick-main" onClick={openIn(pick.item.links)}>
                    <span className="paper__pick-rank">{index + 1}</span>
                    <span className="paper__pick-text">
                      <span className="paper__pick-title">{pick.item.title}</span>
                      <span className="paper__pick-source">{pick.item.source.name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="paper__box">
          <div className="paper__rule">
            <span className="paper__rule-label">本期栏目</span>
          </div>
          <ul className="paper__toc">
            {report.sections.map((section, index) => (
              <li className="paper__toc-row" key={section.label}>
                <span className="paper__toc-rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="paper__toc-name">{section.label}</span>
                <span className="paper__toc-count">{section.items.length} 件</span>
              </li>
            ))}
            {report.flashes.length > 0 && (
              <li className="paper__toc-row">
                <span className="paper__toc-rank">{String(report.sections.length + 1).padStart(2, '0')}</span>
                <span className="paper__toc-name">快讯</span>
                <span className="paper__toc-count">{report.flashes.length} 条</span>
              </li>
            )}
          </ul>
        </section>
      </aside>
    </div>
  )
}

function PaperStat({
  value,
  unit,
  title
}: {
  value: number
  unit: string
  /** 鼠标停上去能看到的解释。留给"这个数怎么算的"这种问题 */
  title?: string
}): ReactElement {
  return (
    <span className="paper__stat" title={title}>
      <span className="paper__stat-value">{value}</span>
      <span className="paper__stat-unit">{unit}</span>
    </span>
  )
}

/**
 * 刊头右边那块日期牌。
 *
 * 站上还有一个「第 171 期」—— 开放接口里没有期号字段，从日期硬推会错
 * （中间只要有停更就偏了），所以这里不写期号，改成"这个月出到哪天了"：
 * 本月期数 + 一张点阵，哪几天有报一眼看得出来。
 */
function IssueStamp({
  month,
  day,
  issueDays
}: {
  month: string
  day: number
  issueDays: Set<string>
}): ReactElement {
  const total = daysInMonth(month)
  const lead = (weekdayIndex(makeDate(month, 1)) + 6) % 7 // 周一起头
  const cells: (number | null)[] = []
  for (let i = 0; i < lead; i += 1) cells.push(null)
  for (let d = 1; d <= total; d += 1) cells.push(d)

  return (
    <div className="stamp">
      <div className="stamp__card">
        <span className="stamp__month">{monthNameCN(month)}</span>
        <span className="stamp__day">{String(day).padStart(2, '0')}</span>
        <span className="stamp__year">{month.replace('-', ' 年 ')} 月</span>
        <span className="stamp__weekday">{weekdayOf(`${month}-${String(day).padStart(2, '0')}`)}</span>
      </div>
      <div className="stamp__side">
        {/* 归档列表没取到时这里是 0 —— 印一句"本月 0 期"等于把加载失败说成了事实 */}
        {issueDays.size > 0 && <div className="stamp__count">本月 {issueDays.size} 期</div>}
        <div className="stamp__mini">
          {MINI_WEEKDAYS.map((name) => (
            <span className="stamp__wk" key={name}>
              {name}
            </span>
          ))}
          {cells.map((d, index) => (
            <span
              key={d === null ? `blank-${index}` : d}
              className={`stamp__dot${
                d !== null && issueDays.has(makeDate(month, d)) ? ' is-on' : ''
              }${d === day ? ' is-current' : ''}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ 周报 / 月报：册页版式 */

/**
 * 周报月报的版面。
 *
 * 和日报共用 .paper 的三栏骨架，换掉的是中间那一栏 —— 日报问"今天有多少条"，
 * 这两档问"这一期讲了什么"：所以多一条分栏综述（刊物才有的东西，日报每天一期
 * 来不及写），刊头也从日期牌换成期号徽记。
 *
 * 一处刻意的缺席：**头条没有配图**。
 * 站上那张图的地址是服务端渲染时才签发的（aihot.news/api/img-proxy?…&sig=…，
 * 带有效期），原图所在的 storage.googleapis.com 直连 403、deepmind.google 超时，
 * 而站上的 OG 分享卡又印着 AIHOT 的招牌。三条路都走不通，就不摆一张假图 ——
 * 换成一块**期号徽记**：第几期、全年几期、当年出到哪一期的刻度，全是真数据。
 */
function FasciclePaper({
  report,
  entries,
  activeKey,
  savedKeys,
  onToggleSave,
  onOpenUrl,
  onPick
}: {
  report: ReportDetail
  entries: ReportEntry[]
  activeKey: string | null
  savedKeys: Set<string>
  onToggleSave: (input: SavedInput) => void
  onOpenUrl: (url: string) => void
  onPick: (key: string) => void
}): ReactElement {
  const stats = periodicalStats(report)
  const highlights = periodicalHighlights(report)
  const lead = periodicalLead(report)
  const year = report.key.slice(0, 4)
  const issueNo = issueNumber(report.key, entries)
  const yearTotal = yearIssueCount(year, entries)

  const openIn = (links: LinkSet | undefined) => (): void => {
    const url = links?.aihot ?? links?.original
    if (url) onOpenUrl(url)
  }

  // 眉题：周报报"这是第几周、覆盖哪几天"，月报就报月份
  const rubric =
    report.kind === 'weekly'
      ? `${year} 年${reportKeyLabel('weekly', report.key)}${
          formatDateRange(report.periodStart, report.periodEnd)
            ? ` · ${formatDateRange(report.periodStart, report.periodEnd)}`
            : ''
        }`
      : formatMonthLabel(report.key)

  return (
    <div className="paper" data-testid="report-body">
      <aside className="paper__archive">
        <div className="paper__archive-head">往期</div>
        <div className="paper__archive-list">
          {/*
            周报月报一共十几期，不像日报那样有上百期要折叠 —— 直接铺开，
            一行就是"第几期 + 从哪天起 + 那一期的标题"。
          */}
          <ul className="paper__issues">
            {entries.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  className={`paper__issue paper__issue--fascicle${
                    activeKey === entry.key ? ' is-active' : ''
                  }`}
                  data-testid="report-issue"
                  title={entry.headline}
                  onClick={() => onPick(entry.key)}
                >
                  <span className="paper__issue-day">{periodMark(report.kind, entry.key)}</span>
                  <span className="paper__issue-when">{periodWhen(entry)}</span>
                  <span className="paper__issue-title">{entry.headline || '（无标题）'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          className="paper__archive-foot"
          onClick={openIn({ aihot: ARCHIVE_PAGE[report.kind] })}
        >
          期刊合订本
        </button>
      </aside>

      <div className="paper__body">
        <header className="paper__masthead paper__masthead--fascicle">
          <div className="paper__brand">
            <div className="paper__rubric">{rubric}</div>
            <div className="paper__wordmark">
              AI<span className="paper__wordmark-cn">{reportKindLabel(report.kind)}</span>
            </div>
            <div className="paper__kick">{KICK[report.kind]}</div>
            <div className="paper__brand-sub">AI 热点 · 数据来自 AIHOT</div>
          </div>
          <IssueBoard
            kind={report.kind}
            periodKey={report.key}
            periodStart={report.periodStart}
            periodEnd={report.periodEnd}
            issueNo={issueNo}
            yearTotal={yearTotal}
          />
        </header>

        <div className="paper__stats" data-testid="paper-stats">
          <PaperStat value={stats.bigItems} unit="件大事" />
          <PaperStat value={stats.sources} unit="家信源" />
          {/*
            「期日报」这个数是**这一期覆盖的天数**：日报每天一期，实测本站归档
            100 期从 2026-07-02 到 2026-10-09 一天不落，所以天数和期数相等。
            万一哪天断更了，这个数会比实际期数大 —— 鼠标停上去能看到这句说明。
          */}
          {stats.days > 0 && (
            <PaperStat value={stats.days} unit="期日报" title="这一期覆盖的天数；日报每天一期" />
          )}
          <span className="paper__read">约 {stats.minutes} 分钟读完</span>
        </div>

        {report.overview && (
          <section className="paper__preface">
            <div className="paper__rule">
              <span className="paper__rule-label">{SCOPE[report.kind]}导读</span>
            </div>
            <p className="paper__preface-body">{report.overview}</p>
          </section>
        )}

        {lead && (
          <section className="paper__front">
            <div className="paper__rule">
              <span className="paper__rule-label is-lead">头条</span>
            </div>
            <h2 className="paper__lead-title">{lead.title}</h2>
            {lead.item?.summary && <p className="paper__lead-body">{lead.item.summary}</p>}
            {lead.item && (
              <div className="paper__lead-foot">
                <button
                  type="button"
                  className="paper__lead-source"
                  onClick={openIn(lead.item.links)}
                >
                  {lead.item.source.name}
                </button>
              </div>
            )}
          </section>
        )}

        {report.sections.map((section) => (
          <section className="paper__section" key={section.label}>
            <div className="paper__rule">
              <span className="paper__rule-label">{section.label}</span>
              <span className="paper__rule-count">{section.items.length} 件</span>
            </div>
            {section.summary && <p className="paper__section-note">{section.summary}</p>}
            {section.items.map((item, index) => (
              <div className="paper__item" key={`${section.label}-${index}`}>
                <button type="button" className="paper__item-main" onClick={openIn(item.links)}>
                  <span className="paper__item-title">{item.title}</span>
                  <span className="paper__item-meta">
                    {item.source.name}
                    {item.summary ? ` · ${truncate(item.summary, 88)}` : ''}
                  </span>
                </button>
                <SaveButton input={savedFromArticle(item)} keys={savedKeys} onToggle={onToggleSave} />
              </div>
            ))}
          </section>
        ))}

        <footer className="paper__colophon">
          <span>本版数据来自 AIHOT</span>
          {report.generatedAt && <span>生成于 {formatRelative(report.generatedAt)}</span>}
          <button type="button" className="paper__lead-source" onClick={openIn(report.links)}>
            在 AIHOT 读这一期
          </button>
        </footer>
      </div>

      <aside className="paper__aside">
        {highlights.length > 0 && (
          <section className="paper__box">
            <div className="paper__rule">
              <span className="paper__rule-label">{SCOPE[report.kind]}看点</span>
            </div>
            <ol className="paper__picks">
              {highlights.map((pick, index) => (
                <li className="paper__pick" key={`${pick.section}-${index}`}>
                  <button type="button" className="paper__pick-main" onClick={openIn(pick.item.links)}>
                    <span className="paper__pick-rank">{index + 1}</span>
                    <span className="paper__pick-text">
                      <span className="paper__pick-title">{pick.item.title}</span>
                      <span className="paper__pick-source">{pick.item.source.name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="paper__box">
          <div className="paper__rule">
            <span className="paper__rule-label">本期版面</span>
          </div>
          <ul className="paper__toc">
            {report.sections.map((section, index) => (
              <li className="paper__toc-row" key={section.label}>
                <span className="paper__toc-rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="paper__toc-name">{section.label}</span>
                <span className="paper__toc-count">{section.items.length} 件</span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  )
}

/**
 * 刊头右边那块期号徽记。
 *
 * 站上这里是一张 16:9 的配图（拿不到，理由见 FasciclePaper 上面那段），
 * 我们换成"期号 + 刻度"：一个大字（周报给周次、月报给月份）、第几期、
 * 全年几期，再加一行刻度 —— 一年出多少期就画多少个点，当前这一期是红的。
 *
 * 和日报刊头上那张发行点阵是同一套语言：**拿真实的发行记录当装饰**，
 * 不摆一张和内容无关的画。
 */
function IssueBoard({
  kind,
  periodKey,
  periodStart,
  periodEnd,
  issueNo,
  yearTotal
}: {
  kind: ReportKind
  periodKey: string
  periodStart: string | null
  periodEnd: string | null
  issueNo: number
  yearTotal: number
}): ReactElement {
  const year = periodKey.slice(0, 4)
  const big = kind === 'weekly' ? String(Number(periodKey.slice(-2)) || '') : periodKey.slice(5, 7)
  const caption = kind === 'weekly' ? `${year} 年第 ${big} 周` : formatMonthLabel(periodKey)

  return (
    <div className="board">
      <div className="board__card">
        <span className="board__no">{issueNo > 0 ? `第 ${issueNo} 期` : '期号未知'}</span>
        <span className="board__big">{big}</span>
        <span className="board__unit">{caption}</span>
        <span className="board__period">{formatDateRange(periodStart, periodEnd)}</span>
      </div>
      <div className="board__side">
        <div className="board__year">
          <span>{year} 年</span>
          {/* 归档列表没取到时 yearTotal 是 0 —— 与其印"全年 0 期"和一行空刻度，不如不印 */}
          {yearTotal > 0 && <span className="board__total">全年 {yearTotal} 期</span>}
        </div>
        {/* 一年出多少期就画多少个点 —— 这是"出到哪儿了"，不是进度条 */}
        {yearTotal > 0 && (
          <div className="board__ticks" title={`${year} 年共 ${yearTotal} 期，当前第 ${issueNo} 期`}>
            {Array.from({ length: yearTotal }, (_, index) => (
              <span
                key={index}
                className={`board__tick${index + 1 === issueNo ? ' is-current' : ''}${
                  index + 1 < issueNo ? ' is-past' : ''
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 往期栏最左边那个数字：周报给周次（40），月报给月份（09） */
function periodMark(kind: ReportKind, key: string): string {
  if (kind === 'weekly') return String(Number(key.slice(-2)) || '')
  return key.slice(5, 7)
}

/** 数字旁边那行小字：这一期从哪天起的。期界缺失时留空，不编一个日期 */
function periodWhen(entry: ReportEntry): string {
  const from = formatDateRange(entry.periodStart, null)
  return from ? `${from} 起` : ''
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}
