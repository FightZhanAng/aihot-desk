import { splitBy, textOf } from './html'
import type { ChangelogDay, ChangelogEntry } from './types'

/*
 * AIHOT 更新日志的解析。
 *
 * 为什么是"解析 HTML"而不是"调接口"：
 *   AIHOT 的开放 JSON API 只覆盖资讯数据（items / hot-topics / reports / …），
 *   更新日志没有对应的端点 —— openapi-v1.json 里没有，MCP 工具列表里也没有。
 *   但 /changelog 是完整服务端渲染的，内容全在 HTML 里，结构也稳定
 *   （每天一个 <section id="d-YYYY-MM-DD">，每条一个 <li>）。
 *
 * 所以这里的策略是"针对这一种结构做精确匹配"，不是通用 HTML 解析：
 *   结构一旦变了，解析结果会直接变成空数组，而不是解析出半截错误内容 ——
 *   调用方据此降级成"去网页上看"，不会拿脏数据糊弄用户。
 * 放在 shared 里是为了能无头单测：喂一段真实 HTML，断言解出来的条数。
 *
 * 页面其实有两种形状，都要认：
 *   1. 普通的一天 —— `<h2><time>日期</time><span>周二</span></h2>` + 若干 `<li class="grid">`；
 *   2. 特稿的一天 —— 整天的重点是一篇长文（`<header>` + 若干小节），没有 `<li class="grid">`。
 *      只按形状 1 切的话，这一天会被整段丢掉 —— 而它往往是更新日志里最重要的一天。
 */

/** 每条记录：`<span class="mono …">16:32</span>` */
const TIME_RE = /<span class="mono[^"]*">\s*([0-9]{1,2}:[0-9]{2})\s*<\/span>/

/**
 * 类型标签：颜色圆点之后的那串文字（"更新" / "优化" / "公告" / "下线"）。
 *
 * 色名里**带数字**：站上「下线」的圆点是 `bg-ink-4`。
 * 早先这里写的是 `bg-[a-z-]+`，抓不到它 —— 而 parseEntry 抓不到时会兜底成
 * 「更新」（那是最常见的一档，作为默认值看着最不刺眼）。结果是整页 81 条里
 * 那一条下线被算进了更新：「按类型看」印出"更新 37 · 下线 0"，
 * 而站上印的是"更新 36 · 下线 1"。数字差一，页面上几乎看不出来。
 */
const KIND_RE = /rounded-full bg-[a-z0-9-]+"[^>]*><\/span>([^<]{1,8})<\/span>/

const TITLE_RE = /<h3[^>]*>([\s\S]*?)<\/h3>/

/**
 * 特稿的判据：它的 `<h2>` 带 `aria-label`。
 *
 * 特稿的标题是画出来的字标（"AIHOT" 那串 SVG 路径 + 一个大号 "2.0"），
 * 元素里没有可读文字，只有 aria-label 留着标题原文。
 * 普通分组同样是 `<h2>`，但里面装的是 `<time>日期</time>`、没有 aria-label ——
 * 所以这一个属性就足以把两种形状分开，不用猜。
 */
const FEATURE_TITLE_RE = /<h2[^>]*\baria-label="([^"]{1,200})"/

/** 特稿顶部的分类标签：`<div class="… tracking-[0.3em] …">…重大更新</div>` */
const FEATURE_KIND_RE = /tracking-\[0\.3em\][^>]*>([\s\S]{0,400}?)<\/div>/

/** 特稿的导语只取 `<header>` 里的，正文留在原页面 */
const FEATURE_HEADER_RE = /<header[^>]*>([\s\S]*?)<\/header>/

/** 导语最多取几段、小节目录最多列几条 —— 列表行塞不下长文 */
const FEATURE_LEAD_MAX = 3
const FEATURE_SECTION_MAX = 8

export function parseChangelog(html: string): ChangelogDay[] {
  if (typeof html !== 'string' || html.length === 0) return []

  const sections = splitBy(html, /<section id="d-(\d{4}-\d{2}-\d{2})"/)
  const days: ChangelogDay[] = []

  for (let i = 0; i < sections.length; i += 1) {
    const start = sections[i]!.start
    const end = i + 1 < sections.length ? sections[i + 1]!.start : html.length
    const date = sections[i]!.head[1]
    if (!date) continue

    const chunk = html.slice(start, end)
    const weekday = parseWeekday(chunk)

    const entries = parseEntries(chunk)
    if (entries.length > 0) {
      days.push({ date, weekday, entries })
      continue
    }

    // 没有列表项 —— 可能是特稿，也可能只是结构变了。认不出就不产出这一天，
    // 不拿一条空壳去凑数（界面会因此显示"暂时读不出来"，比显示一天空白强）。
    const feature = parseFeature(chunk)
    if (feature) days.push({ date, weekday, entries: [feature] })
  }

  return days
}

/**
 * 日期后面那个 `<span>周二</span>`。
 *
 * 两种形状的落点不一样：普通分组把星期几放在 `<time>` **后面**，
 * 特稿把它写在 `<time>` **里面**（`2026 年 9 月 28 日<!-- --> 周一 · 13:12`），
 * 所以先按前一种切，切不到再去 `<time>` 的文字里捞。
 */
function parseWeekday(chunk: string): string {
  const outside = /<time[^>]*>[\s\S]*?<\/time>\s*<span[^>]*>([^<]{1,6})<\/span>/.exec(chunk)
  if (outside?.[1]) return outside[1].trim()

  const inside = /<time[^>]*>([\s\S]*?)<\/time>/.exec(chunk)?.[1]
  if (!inside) return ''
  return /(周[一二三四五六日天])/.exec(textOf(inside))?.[1] ?? ''
}

function parseEntries(chunk: string): ChangelogEntry[] {
  const marks = splitBy(chunk, /<li class="grid/)
  const entries: ChangelogEntry[] = []

  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i]!.start
    const end = i + 1 < marks.length ? marks[i + 1]!.start : chunk.length
    const entry = parseEntry(chunk.slice(start, end))
    if (entry) entries.push(entry)
  }

  return entries
}

/** 收集一段 HTML 里的所有 `<p>` 文字。max 用来给特稿封顶，普通条目不限 */
function paragraphsOf(scope: string, max = Number.POSITIVE_INFINITY): string[] {
  const out: string[] = []
  const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/g
  let match: RegExpExecArray | null
  while ((match = paragraph.exec(scope)) !== null) {
    const text = textOf(match[1] ?? '')
    if (text) out.push(text)
    if (out.length >= max) break
  }
  return out
}

function parseEntry(chunk: string): ChangelogEntry | null {
  const titleRaw = TITLE_RE.exec(chunk)?.[1]
  if (!titleRaw) return null
  const title = textOf(titleRaw)
  if (!title) return null

  const bullets: string[] = []
  const list = /<ul[^>]*>([\s\S]*?)<\/ul>/.exec(chunk)?.[1]
  if (list) {
    const item = /<li[^>]*>([\s\S]*?)<\/li>/g
    let match: RegExpExecArray | null
    while ((match = item.exec(list)) !== null) {
      const text = textOf(match[1] ?? '')
      if (text) bullets.push(text)
    }
  }

  return {
    time: TIME_RE.exec(chunk)?.[1] ?? '',
    kind: KIND_RE.exec(chunk)?.[1]?.trim() ?? '更新',
    title,
    body: paragraphsOf(chunk),
    bullets
  }
}

/**
 * 特稿 → 一条记录。
 *
 * 只取"标题 + 导语 + 小节目录"，不搬正文：
 * 全文可能有几千字，塞进一行列表里既读不了也压垮版式，
 * 而用户真正需要在这里知道的是"这天发了什么大事、包含哪几块"。
 * 想看全文有底部那个"在 AIHOT 看原页面"。
 */
function parseFeature(chunk: string): ChangelogEntry | null {
  const titleRaw = FEATURE_TITLE_RE.exec(chunk)?.[1]
  if (!titleRaw) return null

  const title = textOf(titleRaw)
  if (!title) return null

  const header = FEATURE_HEADER_RE.exec(chunk)?.[1] ?? ''
  const kind = textOf(FEATURE_KIND_RE.exec(chunk)?.[1] ?? '')

  return {
    time: TIME_RE.exec(chunk)?.[1] ?? '',
    kind: kind || '重大更新',
    title,
    body: paragraphsOf(header, FEATURE_LEAD_MAX),
    bullets: sectionHeadings(chunk),
    feature: true
  }
}

/**
 * 特稿的小节标题，当目录用。
 *
 * 每个 `<h3>` 里编号和标题各占一个 `<span>`（`<span class="num">01</span><span>底层：…</span>`），
 * 直接去标签会粘成 "01底层：整套系统重新搭了一遍"，所以按 span 拆开再拼。
 */
function sectionHeadings(chunk: string): string[] {
  const out: string[] = []
  const heading = /<h3[^>]*>([\s\S]*?)<\/h3>/g
  let match: RegExpExecArray | null
  while ((match = heading.exec(chunk)) !== null) {
    const inner = match[1] ?? ''
    const parts: string[] = []
    const span = /<span[^>]*>([\s\S]*?)<\/span>/g
    let piece: RegExpExecArray | null
    while ((piece = span.exec(inner)) !== null) {
      const text = textOf(piece[1] ?? '')
      if (text) parts.push(text)
    }
    const text = parts.length > 0 ? parts.join(' ') : textOf(inner)
    if (text) out.push(text)
    if (out.length >= FEATURE_SECTION_MAX) break
  }
  return out
}

/** 汇总信息 —— 界面在顶部显示"共 N 次更新" */
export function changelogEntryCount(days: ChangelogDay[]): number {
  return days.reduce((sum, day) => sum + day.entries.length, 0)
}

/* ------------------------------------------------------------ 归类与计数 */

/**
 * 一条记录的类型，归到站上那四档里去。
 *
 * 页面上只有四档：更新 / 优化 / 公告 / 下线。解析出来的原始文本比这脏一点 ——
 * 特稿那天的标签是「重大更新」（它写在另一个字距的元素里），
 * 而站上的"按类型看"把它算进「更新」。这里跟站上的口径对齐：
 * 带"更新"或"新增"的都算「更新」。
 *
 * 这个口径是核对过的，不是猜的：站上那张侧卡印的「全部」
 * 正好等于四档之和（实测 81 = 更新 36 + 优化 37 + 公告 7 + 下线 1）。
 */
export function changelogKind(entry: ChangelogEntry): string {
  const kind = entry.kind.trim()
  if (!kind) return '更新'
  if (kind.includes('更新') || kind.includes('新增')) return '更新'
  return kind
}

/**
 * 四档的固定顺序 —— 也是侧栏里从上到下的顺序。
 * 将来真冒出第五种类型，它会被追加在后面（见 changelogKindTally），不会丢。
 */
export const CHANGELOG_KINDS = ['更新', '优化', '公告', '下线'] as const

export interface ChangelogTally {
  /** 类型名，或按月份统计里的 "2026-10" */
  key: string
  count: number
}

/**
 * 按类型数一遍。
 *
 * 四档是**全列**的，哪怕某档当天为 0 —— 侧栏里一行忽隐忽现，
 * 看着像加载出了岔子；而"下线 0"本身也是一条信息（这条线上最近没人被下线）。
 */
export function changelogKindTally(days: ChangelogDay[]): ChangelogTally[] {
  const map = new Map<string, number>()
  for (const day of days) {
    for (const entry of day.entries) {
      const kind = changelogKind(entry)
      map.set(kind, (map.get(kind) ?? 0) + 1)
    }
  }

  const known: ChangelogTally[] = CHANGELOG_KINDS.map((kind) => ({
    key: kind,
    count: map.get(kind) ?? 0
  }))
  const extra = [...map.entries()]
    .filter(([kind]) => !(CHANGELOG_KINDS as readonly string[]).includes(kind))
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }))

  return [...known, ...extra]
}

/** 按月数一遍。月份直接切日期（2026-10-06 → 2026-10），新的在前 */
export function changelogMonthTally(days: ChangelogDay[]): ChangelogTally[] {
  const map = new Map<string, number>()
  for (const day of days) {
    const month = day.date.slice(0, 7)
    map.set(month, (map.get(month) ?? 0) + day.entries.length)
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (a.key < b.key ? 1 : -1))
}

/**
 * 按类型 / 月份筛一遍。
 *
 * 两个条件是叠加的（都给了就都得满足）。筛空的那一天整天空掉 ——
 * 留着一条日期横线、底下什么都没有，比不显示这一行更让人困惑。
 */
export function filterChangelog(
  days: ChangelogDay[],
  kind: string | null,
  month: string | null
): ChangelogDay[] {
  return days
    .filter((day) => !month || day.date.startsWith(month))
    .map((day) => ({
      ...day,
      entries: kind ? day.entries.filter((entry) => changelogKind(entry) === kind) : day.entries
    }))
    .filter((day) => day.entries.length > 0)
}
