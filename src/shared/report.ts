import type {
  DailyStats,
  LinkSet,
  PeriodicalHighlight,
  PeriodicalStats,
  ReportArchiveGroup,
  ReportArticle,
  ReportDetail,
  ReportEntry,
  ReportKind,
  ReportSection
} from './types'
import { daysBetween, monthOf } from './format'

/*
 * 三种报告（日报 / 周报 / 月报）在 API 里是**三套不同的形状**：
 *   日报 —— 有日期 date、有头条 lead、有快讯 flashes，没有 headline/overview
 *   周报 —— 有周次 week、有标题 headline、有综述 overview，没有头条
 *   月报 —— 同周报，字段名是 month
 *
 * 界面侧只需要一套版式，所以在这里把它们翻译成同一个 ReportDetail。
 * 放在 shared 是为了能无头单测：喂三份真实的原始 JSON，断言翻出来的形状一致。
 */

/** 报告正文里一条的原始形状（三种报告一致） */
export interface RawArticle {
  title?: string
  summary?: string | null
  source?: { name?: string }
  links?: LinkSet
  publishedAt?: string | null
}

export interface RawReport {
  /** 日报 */
  date?: string
  lead?: { title?: string; leadParagraph?: string }
  flashes?: RawArticle[]
  /** 周报 / 月报 */
  week?: string
  month?: string
  headline?: string
  overview?: string
  /** 周报月报有 periodStart/periodEnd，日报没有 */
  periodStart?: string
  periodEnd?: string
  generatedAt?: string
  links?: LinkSet
  sections?: { label?: string; summary?: string | null; items?: RawArticle[] }[]
}

/** 归档列表里的一期 */
export interface RawReportEntry {
  date?: string
  week?: string
  month?: string
  periodStart?: string
  periodEnd?: string
  generatedAt?: string
  /** 周报月报用 headline，日报用 leadTitle */
  headline?: string
  leadTitle?: string
  links?: LinkSet
}

/** 三种报告的期号字段名不同，这里是唯一的映射点 */
export function reportKeyOf(kind: ReportKind, raw: RawReport | RawReportEntry): string {
  if (kind === 'daily') return raw.date ?? ''
  if (kind === 'weekly') return raw.week ?? ''
  return raw.month ?? ''
}

function toArticle(raw: RawArticle): ReportArticle {
  return {
    title: raw.title ?? '',
    summary: raw.summary ?? null,
    source: { name: raw.source?.name ?? '未知来源' },
    links: raw.links ?? {},
    publishedAt: raw.publishedAt ?? null
  }
}

export function toReportEntry(kind: ReportKind, raw: RawReportEntry): ReportEntry | null {
  const key = reportKeyOf(kind, raw)
  if (!key) return null
  return {
    key,
    periodStart: raw.periodStart ?? null,
    periodEnd: raw.periodEnd ?? null,
    generatedAt: raw.generatedAt ?? null,
    // 日报的归档条目把头条标题叫 leadTitle
    headline: raw.headline ?? raw.leadTitle ?? '',
    links: raw.links ?? {}
  }
}

export function toReportDetail(kind: ReportKind, raw: RawReport): ReportDetail | null {
  const key = reportKeyOf(kind, raw)
  if (!key) return null

  const sections: ReportSection[] = (raw.sections ?? [])
    .map((section) => ({
      label: section.label ?? '未命名',
      summary: section.summary ?? null,
      items: (section.items ?? []).map(toArticle)
    }))
    .filter((section) => section.items.length > 0)

  const lead =
    raw.lead && raw.lead.title
      ? { title: raw.lead.title, leadParagraph: raw.lead.leadParagraph ?? '' }
      : null

  return {
    kind,
    key,
    periodStart: raw.periodStart ?? null,
    periodEnd: raw.periodEnd ?? null,
    generatedAt: raw.generatedAt ?? null,
    // 日报没有独立的 headline 字段，它的"标题"就是头条标题
    headline: raw.headline ?? lead?.title ?? '',
    links: raw.links ?? {},
    overview: raw.overview ?? null,
    lead,
    sections,
    flashes: (raw.flashes ?? []).map(toArticle)
  }
}

/* ------------------------------------------------------------ 日报的统计行 */

/**
 * 每分钟读多少字。这个 500 是从 AIHOT 日报页面上反推的：
 * 拿 10-06 / 10-07 / 10-08 三天的数据算总字数除以它，四舍五入后
 * 与页面上印的「约 N 分钟读完」完全一致（2.26→2、5.09→5、5.01→5）。
 */
const CHARS_PER_MINUTE = 500

/**
 * 报头下面那行数字。
 *
 * 「件大事」和「约 N 分钟读完」与站上一致（逐日核对过）。
 * 「家信源」是我们的口径：去重后的信源**名字**有几个。
 * 站上那个「个来源」是按机构归并的（Anthropic 的几个博客算一家、X 上的账号
 * 算回它背后的公司），那张映射表在服务端，从开放接口里推不出来。
 * 所以这里不冒充它 —— 用我们自己算得准的口径，标签也写成「家信源」。
 */
export function dailyStats(detail: {
  lead: ReportDetail['lead']
  sections: ReportSection[]
  flashes: ReportArticle[]
}): DailyStats {
  const items = detail.sections.flatMap((section) => section.items)

  const names = new Set<string>()
  for (const article of [...items, ...detail.flashes]) {
    if (article.source.name) names.add(article.source.name)
  }

  const text = [
    detail.lead?.title ?? '',
    detail.lead?.leadParagraph ?? '',
    ...items.flatMap((article) => [article.title, article.summary ?? '']),
    ...detail.flashes.map((article) => article.title)
  ].join('')

  return {
    bigItems: items.length,
    sources: names.size,
    flashes: detail.flashes.length,
    // 再短的一期也不写"0 分钟"
    minutes: Math.max(1, Math.round(text.length / CHARS_PER_MINUTE))
  }
}

/* ------------------------------------------------------------ 周报 / 月报的统计行 */

/**
 * 周报月报报头下面那行数字。
 *
 * 与日报共用同一个「每 500 字一分钟」的常量，也共用「件大事 = 分栏条目总数」
 * 这个口径 —— 拿真实数据核过：周报 2026-W40 算出 20、月报 2026-09 算出 29，
 * 与站上印的「20 件大事」「29 件大事」都对得上。
 *
 * 「家信源」是我们自己的口径（去重后的信源**名字**）。站上印的是「133 家信源」，
 * 那个数按**机构**归并（Anthropic 的几个博客算一家、X 账号算回它背后的公司），
 * 映射表在服务端，开放接口里推不出来 —— 所以不冒充它，标签也写得不一样。
 *
 * 最后一项本站上是有差别的：周报印「7 期日报」、月报印「30 天」。我们只给天数 ——
 * 「这一期里出了几期日报」需要日报归档与周报期的对应关系，接口里没有；
 * 而日报每天一期，正常情况下两者是同一个数。宁可标签朴素，也不编一个数。
 */
export function periodicalStats(detail: {
  periodStart: string | null
  periodEnd: string | null
  headline: string
  overview: string | null
  sections: ReportSection[]
}): PeriodicalStats {
  const items = detail.sections.flatMap((section) => section.items)

  const names = new Set<string>()
  for (const article of items) {
    if (article.source.name) names.add(article.source.name)
  }

  // 字数把分栏名和分栏综述也算进去 —— 它们在版面上是正文的一部分，不算是虚报
  const text = [
    detail.headline,
    detail.overview ?? '',
    ...detail.sections.flatMap((section) => [
      section.label,
      section.summary ?? '',
      ...section.items.flatMap((article) => [article.title, article.summary ?? ''])
    ])
  ].join('')

  // 期界缺失时给 0，界面上那一格就不显示 —— 好过编一个看起来很像的数字
  const days =
    detail.periodStart && detail.periodEnd
      ? Math.max(1, daysBetween(detail.periodStart, detail.periodEnd) + 1)
      : 0

  return {
    bigItems: items.length,
    sources: names.size,
    days,
    minutes: Math.max(1, Math.round(text.length / CHARS_PER_MINUTE))
  }
}

/**
 * 这一期是**当年**的第几期。
 *
 * 口径是从 AIHOT 页面里那份序列化数据核出来的，不是猜的：
 * 周报页的 payload 里写着 2026-W19 → 1、W20 → 2 …… W40 → 22，
 * 月报页写着 2026-05 → 1 …… 2026-09 → 5，两边页头也都印着「全年 N 期」。
 * 所以它是**按年、从最早那期起算的累计序号** —— 既不是 ISO 周次
 * （那才是"第 40 周"），也不是倒着数的"最新一期是第 1 期"。
 *
 * 开放接口里没有 issueNumber 这个字段，序号只能拿归档列表自己数。
 * 已知边界：/api/v1/weeklies 一次最多给 60 期（limit 上限 60，超了直接 400），
 * 列表一旦被截断，早年那些期就数不进来、序号会偏小。当前 22 期还够用；
 * 真到 60 期以上，得改成分页把当期所有期取齐再数。
 *
 * 按年分组是为了跨年后重新从 1 数起（跟刊物一样），而不是接着往上加。
 * 列表里没有的期号返回 0，界面上据此不显示期号牌。
 */
export function issueNumber(key: string, entries: ReportEntry[]): number {
  const year = key.slice(0, 4)
  const sameYear = entries
    .filter((entry) => entry.key.slice(0, 4) === year)
    .map((entry) => entry.key)
    .sort((a, b) => ordinalOf(a) - ordinalOf(b))
  const index = sameYear.indexOf(key)
  return index < 0 ? 0 : index + 1
}

/**
 * 这一年一共出了几期 —— 刊头右上角那行「全年 N 期」。
 * 站上周报页写 22、月报页写 5，和归档列表的长度一致。
 */
export function yearIssueCount(year: string, entries: ReportEntry[]): number {
  return entries.filter((entry) => entry.key.slice(0, 4) === year).length
}

/**
 * 期内序号：周报取 "2026-W40" 里的 40，月报取 "2026-09" 里的 9。
 *
 * 不用字符串直接比大小，是为了挡住 "2026-W5" 这种没补零的写法 ——
 * 那种键按字典序会排到 "2026-W40" 后面去。接口眼下给的是两位补零，
 * 但这个函数管的是所有期的相对次序，错一次就是整张刊头错位。
 */
function ordinalOf(key: string): number {
  const week = /W(\d+)/.exec(key)
  if (week) return Number(week[1])
  const month = /^\d{4}-(\d{2})$/.exec(key)
  if (month) return Number(month[1])
  return 0
}

/**
 * 这一期的头条。
 *
 * 周报月报没有日报那种独立的 lead 字段，它们的 headline 就是头条标题 ——
 * 逐期核过：W40 的 headline 与"模型发布/更新"栏的第一条是同一件事，
 * 2026-09 的 headline 也与"模型发布/更新"栏的第一条一致。
 *
 * 所以头条 = headline 当标题、第一栏第一条当摘要与出处。
 * 两者不一致时（服务端将来改了归栏规则）以 headline 为准显示标题，
 * 下面挂的仍是真实存在的那一条 —— 宁可标题和摘要对不齐，也不要编一个摘要。
 */
export function periodicalLead(detail: {
  headline: string
  sections: ReportSection[]
}): { title: string; item: ReportArticle | null } | null {
  const first = detail.sections[0]?.items[0] ?? null
  const title = detail.headline || first?.title || ''
  if (!title) return null
  return { title, item: first }
}

/**
 * 右栏「本期看点」的条目：每个分栏打头的那一条。
 *
 * 站上那个列表是编辑挑的，开放接口里没有这个字段 —— 这里是从数据里算出来的，
 * 口径就是"每个栏目最新的一条"，所以顶上的标签写「各栏目头条」而不是「编辑推荐」。
 *
 * 空分栏（只有标题没有条目）跳过，不留空位。
 */
export function periodicalHighlights(detail: { sections: ReportSection[] }): PeriodicalHighlight[] {
  const picks: PeriodicalHighlight[] = []
  for (const section of detail.sections) {
    const first = section.items[0]
    if (first) picks.push({ section: section.label, item: first })
  }
  return picks
}

/* ------------------------------------------------------------ 往期归档 */

/**
 * 按自然月分组，最近的月份在前、每月内部最近的一期在前。
 *
 * 只对日报有意义 —— 它一天一期，一个月能有三十条，不折叠根本翻不动。
 * 周报月报本身就没几期，用不着这个。
 */
export function groupReportsByMonth(entries: ReportEntry[]): ReportArchiveGroup[] {
  const map = new Map<string, ReportEntry[]>()
  for (const entry of entries) {
    const month = monthOf(entry.key)
    if (!month) continue
    const bucket = map.get(month)
    if (bucket) bucket.push(entry)
    else map.set(month, [entry])
  }
  return [...map.entries()]
    .map(([month, list]) => ({
      month,
      entries: [...list].sort((a, b) => (a.key < b.key ? 1 : -1))
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1))
}
